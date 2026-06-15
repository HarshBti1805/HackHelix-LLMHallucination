import { openaiJson } from "@/lib/providers/openai";
import { extractClaims } from "@/lib/extract";
import { GROUNDEDNESS_PROMPT } from "@/lib/prompts/groundedness";
import {
  type Claim,
  type GroundedClaim,
  type GroundednessAudit,
  type GroundednessSummary,
  type GroundingVerdict,
  MalformedLLMJsonError,
} from "@/types";

/**
 * Groundedness / RAG guardrail (MAJOR_CHANGES.md #10).
 *
 * Distinct from the web-audit pipeline: it never searches. It asks only
 * "is this answer faithful to the source material the operator provided?".
 * Two LLM calls total — extract claims from the answer, then one batched
 * grading call against the context — so it stays cheap enough to sit inline
 * as a guardrail before showing chatbot output to an end user.
 *
 * Reuses `lib/extract.ts` so a claim means the same thing here as in the
 * main pipeline. The grading model is the locked auditor (gpt-4o-mini).
 */

const VALID_VERDICTS: GroundingVerdict[] = [
  "grounded",
  "ungrounded",
  "contradicted",
];

// A guardrail input can carry more atomic claims than a single chat turn but
// we still cap to keep one call's token budget and latency bounded.
const MAX_GROUNDEDNESS_CLAIMS = 30;

interface RawGradeRow {
  id?: unknown;
  verdict?: unknown;
  confidence?: unknown;
  supporting_quote?: unknown;
  rationale?: unknown;
}

interface RawGradePayload {
  results?: RawGradeRow[];
}

function clamp01(n: unknown): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function summarize(claims: GroundedClaim[]): GroundednessSummary {
  const counts = { grounded: 0, ungrounded: 0, contradicted: 0 };
  for (const c of claims) counts[c.verdict]++;
  return {
    total_claims: claims.length,
    grounded: counts.grounded,
    ungrounded: counts.ungrounded,
    contradicted: counts.contradicted,
  };
}

/**
 * Grade a set of claims against the provided context in one batched call.
 * Claims missing from the model's response default to "ungrounded" (the
 * cautious choice — an answer we couldn't confirm is treated as unsupported).
 */
async function gradeClaims(
  claims: Claim[],
  context: string,
): Promise<GroundedClaim[]> {
  if (claims.length === 0) return [];

  const payload = JSON.stringify({
    CONTEXT: context,
    CLAIMS: claims.map((c) => ({ id: c.id, text: c.text })),
  });

  const raw = await openaiJson<RawGradePayload>(GROUNDEDNESS_PROMPT, payload);
  if (!raw || !Array.isArray(raw.results)) {
    throw new MalformedLLMJsonError(
      "Groundedness grader did not return a `results` array.",
      JSON.stringify(raw).slice(0, 500),
    );
  }

  const byId = new Map<string, RawGradeRow>();
  for (const row of raw.results) {
    if (row && typeof row.id === "string") byId.set(row.id, row);
  }

  return claims.map((claim) => {
    const row = byId.get(claim.id);
    const verdict =
      row && VALID_VERDICTS.includes(row.verdict as GroundingVerdict)
        ? (row.verdict as GroundingVerdict)
        : "ungrounded";
    const supporting_quote =
      row && typeof row.supporting_quote === "string"
        ? row.supporting_quote.trim()
        : "";
    const rationale =
      row && typeof row.rationale === "string" && row.rationale.trim()
        ? row.rationale.trim()
        : verdict === "ungrounded"
          ? "No supporting span found in the provided context."
          : "(no rationale provided)";
    return {
      claim,
      verdict,
      confidence: row ? clamp01(row.confidence) : 0,
      // Never trust a quote the grader claims for an ungrounded verdict.
      supporting_quote: verdict === "ungrounded" ? "" : supporting_quote,
      rationale,
    };
  });
}

/**
 * Full groundedness check: extract claims from `answer`, grade each against
 * `context`. Returns a `GroundednessAudit` mirroring the shape of the web
 * audit so the UI can render it with familiar verdict pills.
 */
export async function checkGroundedness(
  answer: string,
  context: string,
  sourceLabel = "(pasted answer)",
): Promise<GroundednessAudit> {
  const allClaims = await extractClaims(answer);
  const claims = allClaims.slice(0, MAX_GROUNDEDNESS_CLAIMS);
  const graded = await gradeClaims(claims, context);
  return {
    source_label: sourceLabel,
    claims: graded,
    summary: summarize(graded),
  };
}
