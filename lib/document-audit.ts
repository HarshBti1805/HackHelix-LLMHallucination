import { randomUUID } from "node:crypto";
import type { DocumentAudit } from "@/types";
import { runAuditPipeline } from "@/lib/audit";

/**
 * Default per-document cap on claims sent to the verifier.
 *
 * Chat messages cap at `MAX_CLAIMS_PER_MESSAGE = 6` (one chat turn rarely
 * carries more atomic factual assertions than that). Documents are
 * substantively longer and legitimately carry more claims, so the default
 * cap here is **25**. The cap is configurable via
 * `auditDocument(_, _, { maxClaims })` for two reasons:
 *
 *   1. The eval harness (IMPROVEMENTS.md Phase B) treats each chat-model
 *      response as a one-off "document" and may want a different cap to
 *      keep wall-clock and OpenAI bill predictable across providers.
 *   2. Smoke tests sometimes want to dial the cap WAY down (e.g. to 3) so
 *      a single end-to-end run completes in seconds rather than the
 *      ~minute that 25 parallel verify-fanouts can take.
 *
 * We deliberately do NOT raise the cap above 25 by default: each capped
 * claim spawns 3 subagents, each subagent issues 1 Tavily search + 1
 * OpenAI JSON-mode call, so a 25-claim document already fans out to
 * 75 + 75 = 150 upstream requests. Going higher tends to hit OpenAI
 * concurrency limits and produces ragged partial results.
 */
export const MAX_CLAIMS_PER_DOCUMENT = 25;

export interface AuditDocumentOptions {
  maxClaims?: number;
}

/**
 * Full audit pipeline for one uploaded / pasted document.
 *
 * Mirrors `auditMessage(messageId, content)` exactly — both call the
 * shared `runAuditPipeline` core in `lib/audit.ts`. The differences are
 * cosmetic (a higher default cap and a different envelope shape):
 *
 *   - Default `opts.maxClaims = MAX_CLAIMS_PER_DOCUMENT` (25, vs 6 for
 *     chat). Pass an explicit value in `opts` to override.
 *   - Stamps `document_id` (a server-generated UUID), `filename`, and
 *     the original `source_text` onto the returned `DocumentAudit`. The
 *     `source_text` is included in the response (and therefore in the
 *     downloaded JSON) so the report is self-contained — re-opening
 *     the audit later doesn't require the original file.
 *
 * Returns the same `claims` and `summary` shapes as the chat audit; the
 * `/document` page reuses the chat UI's claim-row + expandable per-agent
 * breakdown components verbatim. See IMPROVEMENTS.md Phase A task A.7.
 *
 * The entire extract → 3-agent-verify → aggregate pipeline is owned by
 * `lib/extract.ts`, `lib/agents.ts`, and `lib/aggregate.ts` — this
 * function does NOT import any of them directly. That indirection is
 * intentional: per CLAUDE.md core rule 5 evidence is gathered once by the
 * subagents and reused everywhere, and per IMPROVEMENTS.md Phase A
 * the document path "reuses lib/extract.ts, lib/agents.ts, and
 * lib/aggregate.ts unchanged — only the input surface and the output
 * view are new."
 */
export async function auditDocument(
  text: string,
  filename: string,
  opts: AuditDocumentOptions = {},
): Promise<DocumentAudit> {
  const maxClaims = opts.maxClaims ?? MAX_CLAIMS_PER_DOCUMENT;

  const { claims, summary } = await runAuditPipeline(text, maxClaims);

  return {
    document_id: randomUUID(),
    filename,
    source_text: text,
    claims,
    summary,
  };
}
