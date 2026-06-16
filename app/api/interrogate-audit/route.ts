import { NextRequest, NextResponse } from "next/server";
import { interrogateAudit } from "@/lib/interrogate-audit";
import {
  MalformedLLMJsonError,
  type InterrogateAuditRequestBody,
} from "@/types";

/**
 * POST /api/interrogate-audit  (B2 — Interrogate the whole response)
 *
 * Thin HTTP wrapper around `lib/interrogate-audit.interrogateAudit`. Answers
 * questions about an entire audited response grounded only in the per-claim
 * results already computed. No web search (CLAUDE.md rule 5).
 *
 * Request shape (`InterrogateAuditRequestBody`):
 *   { audit: MessageAudit, history: InterrogationTurn[], question: string }
 * Response shape:  InterrogateAuditResponseBody  |  { error: string }
 */

export const maxDuration = 60;
export const runtime = "nodejs";

const MAX_QUESTION_CHARS = 2_000;

export async function POST(req: NextRequest) {
  let body: InterrogateAuditRequestBody;
  try {
    body = (await req.json()) as InterrogateAuditRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Request body is not valid JSON." },
      { status: 400 },
    );
  }

  const { audit, history, question } = body;

  if (typeof question !== "string" || question.trim().length === 0) {
    return NextResponse.json(
      { error: "`question` must be a non-empty string." },
      { status: 400 },
    );
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return NextResponse.json(
      {
        error: `Question too long (${question.length} chars, max ${MAX_QUESTION_CHARS}).`,
      },
      { status: 413 },
    );
  }
  if (!audit || typeof audit !== "object" || !Array.isArray(audit.claims)) {
    return NextResponse.json(
      { error: "`audit` must be a valid MessageAudit object." },
      { status: 400 },
    );
  }

  const safeHistory = Array.isArray(history) ? history : [];

  try {
    const result = await interrogateAudit(audit, safeHistory, question.trim());
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MalformedLLMJsonError) {
      console.error("[/api/interrogate-audit] malformed LLM JSON:", err.message);
      return NextResponse.json(
        { error: `Auditor LLM returned malformed JSON: ${err.message}` },
        { status: 502 },
      );
    }
    const message =
      err instanceof Error ? err.message : "Unknown interrogate-audit error.";
    console.error("[/api/interrogate-audit] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
