import { openaiJson } from "@/lib/providers/openai";
import { findBibCandidates } from "@/lib/bib";
import {
  CITATION_EXTRACTOR_PROMPT,
  CITATION_MATCHER_PROMPT,
} from "@/lib/prompts/citation";
import {
  type Claim,
  type CitationCandidate,
  type CitationCheck,
  type CitationReport,
  type CitationStatus,
  type CitationSummary,
  MalformedLLMJsonError,
} from "@/types";

/**
 * Citation / reference checker (MAJOR_CHANGES.md #8).
 *
 * Pipeline:
 *   1. extract references from the text (one LLM call).
 *   2. for each reference, query Crossref + Semantic Scholar in parallel
 *      (lib/bib.ts) → candidate works that actually exist.
 *   3. ask the matcher whether any candidate matches the cited reference
 *      (one LLM call per reference, fanned out via Promise.all).
 *
 * This is the project's single most reliable behavior (catching fabricated
 * citations) made into a standalone tool: instead of inferring "this looks
 * made up" from web search noise, it checks the cited work against structured
 * scholarly indices and reports `not_found` when nothing real matches.
 */

const VALID_STATUS: CitationStatus[] = ["verified", "not_found", "uncertain"];
const MAX_REFERENCES = 30;

interface RawReference {
  reference?: unknown;
  title?: unknown;
  authors?: unknown;
  year?: unknown;
  query?: unknown;
}
interface RawExtractPayload {
  references?: RawReference[];
}

interface ExtractedReference {
  reference: string;
  title: string;
  authors: string;
  year: string;
  query: string;
}

interface RawMatch {
  status?: unknown;
  best_index?: unknown;
  confidence?: unknown;
  rationale?: unknown;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function clamp01(n: unknown): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

async function extractReferences(text: string): Promise<ExtractedReference[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const payload = await openaiJson<RawExtractPayload>(
    CITATION_EXTRACTOR_PROMPT,
    `Text to scan for references:\n\n"""${trimmed}"""`,
  );
  if (!payload || !Array.isArray(payload.references)) {
    throw new MalformedLLMJsonError(
      "Citation extractor did not return a `references` array.",
      JSON.stringify(payload).slice(0, 500),
    );
  }

  const refs: ExtractedReference[] = [];
  for (const raw of payload.references) {
    const reference = asString(raw.reference);
    const query = asString(raw.query) || reference;
    if (!reference) continue;
    refs.push({
      reference,
      title: asString(raw.title),
      authors: asString(raw.authors),
      year: asString(raw.year),
      query,
    });
  }
  return refs.slice(0, MAX_REFERENCES);
}

async function checkOne(
  ref: ExtractedReference,
  idx: number,
): Promise<CitationCheck> {
  const claim: Claim = {
    id: `ref${idx + 1}`,
    text: ref.reference,
    sentence: ref.reference,
    type: "citation",
    entities: [ref.authors, ref.year, ref.title].filter(Boolean),
  };

  let candidates: CitationCandidate[] = [];
  try {
    candidates = await findBibCandidates(ref.query);
  } catch (err) {
    console.error("[citations] bib lookup failed:", err);
  }

  // No candidates at all → no real work matched the query. Report not_found
  // without an extra LLM call (the matcher would only confirm the obvious).
  if (candidates.length === 0) {
    return {
      claim,
      cited_reference: ref.reference,
      status: "not_found",
      confidence: 0.75,
      rationale:
        "No matching work was found in Crossref or Semantic Scholar — likely a fabricated or mis-stated citation.",
      candidates: [],
    };
  }

  let match: RawMatch;
  try {
    match = await openaiJson<RawMatch>(
      CITATION_MATCHER_PROMPT,
      JSON.stringify({
        CITED: {
          reference: ref.reference,
          title: ref.title,
          authors: ref.authors,
          year: ref.year,
        },
        CANDIDATES: candidates.map((c, i) => ({
          index: i,
          title: c.title,
          authors: c.authors,
          year: c.year,
          venue: c.venue,
        })),
      }),
    );
  } catch (err) {
    console.error("[citations] matcher failed:", err);
    return {
      claim,
      cited_reference: ref.reference,
      status: "uncertain",
      confidence: 0.2,
      rationale:
        "Candidates were found but the matcher could not be reached — review manually.",
      candidates,
    };
  }

  const status = VALID_STATUS.includes(match.status as CitationStatus)
    ? (match.status as CitationStatus)
    : "uncertain";
  const bestIndex =
    typeof match.best_index === "number" &&
    Number.isInteger(match.best_index) &&
    match.best_index >= 0 &&
    match.best_index < candidates.length
      ? match.best_index
      : -1;

  return {
    claim,
    cited_reference: ref.reference,
    status,
    confidence: clamp01(match.confidence),
    rationale:
      asString(match.rationale) || "(no rationale provided by matcher)",
    best_match: bestIndex >= 0 ? candidates[bestIndex] : undefined,
    candidates,
  };
}

function summarize(checks: CitationCheck[]): CitationSummary {
  const counts = { verified: 0, not_found: 0, uncertain: 0 };
  for (const c of checks) counts[c.status]++;
  return {
    total: checks.length,
    verified: counts.verified,
    not_found: counts.not_found,
    uncertain: counts.uncertain,
  };
}

/**
 * Full citation check for a draft or bibliography. Extracts references, then
 * verifies each against scholarly indices in parallel.
 */
export async function checkCitations(text: string): Promise<CitationReport> {
  const refs = await extractReferences(text);
  const claims =
    refs.length === 0
      ? []
      : await Promise.all(refs.map((r, i) => checkOne(r, i)));
  return { claims, summary: summarize(claims) };
}
