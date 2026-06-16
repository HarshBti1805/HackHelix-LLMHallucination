import { NextRequest, NextResponse } from "next/server";
import { interrogateClaim } from "@/lib/interrogate";
import {
  MalformedLLMJsonError,
  type InterrogateRequestBody,
} from "@/types";

/**
 * POST /api/interrogate  ("Interrogate the verdict / Ask the auditor")
 *
 * Thin HTTP wrapper around `lib/interrogate.interrogateClaim`. Lets a reviewer
 * ask why a single claim got its verdict; the locked auditor answers grounded
 * ONLY in the evidence already gathered for that claim. Never searches the web
 * (CLAUDE.md rule 5) and never changes the verdict.
 *
 * Request shape (`InterrogateRequestBody`):
 *   { claim_audit: ClaimAudit, history: InterrogationTurn[], question: string }
 * Response shape:  InterrogateResponseBody  |  { error: string }
 */

export const maxDuration = 60;
export const runtime = "nodejs";

const MAX_QUESTION_CHARS = 2_000;

export async function POST(req: NextRequest) {
  let body: InterrogateRequestBody;
  try {
    body = (await req.json()) as InterrogateRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Request body is not valid JSON." },
      { status: 400 },
    );
  }

  const { claim_audit, history, question } = body;

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
  if (
    !claim_audit ||
    typeof claim_audit !== "object" ||
    !claim_audit.claim ||
    !Array.isArray(claim_audit.per_agent_reports)
  ) {
    return NextResponse.json(
      { error: "`claim_audit` must be a valid ClaimAudit object." },
      { status: 400 },
    );
  }

  const safeHistory = Array.isArray(history) ? history : [];

  try {
    const result = await interrogateClaim(
      claim_audit,
      safeHistory,
      question.trim(),
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MalformedLLMJsonError) {
      console.error("[/api/interrogate] malformed LLM JSON:", err.message);
      return NextResponse.json(
        { error: `Auditor LLM returned malformed JSON: ${err.message}` },
        { status: 502 },
      );
    }
    const message =
      err instanceof Error ? err.message : "Unknown interrogate error.";
    console.error("[/api/interrogate] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
