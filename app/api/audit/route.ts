import { NextRequest, NextResponse } from "next/server";
import { auditMessage } from "@/lib/audit";
import { MalformedLLMJsonError, type AuditRequestBody } from "@/types";

/**
 * POST /api/audit
 *
 * Thin HTTP wrapper around `lib/audit.auditMessage`. Per the task 2.9
 * contract this route does NOT contain business logic — it only:
 *   1. parses + validates the request body,
 *   2. calls `auditMessage`,
 *   3. returns the resulting `MessageAudit` (or a JSON error envelope).
 *
 * Request shape  (ARCHITECTURE.md §6 POST /api/audit):
 *   { message_id: string, content: string }
 * Response shape:
 *   MessageAudit  on success
 *   { error: string }  on any failure (never a bare 500 without a body)
 */

// Audits chain extract + 3 subagents per claim; on a cold cache that can
// run for 20+ seconds. Bump past Vercel's 10s default.
export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: AuditRequestBody;
  try {
    body = (await req.json()) as AuditRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Request body is not valid JSON." },
      { status: 400 },
    );
  }

  const { message_id, content } = body;

  if (typeof message_id !== "string" || message_id.trim().length === 0) {
    return NextResponse.json(
      { error: "`message_id` must be a non-empty string." },
      { status: 400 },
    );
  }
  if (typeof content !== "string" || content.trim().length === 0) {
    return NextResponse.json(
      { error: "`content` must be a non-empty string." },
      { status: 400 },
    );
  }

  try {
    const audit = await auditMessage(message_id, content);
    return NextResponse.json(audit);
  } catch (err) {
    // The auditor's most common structural failure is an LLM returning text
    // that does not parse as JSON. We surface that as 502 (upstream failure)
    // so the client can distinguish it from a request-shape problem (400)
    // or a true server bug (500). Either way the response always carries a
    // human-readable `error` field — never a bare status with no body.
    if (err instanceof MalformedLLMJsonError) {
      console.error("[/api/audit] malformed LLM JSON:", err.message);
      return NextResponse.json(
        { error: `Auditor LLM returned malformed JSON: ${err.message}` },
        { status: 502 },
      );
    }
    const message = err instanceof Error ? err.message : "Unknown audit error.";
    console.error("[/api/audit] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
