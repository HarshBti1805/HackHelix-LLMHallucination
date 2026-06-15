/**
 * Prompts for the citation / reference checker (MAJOR_CHANGES.md #8).
 *
 * Two locked-auditor (gpt-4o-mini) calls:
 *
 *   1. CITATION_EXTRACTOR_PROMPT — pull every distinct scholarly reference
 *      from a draft or bibliography and emit a clean search query for each.
 *   2. CITATION_MATCHER_PROMPT — given one cited reference and the candidate
 *      works returned by Crossref / Semantic Scholar, decide whether the
 *      cited work actually exists (verified / not_found / uncertain).
 *
 * The matcher NEVER consults its own memory of the literature — it judges only
 * against the supplied candidates. This is what lets it catch fabricated
 * citations: a made-up "Johnson et al. (2021)" returns no real candidate, so
 * the matcher must report `not_found`.
 */

export const CITATION_EXTRACTOR_PROMPT = `
You extract scholarly references from text. The input may be a bibliography, a
reference list, or prose with inline citations. Find every DISTINCT work that
is cited or listed as a reference.

For each reference, capture what the author stated and build a search query.

Do NOT invent references that are not in the text. Do NOT split one work into
multiple entries. Ignore non-scholarly URLs, footnotes that aren't citations,
and generic mentions ("studies show") that name no specific work.

For each reference return:
  - "reference": the citation as written, as close to verbatim as possible
    (authors, year, title, venue if present).
  - "title": the work's title if stated, else "".
  - "authors": author surname(s) if stated, else "".
  - "year": the year if stated, else "".
  - "query": the best bibliographic search query to find this work in a
    scholarly index — usually the title plus the first author surname. If no
    title is given, use authors + year + topic words.

OUTPUT — JSON ONLY, exactly:
{
  "references": [
    { "reference": "", "title": "", "authors": "", "year": "", "query": "" }
  ]
}
If the text contains no scholarly references, return { "references": [] }.
No commentary outside JSON.
`.trim();

export const CITATION_MATCHER_PROMPT = `
You decide whether a CITED reference corresponds to a real work, judging ONLY
against the CANDIDATE records supplied (each candidate is a real entry returned
by a scholarly index — Crossref or Semantic Scholar). Do NOT rely on your own
memory of the literature; if a real work is not among the candidates, you must
treat it as not found.

INPUT — a JSON object:
{
  "CITED": { "reference": "", "title": "", "authors": "", "year": "" },
  "CANDIDATES": [
    { "index": 0, "title": "", "authors": "", "year": "", "venue": "" }
  ]
}

Decide one status:
  - "verified":  a candidate clearly matches the cited work — the title is the
                 same work (allowing for minor wording/subtitle differences)
                 AND the authors and/or year are consistent. Set best_index to
                 that candidate's index.
  - "not_found": no candidate plausibly matches. This is the expected result
                 for a FABRICATED citation. best_index = -1.
  - "uncertain": candidates exist on a related topic but none clearly matches
                 the specific cited author/year/title — could be real-but-
                 obscure or a wrong citation. best_index = the closest, or -1.

Be strict about "verified": a candidate on the same broad topic but with a
different title/authors/year is NOT a match — that is "uncertain" or
"not_found". A mismatch in author surname or a year off by several years is a
strong signal the cited work does not exist as stated.

OUTPUT — JSON ONLY, exactly:
{
  "status": "verified" | "not_found" | "uncertain",
  "best_index": -1,
  "confidence": 0.0,
  "rationale": "<one short sentence>"
}
No commentary outside JSON.
`.trim();
