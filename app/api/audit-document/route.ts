import { NextRequest, NextResponse } from "next/server";
import { auditDocument } from "@/lib/document-audit";
import {
  MalformedLLMJsonError,
  type AuditDocumentRequestBody,
} from "@/types";

/**
 * POST /api/audit-document
 *
 * Thin HTTP wrapper around `lib/document-audit.auditDocument`. Mirrors
 * `/api/audit` (chat path) exactly — same error envelope, same MalformedLLM
 * → 502 mapping — only the orchestration call differs.
 *
 * Per IMPROVEMENTS.md Phase A task A.4 this route does NOT contain business
 * logic. It only:
 *   1. parses + validates the request body,
 *   2. calls `auditDocument(text, filename)`,
 *   3. returns the resulting `DocumentAudit` (or a JSON error envelope).
 *
 * Request shape  (`AuditDocumentRequestBody` in types.ts):
 *   { text: string, filename: string }
 * Response shape:
 *   DocumentAudit                on success
 *   { error: string }            on any failure
 *
 * The default cap (25 claims) is applied inside `auditDocument`, not
 * here, so the cap policy stays in lib/ next to the pipeline it governs.
 * The route does not expose `maxClaims` to clients — the chat UI uses
 * `/api/audit` (cap 6) and the document UI uses this endpoint (cap 25);
 * exposing the cap would just invite footguns from the browser.
 */

// 25 claims × 3 subagents × (Tavily search + OpenAI JSON call) ≈ 60–90s
// of wall-clock on a cold cache. Vercel's 10s default would truncate.
// Match the chat-audit ceiling (60s) and accept that very long documents
// may run up against it; that is documented in the /document loading state.
export const maxDuration = 60;
export const runtime = "nodejs";

// Hard ceiling on input size to keep memory + token spend bounded. 200k
// chars is roughly a 60–70k-token document, well past anything a normal
// upload should hit. Beyond this we 413 immediately rather than burn
// extractor tokens on something that will time out anyway.
const MAX_TEXT_CHARS = 200_000;

export async function POST(req: NextRequest) {
  let body: AuditDocumentRequestBody;
  try {
    body = (await req.json()) as AuditDocumentRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Request body is not valid JSON." },
      { status: 400 },
    );
  }

  const { text, filename } = body;

  if (typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json(
      { error: "`text` must be a non-empty string." },
      { status: 400 },
    );
  }
  if (text.length > MAX_TEXT_CHARS) {
    return NextResponse.json(
      {
        error: `Document too long: ${text.length} chars (max ${MAX_TEXT_CHARS}). Trim or split into sections.`,
      },
      { status: 413 },
    );
  }
  if (typeof filename !== "string" || filename.trim().length === 0) {
    return NextResponse.json(
      { error: "`filename` must be a non-empty string." },
      { status: 400 },
    );
  }

  try {
    const audit = await auditDocument(text, filename);
    return NextResponse.json(audit);
  } catch (err) {
    // Same triage as /api/audit: malformed LLM JSON is an upstream failure
    // (502), not a request shape problem (400) or server bug (500). Always
    // return a body with an `error` field so the client never has to guess
    // what a bare status code means.
    if (err instanceof MalformedLLMJsonError) {
      console.error("[/api/audit-document] malformed LLM JSON:", err.message);
      return NextResponse.json(
        { error: `Auditor LLM returned malformed JSON: ${err.message}` },
        { status: 502 },
      );
    }
    const message =
      err instanceof Error ? err.message : "Unknown audit error.";
    console.error("[/api/audit-document] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
