import { openaiJson } from "@/lib/providers/openai";
import { CHALLENGE_PROMPT } from "@/lib/prompts/challenge";
import {
  type ChallengeResponseBody,
  type ChallengeStance,
  type ClaimAudit,
  type Verdict,
  MalformedLLMJsonError,
} from "@/types";

/**
 * B1: Challenge the verdict with your own source.
 *
 * The reviewer pastes evidence they think the audit missed; the locked auditor
 * re-judges the claim against THAT text only. No web search (the evidence is
 * user-supplied — CLAUDE.md rule 5), no mutation of the stored audit. One LLM
 * call. The result is advisory and surfaced in the interrogation thread.
 */

const VALID_STANCES: ChallengeStance[] = [
  "supports",
  "contradicts",
  "insufficient",
];

const VALID_VERDICTS: Verdict[] = [
  "verified",
  "unverified_plausible",
  "contradicted",
  "likely_hallucination",
];

// Bound the pasted evidence so one challenge stays a single cheap call.
const MAX_EVIDENCE_CHARS = 12_000;

interface RawChallengePayload {
  stance?: unknown;
  suggested_verdict?: unknown;
  reasoning?: unknown;
  quote?: unknown;
}

export async function challengeClaim(
  claimAudit: ClaimAudit,
  userEvidence: string,
  sourceUrl?: string,
): Promise<ChallengeResponseBody> {
  const evidence = userEvidence.slice(0, MAX_EVIDENCE_CHARS);

  const payload = JSON.stringify({
    CLAIM: {
      text: claimAudit.claim.text,
      sentence: claimAudit.claim.sentence,
      type: claimAudit.claim.type,
    },
    CURRENT_VERDICT: claimAudit.consensus_verdict,
    EVIDENCE: evidence,
    SOURCE_URL: sourceUrl ?? "",
  });

  const raw = await openaiJson<RawChallengePayload>(CHALLENGE_PROMPT, payload);

  if (!raw || typeof raw !== "object") {
    throw new MalformedLLMJsonError(
      "Challenge adjudicator returned a non-object payload.",
      JSON.stringify(raw).slice(0, 500),
    );
  }

  const stance: ChallengeStance = VALID_STANCES.includes(
    raw.stance as ChallengeStance,
  )
    ? (raw.stance as ChallengeStance)
    : "insufficient";

  // On an insufficient challenge the verdict is unchanged; otherwise trust the
  // model's advisory verdict if valid, else fall back conservatively.
  const suggested: Verdict = VALID_VERDICTS.includes(
    raw.suggested_verdict as Verdict,
  )
    ? (raw.suggested_verdict as Verdict)
    : stance === "insufficient"
      ? claimAudit.consensus_verdict
      : "unverified_plausible";

  const reasoning =
    typeof raw.reasoning === "string" && raw.reasoning.trim()
      ? raw.reasoning.trim()
      : "(no reasoning provided)";

  // Only honor a quote that is genuinely present in the supplied evidence.
  const rawQuote = typeof raw.quote === "string" ? raw.quote.trim() : "";
  const quote =
    stance !== "insufficient" && rawQuote && evidence.includes(rawQuote)
      ? rawQuote
      : "";

  return {
    stance,
    suggested_verdict: stance === "insufficient" ? claimAudit.consensus_verdict : suggested,
    reasoning,
    quote,
  };
}
