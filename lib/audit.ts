import type { AuditSummary, ClaimAudit, MessageAudit, Verdict } from "@/types";
import { extractClaims } from "@/lib/extract";
import { verifyClaim } from "@/lib/agents";

/**
 * Hard cap on claims verified per chat message. Per ARCHITECTURE.md §5.4 the
 * caller of `extractClaims` is responsible for capping; this constant is
 * the project-wide default for the chat path and lives here so the API
 * route stays thin.
 *
 * The cap is applied AFTER extraction (we still see how many claims the
 * extractor found) and BEFORE verification (so we never spawn more than
 * 6 × 3 = 18 concurrent OpenAI calls per message).
 *
 * The document path uses a higher cap (`MAX_CLAIMS_PER_DOCUMENT = 25`,
 * defined in `lib/document-audit.ts`) because a multi-paragraph document
 * legitimately carries more atomic claims than a single chat turn. Both
 * paths share the same orchestrator below — the cap is parameterized,
 * never forked.
 */
export const MAX_CLAIMS_PER_MESSAGE = 6;

/**
 * Shared audit-pipeline core.
 *
 * Both `auditMessage` (chat) and `auditDocument` (uploaded file / pasted
 * text) call this function. The only thing that varies between them is
 * the per-call claim cap and the identifying metadata stamped onto the
 * returned wrapper (`message_id` vs `document_id` + `filename` +
 * `source_text`). Keeping orchestration in exactly one place means a
 * future change to the parallelism strategy, the slicing rule, or the
 * summary roll-up touches one site, not two — see IMPROVEMENTS.md Phase A
 * "don't fork the orchestration logic" guidance.
 *
 * Sequence (ARCHITECTURE.md §4 SERVER /api/audit):
 *   1. extract.ts          → Claim[]
 *   2. cap to `maxClaims`
 *   3. for each claim, verifyClaim() in parallel:
 *        runAgent(prosecutor) ─┐
 *        runAgent(defender)   ─┼─ Promise.all → aggregate() → ClaimAudit
 *        runAgent(literalist) ─┘
 *   4. roll up per-verdict counts into AuditSummary.
 *
 * Two layers of parallelism: claims fan out via Promise.all, and within
 * each claim the three subagents fan out via Promise.all. For an N-claim
 * input the total wall-clock is roughly one subagent latency, not 3*N
 * — though for documents (N up to 25) the OpenAI / Tavily concurrency
 * limits start to bite and effective wall-clock is closer to a small
 * multiple of one agent latency.
 */
export async function runAuditPipeline(
  content: string,
  maxClaims: number,
): Promise<{ claims: ClaimAudit[]; summary: AuditSummary }> {
  const allClaims = await extractClaims(content);
  const claims = allClaims.slice(0, maxClaims);

  const claimAudits: ClaimAudit[] =
    claims.length === 0
      ? []
      : await Promise.all(claims.map((c) => verifyClaim(c)));

  return {
    claims: claimAudits,
    summary: summarizeClaims(claimAudits),
  };
}

/**
 * Full audit pipeline for one assistant chat message.
 *
 * Thin wrapper over `runAuditPipeline` that pins the cap at
 * `MAX_CLAIMS_PER_MESSAGE` and stamps the chat-side `message_id` onto
 * the returned envelope. Lives in lib/ rather than the API route so it
 * is unit-/smoke-testable without spinning up the Next server
 * (PROJECT_PLAN.md task 2.6).
 */
export async function auditMessage(
  messageId: string,
  content: string,
): Promise<MessageAudit> {
  const { claims, summary } = await runAuditPipeline(
    content,
    MAX_CLAIMS_PER_MESSAGE,
  );
  return {
    message_id: messageId,
    claims,
    summary,
  };
}

/**
 * Roll up a list of `ClaimAudit` into the per-verdict counts struct used
 * by both `MessageAudit.summary` and `DocumentAudit.summary`.
 *
 * Exported so `lib/document-audit.ts` can use it without re-implementing
 * the verdict-counting loop. Marked stable: any change to verdict strings
 * needs to update `Verdict` in `types.ts` first and this function follows.
 */
export function summarizeClaims(claims: ClaimAudit[]): AuditSummary {
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
