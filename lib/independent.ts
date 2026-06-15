import { openaiJson } from "@/lib/providers/openai";
import {
  CROSS_CHECK_PROMPT,
  INDEPENDENT_ANSWERER_PROMPT,
} from "@/lib/prompts/independent";
import {
  type Claim,
  type ClaimAudit,
  type IndependentCheck,
  type IndependentStance,
  type Verdict,
} from "@/types";

/**
 * Independent re-derivation cross-check (MAJOR_CHANGES.md #2).
 *
 * Pipeline contribution, kept deliberately separate from `lib/agents.ts`:
 *
 *   1. `deriveIndependentAnswer(prompt)` — the locked auditor answers the
 *      user's ORIGINAL question from scratch, never seeing the chat model's
 *      response. One LLM call.
 *   2. `crossCheckClaims(claims, answer)` — one batched LLM call labelling
 *      every claim supports / contradicts / absent against that answer.
 *   3. `applyIndependentCheck(audit, check)` — a PURE function that attaches
 *      the signal to a `ClaimAudit` and, when the independent answer
 *      contradicts a claim the three agents did not flag, escalates the
 *      verdict one severity step. This is the whole point: it rescues the
 *      documented "the lone correct dissenter gets outvoted" failure mode
 *      (README "Strict date/year verification can be outvoted") without
 *      adding a fourth verifier subagent.
 *
 * The three-agent consensus math in `lib/aggregate.ts` is untouched; this
 * runs after it and only ever moves a verdict in the more-cautious direction.
 */

const SEVERITY: Verdict[] = [
  "verified",
  "unverified_plausible",
  "contradicted",
  "likely_hallucination",
];

const VALID_STANCES: IndependentStance[] = ["supports", "contradicts", "absent"];

interface RawAnswer {
  answer?: unknown;
}

interface RawCrossCheck {
  checks?: Array<{ id?: unknown; stance?: unknown; note?: unknown }>;
}

/**
 * Ask the locked auditor to answer the user's question independently.
 * Returns "" if the model produced nothing usable — callers treat an empty
 * answer as "no independent signal available" and skip escalation.
 */
export async function deriveIndependentAnswer(
  originalPrompt: string,
): Promise<string> {
  const trimmed = originalPrompt.trim();
  if (!trimmed) return "";
  try {
    const raw = await openaiJson<RawAnswer>(
      INDEPENDENT_ANSWERER_PROMPT,
      `Question:\n\n"""${trimmed}"""`,
    );
    return typeof raw.answer === "string" ? raw.answer.trim() : "";
  } catch (err) {
    // A failed cross-check must never break the main audit. Degrade to "no
    // independent signal" rather than throwing.
    console.error("[independent] derive answer failed:", err);
    return "";
  }
}

/**
 * Compare each claim against the independent answer. Returns a map keyed by
 * claim id. Claims missing from the response default to "absent".
 */
export async function crossCheckClaims(
  claims: Claim[],
  independentAnswer: string,
): Promise<Map<string, { stance: IndependentStance; note: string }>> {
  const out = new Map<string, { stance: IndependentStance; note: string }>();
  if (claims.length === 0 || !independentAnswer.trim()) return out;

  const payload = JSON.stringify({
    INDEPENDENT_ANSWER: independentAnswer,
    CLAIMS: claims.map((c) => ({ id: c.id, text: c.text })),
  });

  let raw: RawCrossCheck;
  try {
    raw = await openaiJson<RawCrossCheck>(CROSS_CHECK_PROMPT, payload);
  } catch (err) {
    console.error("[independent] cross-check failed:", err);
    return out;
  }

  if (!Array.isArray(raw.checks)) return out;
  for (const entry of raw.checks) {
    const id = typeof entry.id === "string" ? entry.id : "";
    if (!id) continue;
    const stance = VALID_STANCES.includes(entry.stance as IndependentStance)
      ? (entry.stance as IndependentStance)
      : "absent";
    const note =
      typeof entry.note === "string" && entry.note.trim()
        ? entry.note.trim()
        : "";
    out.set(id, { stance, note });
  }
  return out;
}

/**
 * Attach the independent signal to a ClaimAudit and escalate the verdict if
 * the independent answer contradicts a claim the three agents did not flag.
 *
 * Escalation rule (conservative — only ever increases caution):
 *   - stance "contradicts" AND current verdict is "verified" →
 *       bump to "contradicted", escalated = true.
 *   - stance "contradicts" AND current verdict is "unverified_plausible" →
 *       bump to "contradicted", escalated = true.
 *   - otherwise: verdict unchanged, escalated = false.
 *
 * We never DOWNGRADE a verdict on a "supports" — a single independent agree
 * is not strong enough to overturn three searching agents that found a
 * contradiction. "supports"/"absent" only annotate.
 */
export function applyIndependentCheck(
  audit: ClaimAudit,
  signal: { stance: IndependentStance; note: string } | undefined,
): ClaimAudit {
  if (!signal) return audit;

  let verdict = audit.consensus_verdict;
  let escalated = false;

  if (
    signal.stance === "contradicts" &&
    (verdict === "verified" || verdict === "unverified_plausible")
  ) {
    verdict = "contradicted";
    escalated = true;
  }

  const independent_check: IndependentCheck = {
    stance: signal.stance,
    note: signal.note,
    escalated,
  };

  return {
    ...audit,
    consensus_verdict: verdict,
    // An escalation is a form of disagreement worth surfacing in the UI.
    agents_disagreed: audit.agents_disagreed || escalated,
    independent_check,
  };
}

export { SEVERITY as INDEPENDENT_SEVERITY };
