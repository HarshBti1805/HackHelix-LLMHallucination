import { NextRequest, NextResponse } from "next/server";
import { buildDehallucinatePrompt } from "@/lib/dehallucinate";
import {
  MalformedLLMJsonError,
  type DehallucinateRequestBody,
  type MessageAudit,
} from "@/types";

/**
 * POST /api/dehallucinate
 *
 * Thin HTTP wrapper around `lib/dehallucinate.buildDehallucinatePrompt`,
 * matching ARCHITECTURE.md §6:
 *
 *   Request:  { originalUserMessage, flawedResponse, audit: MessageAudit }
 *   Response: { suggested_prompt: string }
 *
 * Same error-handling philosophy as /api/audit (PROJECT_PLAN.md task 2.9):
 *   - Bad JSON / bad shape → 400 with a descriptive `error` field.
 *   - LLM returned malformed JSON → 502 (upstream failure).
 *   - Anything else → 500 with the underlying message — never a bare 500
 *     with no body.
 */

export const maxDuration = 60;
export const runtime = "nodejs";

function isMessageAudit(value: unknown): value is MessageAudit {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.message_id === "string" &&
    Array.isArray(v.claims) &&
    !!v.summary &&
    typeof v.summary === "object"
  );
}

export async function POST(req: NextRequest) {
  let body: DehallucinateRequestBody;
  try {
    body = (await req.json()) as DehallucinateRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Request body is not valid JSON." },
      { status: 400 },
    );
  }

  const { originalUserMessage, flawedResponse, audit } = body ?? {};

  if (
    typeof originalUserMessage !== "string" ||
    originalUserMessage.trim().length === 0
  ) {
    return NextResponse.json(
      { error: "`originalUserMessage` must be a non-empty string." },
      { status: 400 },
    );
  }
  if (typeof flawedResponse !== "string" || flawedResponse.trim().length === 0) {
    return NextResponse.json(
      { error: "`flawedResponse` must be a non-empty string." },
      { status: 400 },
    );
  }
  if (!isMessageAudit(audit)) {
    return NextResponse.json(
      { error: "`audit` must be a MessageAudit object." },
      { status: 400 },
    );
  }

  try {
    const result = await buildDehallucinatePrompt({
      originalUserMessage,
      flawedResponse,
      audit,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MalformedLLMJsonError) {
      console.error("[/api/dehallucinate] malformed LLM JSON:", err.message);
      return NextResponse.json(
        {
          error: `Dehallucinator LLM returned malformed JSON: ${err.message}`,
        },
        { status: 502 },
      );
    }
    const message =
      err instanceof Error ? err.message : "Unknown dehallucinate error.";
    console.error("[/api/dehallucinate] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
