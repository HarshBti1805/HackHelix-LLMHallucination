import { openaiJson } from "@/lib/providers/openai";
import { DEHALLUCINATOR_DOCUMENT_PROMPT } from "@/lib/prompts/dehallucinator-document";
import {
  type ClaimAudit,
  type DocumentAudit,
  type DocumentRevision,
  type DocumentRevisions,
  type EvidenceSource,
  type Verdict,
  MalformedLLMJsonError,
} from "@/types";

/**
 * Document dehallucinator (sibling of `lib/dehallucinate.ts`).
 *
 * Takes a `DocumentAudit` plus the original source text and asks
 * gpt-4o-mini to produce a *surgical* per-sentence replacement for each
 * failed claim. The output is a `DocumentRevisions` envelope: a list of
 * `DocumentRevision` cards (one per failed claim that the model was able
 * to ground or honestly abstain on) plus an `unrevisable_claims` list for
 * the residue.
 *
 * Why a separate module from the chat dehallucinator:
 *
 *   - The chat path returns a *single suggested prompt* the user sends
 *     back through /api/chat. The whole chat response is regenerated.
 *
 *   - The document path must be *additive only*. Verified and
 *     unverified-plausible sentences MUST stay byte-identical; only the
 *     handful of sentences that failed the audit are touched. That makes
 *     a "rewrite the whole document" approach actively wrong here — see
 *     CLAUDE.md "Document dehallucination is surgical".
 *
 * Like the chat dehallucinator, this module:
 *   - Fires exactly ONE LLM call per request (CLAUDE.md core rule 6:
 *     "Do not make multiple LLM calls").
 *   - Uses gpt-4o-mini in JSON mode (no provider switching — the auditor
 *     side of the system is locked to OpenAI per CLAUDE.md core rule 2).
 *   - Catches malformed JSON and surfaces it as `MalformedLLMJsonError`
 *     so the API route can map it to a 502 (upstream LLM failure) rather
 *     than a generic 500.
 */

const FAILED_VERDICTS: ReadonlySet<Verdict> = new Set([
  "contradicted",
  "likely_hallucination",
]);

interface FailedClaimPayload {
  claim_id: string;
  claim_text: string;
  original_sentence: string;
  verdict: Verdict;
  evidence: EvidenceSource[];
}

/**
 * Returns true if `audit` has at least one failed claim. Exported so the
 * UI can decide whether to render the "Dehallucinate document" button
 * without re-defining the failed-verdict set in two places.
 */
export function hasFailedClaims(audit: DocumentAudit): boolean {
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
  const all = ca.per_agent_reports.flatMap((r) => r.sources ?? []);
  return {
    claim_id: ca.claim.id,
    claim_text: ca.claim.text,
    original_sentence: ca.claim.sentence,
    verdict: ca.consensus_verdict,
    evidence: dedupeByUrl(all),
  };
}

/**
 * Runtime guard: a record from the LLM that smells like a DocumentRevision.
 *
 * We don't trust the model output blindly even though it's JSON-mode — the
 * shape might still drift, fields might be empty, or `verdict` might be
 * something nonsensical. Anything that fails this guard is treated as if
 * the model produced no revision for that claim.
 */
function isRevisionLike(value: unknown): value is {
  claim_id: string;
  original_sentence: string;
  replacement_sentence: string;
  rationale?: unknown;
  verdict?: unknown;
} {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.claim_id === "string" &&
    v.claim_id.trim().length > 0 &&
    typeof v.original_sentence === "string" &&
    v.original_sentence.trim().length > 0 &&
    typeof v.replacement_sentence === "string" &&
    v.replacement_sentence.trim().length > 0
  );
}

function isUnrevisableLike(value: unknown): value is {
  claim_id: string;
  reason?: unknown;
} {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.claim_id === "string" && v.claim_id.trim().length > 0;
}

/**
 * Single-shot LLM call: build per-failed-claim revisions for a document.
 *
 * Steps:
 *   1. Filter the audit's claims to the failed set (contradicted +
 *      likely_hallucination).
 *   2. For each failed claim, gather and dedupe the evidence its three
 *      subagents collected (CLAUDE.md core rule 5: evidence is gathered
 *      once and reused everywhere).
 *   3. Send one JSON-mode call to gpt-4o-mini with the full document
 *      text plus the failed-claim payloads. The prompt enforces:
 *        - surgical, sentence-for-sentence replacements;
 *        - no rewriting, no editorializing;
 *        - honest abstention when evidence is insufficient;
 *        - the verbatim anti-fabrication clause from the chat path.
 *   4. Validate / sanitize the model output. We override `verdict` with
 *      the authoritative value from the audit (the model is asked to
 *      echo it back, but we don't rely on it). We also build the union
 *      of revisions ∪ unrevisable_claims and ensure every input claim
 *      appears exactly once — claims the model silently dropped end up
 *      in `unrevisable_claims` with a generic reason.
 */
