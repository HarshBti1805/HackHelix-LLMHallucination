import type { ClaimAudit, Verdict } from "@/types";

/**
 * Claim-level diff between a "before" and "after" `MessageAudit`.
 *
 * Pure module — no React imports — so it can be unit tested in isolation
 * and reused from any rendering surface (the new `ComparisonSidebar`,
 * future eval scripts, etc).
 *
 * Matching strategy:
 *   We don't have stable claim ids across before/after — both audits
 *   come from independent extractor runs. We approximate identity by
 *   **entity-token overlap**: if `before.claim.entities` and
 *   `after.claim.entities` share at least one case-folded token, the
 *   claims are candidates for a match. The matcher is greedy on highest
 *   overlap first, with each side's claim consumed at most once.
 *
 * Tone derivation (used by both column highlights and the ledger):
 *   - improved : the claim went from a failed verdict to a non-failed
 *     verdict (or contradicted → likely_hallucination's reverse). Highlights green.
 *   - worsened : the claim went from non-failed to failed, or stayed
 *     failed across both runs (the dehallucinator failed to fix it).
 *     Highlights red.
 *   - none     : everything else — verdict unchanged in a non-failed
 *     state, or a small lateral move like unverified ↔ verified.
 *     Renders without a colored highlight.
 *
 * The user-facing copy in `ARCHITECTURE.md` and the repo's verdict
 * semantics treat `contradicted` and `likely_hallucination` as the two
 * "failed" buckets; this module honours that split.
 */

export type DiffTone = "improved" | "worsened" | "none";

export interface MatchedPair {
  before: ClaimAudit;
  after: ClaimAudit;
  /** Number of entity-tokens the two claims share (case-folded). */
  overlap: number;
}

export interface ClaimDiff {
  matched: MatchedPair[];
  eliminated: ClaimAudit[];
  introduced: ClaimAudit[];
  /**
   * Per-claim tone, keyed by the original `ClaimAudit.claim.id` from
   * either side. The same id maps to the same tone whether you look it
   * up from the before-side claim or the after-side claim of a matched
   * pair, so `ComparisonColumn` can render either column without
   * needing to know which side it's rendering.
   */
  toneById: Map<string, DiffTone>;
}

const FAILED_VERDICTS = new Set<Verdict>([
  "contradicted",
  "likely_hallucination",
]);

function isFailed(v: Verdict): boolean {
  return FAILED_VERDICTS.has(v);
}

/**
 * Tone for a single matched (or unmatched) pair. Exposed so the ledger
 * can colour its arrow without re-running the whole diff.
 */
export function toneFor(
  before: Verdict | undefined,
  after: Verdict | undefined,
): DiffTone {
  if (before && after) {
    const bF = isFailed(before);
    const aF = isFailed(after);
    if (bF && !aF) return "improved";
    if (!bF && aF) return "worsened";
    if (bF && aF) {
      // Both still failed. Going contradicted → likely_hallucination is
      // strictly worse; the reverse is a small win. Same verdict counts
      // as "stayed failed" → worsened so the highlight signals that the
      // dehallucinator didn't move the needle.
      if (before === after) return "worsened";
      if (before === "contradicted" && after === "likely_hallucination") {
        return "worsened";
      }
      return "improved";
    }
    return "none"; // both non-failed, lateral or no change
  }

  if (before && !after) {
    // Eliminated. If it was a failed claim being dropped, treat that as
    // an improvement (the dehallucinator removed a problem); otherwise
    // it's just gone, no tone.
    return isFailed(before) ? "improved" : "none";
  }
  if (!before && after) {
    // Introduced. If it lands as failed, that's a regression worth
    // flagging in the After column; if it lands clean, no tone.
    return isFailed(after) ? "worsened" : "none";
  }
  return "none";
}

function tokenize(entities: string[]): Set<string> {
  const out = new Set<string>();
  for (const raw of entities) {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed) out.add(trimmed);
  }
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

export function diffClaims(
  beforeClaims: ClaimAudit[],
  afterClaims: ClaimAudit[],
): ClaimDiff {
  // Pre-tokenize to avoid O(n²m) string work in the inner loop.
  const beforeTokens = beforeClaims.map((c) => tokenize(c.claim.entities));
  const afterTokens = afterClaims.map((c) => tokenize(c.claim.entities));

  // All candidate pairs with overlap >= 1, then greedy match by highest
  // overlap. Ties are broken by encounter order (stable sort) which keeps
  // the result deterministic for unit tests.
  const candidates: { b: number; a: number; overlap: number }[] = [];
  for (let i = 0; i < beforeClaims.length; i++) {
    for (let j = 0; j < afterClaims.length; j++) {
      const o = overlap(beforeTokens[i], afterTokens[j]);
      if (o >= 1) candidates.push({ b: i, a: j, overlap: o });
    }
  }
  candidates.sort((x, y) => y.overlap - x.overlap);

  const usedB = new Set<number>();
  const usedA = new Set<number>();
  const matched: MatchedPair[] = [];

  for (const c of candidates) {
    if (usedB.has(c.b) || usedA.has(c.a)) continue;
    usedB.add(c.b);
    usedA.add(c.a);
    matched.push({
      before: beforeClaims[c.b],
      after: afterClaims[c.a],
      overlap: c.overlap,
    });
  }

  const eliminated = beforeClaims.filter((_, i) => !usedB.has(i));
  const introduced = afterClaims.filter((_, j) => !usedA.has(j));

  // Per-claim-id tone map. Both sides of a matched pair share the same
  // tone, so the highlighter doesn't need to know whether it's looking
  // at the before- or after-side claim.
  const toneById = new Map<string, DiffTone>();
  for (const pair of matched) {
    const t = toneFor(
      pair.before.consensus_verdict,
      pair.after.consensus_verdict,
    );
    toneById.set(pair.before.claim.id, t);
    toneById.set(pair.after.claim.id, t);
  }
  for (const elim of eliminated) {
    toneById.set(elim.claim.id, toneFor(elim.consensus_verdict, undefined));
  }
  for (const intro of introduced) {
    toneById.set(intro.claim.id, toneFor(undefined, intro.consensus_verdict));
  }

  return { matched, eliminated, introduced, toneById };
}
