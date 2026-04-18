import type { EvidenceSource } from "@/types";
import { withCache } from "@/lib/cache";

/**
 * Tavily web-search wrapper.
 *
 * One responsibility: turn a query string into a list of `EvidenceSource`s.
 * Per CLAUDE.md this module contains zero LLM logic and zero auditor logic —
 * it's purely an HTTP client.
 *
 * The exported `search` is the cached version (no-op cache in production).
 * `searchUncached` is exposed for tests and for cases where freshness is
 * critical.
 */

const TAVILY_ENDPOINT = "https://api.tavily.com/search";

export interface SearchOptions {
  /**
   * Restrict results to these domains. Used by the Literalist subagent to
   * scope to high-trust sources (Wikipedia, *.gov, arxiv, etc.).
   */
  includeDomains?: string[];
  /** Default 5. Tavily caps at 20. */
  maxResults?: number;
  /** "basic" is faster + cheaper; "advanced" pulls more content per result. */
  searchDepth?: "basic" | "advanced";
}

interface TavilyRawResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

interface TavilyResponse {
  results: TavilyRawResult[];
  answer?: string | null;
  query?: string;
}

/**
 * Returns search results as `EvidenceSource[]`. On network or auth failure,
 * throws — the caller (typically a verifier subagent) decides whether an
 * empty evidence set should still produce an `unverified_plausible` verdict.
 */
export async function searchUncached(
  query: string,
  opts: SearchOptions = {},
): Promise<EvidenceSource[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error(
      "TAVILY_API_KEY is not set. Add it to .env.local before running.",
    );
  }
  if (!query.trim()) return [];

  const body: Record<string, unknown> = {
    query,
    search_depth: opts.searchDepth ?? "basic",
    max_results: opts.maxResults ?? 5,
    include_answer: false,
  };
  if (opts.includeDomains && opts.includeDomains.length > 0) {
    body.include_domains = opts.includeDomains;
  }

  const res = await fetch(TAVILY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Tavily search failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as TavilyResponse;
  if (!Array.isArray(data.results)) return [];

  return data.results.map((r) => ({
    url: r.url,
    title: r.title,
    snippet: r.content,
    domain: extractDomain(r.url),
  }));
}

export const search = withCache("tavily-search", searchUncached);

function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
