/**
 * Citation-sorting prompt (MAJOR_CHANGES.md #C1, "citations" mode).
 *
 * For ONE claim, given a list of real web sources already retrieved (title +
 * snippet + url), decide which sources SUPPORT the claim and which CONTRADICT
 * it. The model selects by INDEX into the provided list — it can never invent a
 * URL, so every returned citation is a real retrieved source (CLAUDE.md rule:
 * no fabricated citations, ever).
 *
 * Runs on the locked auditor (gpt-4o-mini, JSON mode).
 */

export const CITATION_SORT_PROMPT = `
You are assembling an evidence dossier for a single CLAIM. You are given SOURCES
that were retrieved from the web (each has an index, title, url, and snippet).

Classify ONLY by what each snippet actually says:
  - A source SUPPORTS the claim if its snippet states or clearly backs it.
  - A source CONTRADICTS the claim if its snippet states something incompatible
    (different number, opposite finding, refutation).
  - Ignore sources that are off-topic or merely adjacent (do not force a side).

Never invent sources. Refer to sources only by their given index.

INPUT — JSON:
{
  "CLAIM": "<the claim, one sentence>",
  "SOURCES": [ { "index": 0, "title": "...", "url": "...", "snippet": "..." }, ... ]
}

OUTPUT — JSON ONLY:
{
  "stance_summary": "<one sentence: does the gathered evidence mostly support,
                      mostly contradict, or remain mixed/insufficient for this claim>",
  "supporting": [<indices that support>],
  "contradicting": [<indices that contradict>]
}
Indices MUST be valid indices from SOURCES. No commentary outside the JSON.
`.trim();
