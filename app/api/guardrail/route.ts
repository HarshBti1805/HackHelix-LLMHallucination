import { NextRequest, NextResponse } from "next/server";
import { checkGroundedness } from "@/lib/groundedness";
import {
  MalformedLLMJsonError,
  type GuardrailRequestBody,
} from "@/types";

/**
 * POST /api/guardrail  (MAJOR_CHANGES.md #10 — RAG / chatbot output guardrail)
 *
 * Thin HTTP wrapper around `lib/groundedness.checkGroundedness`. Checks
 * whether a model `answer` is faithful to an operator-provided `context`
 * (knowledge base / retrieved passages). Never touches the web.
 *
 * Request shape (`GuardrailRequestBody`):  { answer: string, context: string }
 * Response shape:  GroundednessAudit  |  { error: string }
 */

export const maxDuration = 60;
export const runtime = "nodejs";

const MAX_CHARS = 200_000;

export async function POST(req: NextRequest) {
  let body: GuardrailRequestBody;
  try {
    body = (await req.json()) as GuardrailRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Request body is not valid JSON." },
      { status: 400 },
    );
  }

  const { answer, context } = body;

  if (typeof answer !== "string" || answer.trim().length === 0) {
    return NextResponse.json(
      { error: "`answer` must be a non-empty string." },
      { status: 400 },
    );
  }
  if (typeof context !== "string" || context.trim().length === 0) {
    return NextResponse.json(
      { error: "`context` must be a non-empty string (your source material)." },
      { status: 400 },
    );
  }
  if (answer.length + context.length > MAX_CHARS) {
    return NextResponse.json(
      {
        error: `Inputs too long (${answer.length + context.length} chars, max ${MAX_CHARS}). Trim the answer or context.`,
      },
      { status: 413 },
    );
  }

  try {
    const audit = await checkGroundedness(answer, context);
    return NextResponse.json(audit);
  } catch (err) {
    if (err instanceof MalformedLLMJsonError) {
      console.error("[/api/guardrail] malformed LLM JSON:", err.message);
      return NextResponse.json(
        { error: `Auditor LLM returned malformed JSON: ${err.message}` },
        { status: 502 },
      );
    }
    const message =
      err instanceof Error ? err.message : "Unknown guardrail error.";
    console.error("[/api/guardrail] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
