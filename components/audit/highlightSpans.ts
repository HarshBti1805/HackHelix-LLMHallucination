import type { ClaimAudit } from "@/types";

export interface HighlightSpan {
  start: number;
  end: number;
  claim: ClaimAudit;
}

export interface LocateClaimResult {
  /**
   * Highlight spans, sorted by `start` ascending. Non-overlapping by
   * construction — the locator skips any candidate position that would
   * collide with a previously placed span.
   */
  spans: HighlightSpan[];
  /**
   * Set of `claim.id` values whose `claim.sentence` could not be located
   * verbatim in the source text (or every occurrence collided with a
   * prior span). The `/document` page surfaces these on the right-column
   * `ClaimRow` with a muted "sentence not located in source" marker so
   * the audit result is never silently dropped.
   */
  notLocated: Set<string>;
}

/**
 * Locate each claim's `sentence` in the source document text using a
 * **first-occurrence-not-yet-claimed** match (IMPROVEMENTS.md Phase A
 * task A.8). For each claim, in extraction order:
 *
 *   1. Scan the source text from position 0 forward.
 *   2. For each `indexOf(sentence, cursor)` hit, check if the resulting
 *      span [hit, hit + sentence.length) overlaps any span placed by an
 *      earlier claim. If it does, advance the cursor past the hit and
 *      try the next occurrence; if it doesn't, claim that span.
 *   3. If no non-overlapping occurrence exists, mark the claim as
 *      not-located.
 *
 * Why this rule rather than e.g. fuzzy match: the extractor copies the
 * sentence verbatim into `claim.sentence` (lib/extract.ts) most of the
 * time, so verbatim search has very high recall on real documents
 * — the renewable-energy fixture has 100% verbatim hits in early
 * testing. The fallback to "not located" handles the case where the
 * extractor paraphrased instead of quoted, which is rare but does
 * happen on long sentences containing nested quotes.
 *
 * Pure function, no React imports — kept here in `components/audit/`
 * so the document page can import alongside the other shared audit
 * primitives, but trivially unit-testable in isolation.
 */
export function locateClaimSpans(
  text: string,
  claims: ClaimAudit[],
): LocateClaimResult {
  const spans: HighlightSpan[] = [];
  const notLocated = new Set<string>();

  for (const ca of claims) {
    const needle = ca.claim.sentence;
    if (!needle) {
      notLocated.add(ca.claim.id);
      continue;
    }

    let cursor = 0;
    let foundAt = -1;
    while (cursor <= text.length) {
      const idx = text.indexOf(needle, cursor);
      if (idx === -1) break;
      const end = idx + needle.length;
      // Overlap check: a candidate [idx, end) collides with an existing
      // span [s.start, s.end) iff NOT (end <= s.start || idx >= s.end).
      const overlap = spans.some(
        (s) => !(end <= s.start || idx >= s.end),
      );
      if (!overlap) {
        foundAt = idx;
        break;
      }
      cursor = idx + 1;
    }

    if (foundAt === -1) {
      notLocated.add(ca.claim.id);
    } else {
      spans.push({
        start: foundAt,
        end: foundAt + needle.length,
        claim: ca,
      });
    }
  }

  spans.sort((a, b) => a.start - b.start);
  return { spans, notLocated };
}
