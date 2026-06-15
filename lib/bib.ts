import type { CitationCandidate } from "@/types";

/**
 * Bibliographic index clients for the citation checker (MAJOR_CHANGES.md #8).
 *
 * Unlike `lib/search.ts` (Tavily web search), these hit scholarly metadata
 * APIs that return STRUCTURED records of works that actually exist:
 *   - Crossref       (api.crossref.org)       — DOIs, journals, books. No key.
 *   - Semantic Scholar (api.semanticscholar.org) — papers across venues. No key
 *                     (rate-limited; we tolerate failures gracefully).
 *
 * This module contains zero LLM logic — it only turns a query string into a
 * list of `CitationCandidate`s. The decision of whether a candidate actually
 * MATCHES a cited reference is made by the LLM matcher in `lib/citations.ts`.
 *
 * Every fetch is wrapped in a timeout and a try/catch: a citation check must
 * degrade to "no candidates found" rather than throw, so one slow index never
 * sinks the whole report.
 */

const CROSSREF_ENDPOINT = "https://api.crossref.org/works";
const S2_ENDPOINT = "https://api.semanticscholar.org/graph/v1/paper/search";
const PER_SOURCE_LIMIT = 4;
const TIMEOUT_MS = 8000;

// Crossref asks API users to identify themselves (the "polite pool"). A mailto
// is optional but recommended; falls back to a generic UA otherwise.
const CONTACT =
  process.env.CROSSREF_CONTACT_EMAIL ?? "groundtruth-auditor@example.com";

async function fetchJson(url: string, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface CrossrefAuthor {
  given?: string;
  family?: string;
}
interface CrossrefItem {
  title?: string[];
  author?: CrossrefAuthor[];
  issued?: { "date-parts"?: number[][] };
  "container-title"?: string[];
  URL?: string;
  DOI?: string;
}

function crossrefToCandidate(item: CrossrefItem): CitationCandidate {
  const title = item.title?.[0]?.trim() ?? "(untitled)";
  const authors = (item.author ?? [])
    .map((a) => [a.given, a.family].filter(Boolean).join(" ").trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(", ");
  const year = item.issued?.["date-parts"]?.[0]?.[0]
    ? String(item.issued["date-parts"][0][0])
    : "";
  const venue = item["container-title"]?.[0]?.trim() ?? "";
  const url =
    item.URL ?? (item.DOI ? `https://doi.org/${item.DOI}` : "");
  return { title, authors, year, venue, url, source: "crossref" };
}

async function searchCrossref(query: string): Promise<CitationCandidate[]> {
  const params = new URLSearchParams({
    "query.bibliographic": query,
    rows: String(PER_SOURCE_LIMIT),
    select: "title,author,issued,container-title,URL,DOI",
    mailto: CONTACT,
  });
  const data = (await fetchJson(`${CROSSREF_ENDPOINT}?${params.toString()}`, {
    "User-Agent": `Groundtruth/1.0 (mailto:${CONTACT})`,
  })) as { message?: { items?: CrossrefItem[] } } | null;
  const items = data?.message?.items ?? [];
  return items.map(crossrefToCandidate);
}

interface S2Author {
  name?: string;
}
interface S2Paper {
  title?: string;
  authors?: S2Author[];
  year?: number;
  venue?: string;
  url?: string;
}

async function searchSemanticScholar(
  query: string,
): Promise<CitationCandidate[]> {
  const params = new URLSearchParams({
    query,
    limit: String(PER_SOURCE_LIMIT),
    fields: "title,authors,year,venue,url",
  });
  const headers: Record<string, string> = {};
  if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
    headers["x-api-key"] = process.env.SEMANTIC_SCHOLAR_API_KEY;
  }
  const data = (await fetchJson(
    `${S2_ENDPOINT}?${params.toString()}`,
    headers,
  )) as { data?: S2Paper[] } | null;
  const papers = data?.data ?? [];
  return papers.map((p) => ({
    title: p.title?.trim() ?? "(untitled)",
    authors: (p.authors ?? [])
      .map((a) => a.name?.trim())
      .filter(Boolean)
      .slice(0, 4)
      .join(", "),
    year: p.year ? String(p.year) : "",
    venue: p.venue?.trim() ?? "",
    url: p.url ?? "",
    source: "semanticscholar" as const,
  }));
}

/**
 * Query every index in parallel and return the union of candidates. Dedupes
 * by normalized title so the same paper from two indices doesn't show twice.
 */
export async function findBibCandidates(
  query: string,
): Promise<CitationCandidate[]> {
  if (!query.trim()) return [];
  const [crossref, s2] = await Promise.all([
    searchCrossref(query),
    searchSemanticScholar(query),
  ]);

  const seen = new Set<string>();
  const merged: CitationCandidate[] = [];
  for (const cand of [...crossref, ...s2]) {
    const key = cand.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push(cand);
  }
  return merged;
}