export async function buildDocumentRevisions(input: {
  sourceText: string;
  filename: string;
  audit: DocumentAudit;
}): Promise<DocumentRevisions> {
  const failedClaims = input.audit.claims.filter((c) =>
    FAILED_VERDICTS.has(c.consensus_verdict),
  );

  // Short-circuit: no work to do. The /document UI is supposed to gate on
  // hasFailedClaims() so this should be very rare in practice, but the API
  // route handles it gracefully too.
  if (failedClaims.length === 0) {
    return { revisions: [], unrevisable_claims: [] };
  }

  const failedPayload = failedClaims.map(toFailedClaimPayload);

  const userPayload = JSON.stringify(
    {
      DOCUMENT_FILENAME: input.filename,
      DOCUMENT_TEXT: input.sourceText,
      FAILED_CLAIMS: failedPayload,
    },
    null,
    2,
  );

  const raw = await openaiJson<{
    revisions?: unknown;
    unrevisable_claims?: unknown;
  }>(DEHALLUCINATOR_DOCUMENT_PROMPT, userPayload);

  if (!raw || typeof raw !== "object") {
    throw new MalformedLLMJsonError(
      "Document dehallucinator returned a non-object JSON payload.",
      JSON.stringify(raw).slice(0, 500),
    );
  }

  const rawRevisions = Array.isArray(raw.revisions) ? raw.revisions : [];
  const rawUnrevisable = Array.isArray(raw.unrevisable_claims)
    ? raw.unrevisable_claims
    : [];

  // Build a quick lookup of authoritative metadata per failed claim so we
  // can (a) override the model's echoed verdict with the value from the
  // audit and (b) detect input claims the model silently dropped.
  const authoritativeByClaimId = new Map<string, ClaimAudit>();
  for (const c of failedClaims) {
    authoritativeByClaimId.set(c.claim.id, c);
  }

  const seenClaimIds = new Set<string>();

  const revisions: DocumentRevision[] = [];
  for (const r of rawRevisions) {
    if (!isRevisionLike(r)) continue;
    const auth = authoritativeByClaimId.get(r.claim_id);
    if (!auth) continue; // model invented a claim_id we never sent — drop it
    if (seenClaimIds.has(r.claim_id)) continue; // duplicate — keep first
    seenClaimIds.add(r.claim_id);

    revisions.push({
      claim_id: r.claim_id,
      original_sentence: r.original_sentence.trim(),
      replacement_sentence: r.replacement_sentence.trim(),
      rationale:
        typeof r.rationale === "string" && r.rationale.trim().length > 0
          ? r.rationale.trim()
          : "Replacement chosen based on the gathered evidence.",
      // Authoritative verdict from the audit — never trust the model's echo.
      verdict: auth.consensus_verdict,
    });
  }

  const unrevisable: { claim_id: string; reason: string }[] = [];
  for (const u of rawUnrevisable) {
    if (!isUnrevisableLike(u)) continue;
    if (!authoritativeByClaimId.has(u.claim_id)) continue;
    if (seenClaimIds.has(u.claim_id)) continue; // already produced a revision
    seenClaimIds.add(u.claim_id);
    unrevisable.push({
      claim_id: u.claim_id,
      reason:
        typeof u.reason === "string" && u.reason.trim().length > 0
          ? u.reason.trim()
          : "The model could not ground a replacement for this claim.",
    });
  }

  // Sweep: any failed claim the model didn't mention at all goes into the
  // unrevisable list with a generic reason. Surfacing them is the point —
  // silently dropping a flagged claim would mislead the user into thinking
  // there was nothing wrong.
  for (const c of failedClaims) {
    if (seenClaimIds.has(c.claim.id)) continue;
    seenClaimIds.add(c.claim.id);
    unrevisable.push({
      claim_id: c.claim.id,
      reason:
        "The model did not return a revision for this claim. It may need manual editing.",
    });
  }

  // Stable order: revisions in original audit order, then unrevisable in
  // original audit order. Makes the modal predictable and the e2e tests
  // deterministic.
  const orderById = new Map<string, number>();
  failedClaims.forEach((c, i) => orderById.set(c.claim.id, i));
  revisions.sort(
    (a, b) =>
      (orderById.get(a.claim_id) ?? 0) - (orderById.get(b.claim_id) ?? 0),
  );
  unrevisable.sort(
    (a, b) =>
      (orderById.get(a.claim_id) ?? 0) - (orderById.get(b.claim_id) ?? 0),
  );

  return { revisions, unrevisable_claims: unrevisable };
}
