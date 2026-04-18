import type { ClaimAudit, MessageAudit, Verdict } from "@/types";
import { extractClaims } from "@/lib/extract";
import { verifyClaim } from "@/lib/agents";

/**
 * Hard cap on claims verified per message. Per ARCHITECTURE.md §5.4 the
 * caller of `extractClaims` is responsible for capping; this constant is
 * the project-wide default and lives here so the API route stays thin.
 *
 * The cap is applied AFTER extraction (we still see how many claims the
 * extractor found) and BEFORE verification (so we never spawn more than
 * 6 × 3 = 18 concurrent OpenAI calls per message).
 */
export const MAX_CLAIMS_PER_MESSAGE = 6;

/**
 * Full audit pipeline for one assistant message.
 *
 * Sequence (ARCHITECTURE.md §4 SERVER /api/audit):
 *   1. extract.ts          → Claim[]
 *   2. for each claim, verifyClaim() in parallel:
 *        runAgent(prosecutor) ─┐
 *        runAgent(defender)   ─┼─ Promise.all → aggregate() → ClaimAudit
 *        runAgent(literalist) ─┘
 *   3. roll up per-verdict counts into MessageAudit.summary.
 *
 * Two layers of parallelism: claims fan out via Promise.all, and within each
 * claim the three subagents fan out via Promise.all. For an N-claim message
 * the total wall-clock is roughly one subagent latency, not 3*N.
 *
 * Lives in lib/ rather than the API route so it is unit-/smoke-testable
 * without spinning up the Next server (PROJECT_PLAN.md task 2.6) and so the
 * route handler in task 2.9 stays a thin HTTP wrapper.
 */
export async function auditMessage(
  messageId: string,
  content: string,
): Promise<MessageAudit> {
  const allClaims = await extractClaims(content);
  const claims = allClaims.slice(0, MAX_CLAIMS_PER_MESSAGE);

  const claimAudits: ClaimAudit[] =
    claims.length === 0
      ? []
      : await Promise.all(claims.map((c) => verifyClaim(c)));

  return {
    message_id: messageId,
    claims: claimAudits,
    summary: summarize(claimAudits),
  };
}

function summarize(
  claims: ClaimAudit[],
): MessageAudit["summary"] {
  const counts: Record<Verdict, number> = {
    verified: 0,
    unverified_plausible: 0,
    contradicted: 0,
    likely_hallucination: 0,
  };
  for (const c of claims) counts[c.consensus_verdict]++;
  return {
    total_claims: claims.length,
    verified: counts.verified,
    unverified_plausible: counts.unverified_plausible,
    contradicted: counts.contradicted,
    likely_hallucination: counts.likely_hallucination,
  };
}
