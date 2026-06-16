import { openaiJson } from "@/lib/providers/openai";
import { search } from "@/lib/search";
import { extractClaims } from "@/lib/extract";
import { CITATION_SORT_PROMPT } from "@/lib/prompts/workspace-citations";
import type {
  ClaimCitations,
  CitationsReport,
  EvidenceCitation,
  EvidenceSource,
} from "@/types";

/**
 * "Citations" capability (MAJOR_CHANGES.md #C1).
 *
 * For each claim in a document, gather web sources and split them into evidence
 * FOR and AGAINST the claim — an evidence dossier rather than a single verdict.
 * Two searches per claim (a direct query + an adversarial one) surface both
 * sides; the locked auditor then sorts the REAL retrieved sources by index, so
 * no citation can be fabricated.
 *
 * Reuses `lib/search.ts` and `lib/extract.ts`; it does not touch the 3-agent
 * verifier path.
 */

const MAX_CLAIMS = 8;
const PER_QUERY = 5;
const MAX_SOURCES_PER_CLAIM = 8;

interface SortResult {
  stance_summary?: string;
  supporting?: number[];
  contradicting?: number[];
}

function toCitation(s: EvidenceSource): EvidenceCitation {
  return { title: s.title, url: s.url, domain: s.domain, snippet: s.snippet };
}

function dedupe(sources: EvidenceSource[]): EvidenceSource[] {
  const seen = new Set<string>();
  const out: EvidenceSource[] = [];
  for (const s of sources) {
    if (!s.url || seen.has(s.url)) continue;
    seen.add(s.url);
    out.push(s);
    if (out.length >= MAX_SOURCES_PER_CLAIM) break;
  }
  return out;
}

async function gatherForClaim(claimText: string): Promise<ClaimCitations> {
  // One direct query + one adversarial query to surface counter-evidence.
  const [direct, adversarial] = await Promise.all([
    search(claimText, { maxResults: PER_QUERY }).catch(() => []),
    search(`evidence against or criticism of: ${claimText}`, {
      maxResults: PER_QUERY,
    }).catch(() => []),
  ]);
  const sources = dedupe([...direct, ...adversarial]);

  if (sources.length === 0) {
    return {
      claim: claimText,
      stance_summary: "No web sources were found for this claim.",
      supporting: [],
      contradicting: [],
    };
  }

  const payload = JSON.stringify({
    CLAIM: claimText,
    SOURCES: sources.map((s, i) => ({
      index: i,
      title: s.title,
      url: s.url,
      snippet: s.snippet?.slice(0, 500),
    })),
  });

  let sorted: SortResult;
  try {
    sorted = await openaiJson<SortResult>(CITATION_SORT_PROMPT, payload);
  } catch {
    sorted = {};
  }

  const pick = (idxs: unknown): EvidenceCitation[] =>
    Array.isArray(idxs)
      ? idxs
          .filter((n): n is number => Number.isInteger(n) && n >= 0 && n < sources.length)
          .map((n) => toCitation(sources[n]))
      : [];

  return {
    claim: claimText,
    stance_summary:
      typeof sorted.stance_summary === "string" && sorted.stance_summary.trim()
        ? sorted.stance_summary.trim()
        : "Evidence gathered; see sources below.",
    supporting: pick(sorted.supporting),
    contradicting: pick(sorted.contradicting),
  };
}

export async function generateCitations(
  text: string,
  docTitle: string,
): Promise<CitationsReport> {
  const claims = (await extractClaims(text)).slice(0, MAX_CLAIMS);
  const results = await Promise.all(claims.map((c) => gatherForClaim(c.text)));
  return { doc_title: docTitle, claims: results };
}
