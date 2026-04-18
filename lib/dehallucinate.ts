import { openaiJson } from "@/lib/providers/openai";
import { DEHALLUCINATOR_PROMPT } from "@/lib/prompts/dehallucinator";
import {
  type ClaimAudit,
  type EvidenceSource,
  type MessageAudit,
  type Verdict,
  MalformedLLMJsonError,
} from "@/types";

/**
 * Dehallucinator (PROJECT_PLAN.md task 4.1, ARCHITECTURE.md §5.7).
 *
 * Given an audited assistant message, build a *suggested prompt* the user
 * can send back through /api/chat to re-ask the same question with all
 * deduped audit evidence inlined, hallucinated claims quoted verbatim,
 * and explicit instructions to forbid invented citations + permit
 * abstention.
 *
 * This module does NOT regenerate the answer. The /api/dehallucinate
 * route returns the suggested prompt; the user reviews and edits it; only
 * after the user clicks "Send" does the client re-issue /api/chat. That
 * flow keeps the human in the loop, per CLAUDE.md ("Do not auto-send the
 * dehallucinate prompt").
 *
 * Selection rules:
 *   - Only claims with consensus_verdict ∈ {contradicted,
 *     likely_hallucination} are "failed" and worth dehallucinating.
 *   - Evidence is deduped by URL across the three subagents — if two
 *     agents cited the same URL, the prompt sees one entry.
 *   - Claims that have zero deduped evidence are STILL passed through to
 *     the LLM with `evidence: []`. The dehallucinator prompt has an
 *     explicit edge-case clause that renders this as "No corroborating
 *     evidence was found for this claim."
 *
 *     IMPORTANT — do not "fix" this by skipping evidenceless claims, even
 *     though a strict reading of the task description suggests it. The
 *     failure mode we most need to surface is fabricated citations
 *     ("Johnson et al. 2021…"), and by construction those fabricated
 *     citations have zero evidence — that's precisely WHY all three
 *     subagents return likely_hallucination. Skipping them would drop the
 *     verbatim quote of the bad sentence from the rewrite prompt, which
 *     is the most important user-facing affordance: the user has to be
 *     able to recognise *which* sentence went wrong before they can
 *     decide whether the regenerated answer fixed it. Confirmed
 *     empirically with the Johnson prompt on 2026-04-18 (PROJECT_PLAN.md
 *     task 4.5 testing): the no-evidence path produces a coherent rewrite
 *     prompt that quotes the fabricated citation and tells the model to
 *     describe the gap rather than invent a source.
 */

const FAILED_VERDICTS: ReadonlySet<Verdict> = new Set([
  "contradicted",
  "likely_hallucination",
]);

interface FailedClaimPayload {
  claim_text: string;
  original_sentence: string;
  verdict: Verdict;
  evidence: EvidenceSource[];
}

/**
 * Returns true if `audit` has at least one failed claim. Exported so the
 * UI can decide whether to render the "Regenerate" button without
 * duplicating the verdict-set definition.
 */
export function hasFailedClaims(audit: MessageAudit): boolean {
  return audit.claims.some((c) => FAILED_VERDICTS.has(c.consensus_verdict));
}

/** Dedupe a list of EvidenceSource objects by URL, preserving first-seen order. */
function dedupeByUrl(sources: EvidenceSource[]): EvidenceSource[] {
  const seen = new Set<string>();
  const out: EvidenceSource[] = [];
  for (const s of sources) {
    const key = (s.url ?? "").trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function toFailedClaimPayload(ca: ClaimAudit): FailedClaimPayload {
  // Aggregate sources across all three agents, then dedupe.
  const all = ca.per_agent_reports.flatMap((r) => r.sources ?? []);
  return {
    claim_text: ca.claim.text,
    original_sentence: ca.claim.sentence,
    verdict: ca.consensus_verdict,
    evidence: dedupeByUrl(all),
  };
}

export async function buildDehallucinatePrompt(input: {
  originalUserMessage: string;
  flawedResponse: string;
  audit: MessageAudit;
}): Promise<{ suggested_prompt: string }> {
  const failed = input.audit.claims
    .filter((c) => FAILED_VERDICTS.has(c.consensus_verdict))
    .map(toFailedClaimPayload);

  // The user payload is a single JSON document so the LLM doesn't have to
  // guess which field is which. The system prompt (DEHALLUCINATOR_PROMPT)
  // documents the exact shape it should expect to see here.
  const userPayload = JSON.stringify(
    {
      USER_QUESTION: input.originalUserMessage,
      FLAWED_RESPONSE: input.flawedResponse,
      FAILED_CLAIMS: failed,
    },
    null,
    2,
  );

  const raw = await openaiJson<{ suggested_prompt?: unknown }>(
    DEHALLUCINATOR_PROMPT,
    userPayload,
  );

  const prompt =
    raw && typeof raw.suggested_prompt === "string"
      ? raw.suggested_prompt.trim()
      : "";

  if (!prompt) {
    throw new MalformedLLMJsonError(
      "Dehallucinator JSON did not contain a non-empty `suggested_prompt` string.",
      JSON.stringify(raw).slice(0, 500),
    );
  }

  return { suggested_prompt: prompt };
}
