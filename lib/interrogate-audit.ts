import { openaiJson } from "@/lib/providers/openai";
import { INTERROGATE_AUDIT_PROMPT } from "@/lib/prompts/interrogate-audit";
import {
  type InterrogateAuditResponseBody,
  type InterrogationTurn,
  type MessageAudit,
  MalformedLLMJsonError,
} from "@/types";

/**
 * B2: Interrogate the whole response.
 *
 * Lets a reviewer ask about an entire audited response rather than one claim.
 * Grounded only in the per-claim audit results already computed (no web
 * re-search, CLAUDE.md rule 5). One LLM call per question.
 */

const MAX_HISTORY_TURNS = 10;
// Keep one reason line per claim short so a big audit still fits one call.
const MAX_REASON_CHARS = 240;

interface RawPayload {
  answer?: unknown;
  cited_claim_ids?: unknown;
  abstained?: unknown;
}

/**
 * Pick the most representative one-line reason for a claim: prefer the report
 * whose verdict matches the consensus, else the first report.
 */
function claimReason(
  reports: MessageAudit["claims"][number]["per_agent_reports"],
  consensus: string,
): string {
  const match = reports.find((r) => r.verdict === consensus) ?? reports[0];
  const text = match?.reasoning ?? "";
  return text.replace(/\s+/g, " ").slice(0, MAX_REASON_CHARS);
}

export async function interrogateAudit(
  audit: MessageAudit,
  history: InterrogationTurn[],
  question: string,
): Promise<InterrogateAuditResponseBody> {
  const trimmedHistory = history
    .slice(-MAX_HISTORY_TURNS)
    .map((t) => ({ role: t.role, content: t.content }));

  const validIds = new Set(audit.claims.map((c) => c.claim.id));

  const payload = JSON.stringify({
    SUMMARY: audit.summary,
    CLAIMS: audit.claims.map((c) => ({
      id: c.claim.id,
      text: c.claim.text,
      verdict: c.consensus_verdict,
      confidence: c.consensus_confidence,
      agents_disagreed: c.agents_disagreed,
      reason: claimReason(c.per_agent_reports, c.consensus_verdict),
    })),
    HISTORY: trimmedHistory,
    QUESTION: question,
  });

  const raw = await openaiJson<RawPayload>(INTERROGATE_AUDIT_PROMPT, payload);

  if (!raw || typeof raw.answer !== "string" || raw.answer.trim().length === 0) {
    throw new MalformedLLMJsonError(
      "Audit interrogator did not return a non-empty `answer` string.",
      JSON.stringify(raw).slice(0, 500),
    );
  }

  const citedClaimIds = Array.isArray(raw.cited_claim_ids)
    ? raw.cited_claim_ids.filter(
        (id): id is string => typeof id === "string" && validIds.has(id),
      )
    : [];

  return {
    answer: raw.answer.trim(),
    cited_claim_ids: Array.from(new Set(citedClaimIds)),
    abstained: raw.abstained === true,
  };
}
