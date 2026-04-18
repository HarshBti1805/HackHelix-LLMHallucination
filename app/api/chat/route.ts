import { NextRequest, NextResponse } from "next/server";
import { openaiChat, type OpenAIChatModel } from "@/lib/providers/openai";
import { geminiChat, type GeminiChatModel } from "@/lib/providers/gemini";
import {
  anthropicChat,
  type AnthropicChatModel,
} from "@/lib/providers/anthropic";
import type {
  ChatMessage,
  ChatRequestBody,
  ChatResponseBody,
  Provider,
} from "@/types";

/**
 * POST /api/chat
 *
 * Thin dispatcher: parses the request body, forwards to the right provider
 * wrapper, and returns a `ChatMessage`. Per CLAUDE.md, this route does NOT
 * extract claims, verify, or audit — that's `/api/audit`'s job.
 */

export const runtime = "nodejs";

function isValidProvider(p: unknown): p is Provider {
  return p === "openai" || p === "gemini" || p === "anthropic";
}

export async function POST(req: NextRequest) {
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Request body is not valid JSON." },
      { status: 400 },
    );
  }

  const { messages, provider, model } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json(
      { error: "`messages` must be a non-empty array." },
      { status: 400 },
    );
  }
  if (!isValidProvider(provider)) {
    return NextResponse.json(
      { error: `Unknown provider: ${String(provider)}` },
      { status: 400 },
    );
  }
  if (typeof model !== "string") {
    return NextResponse.json(
      { error: "`model` is required." },
      { status: 400 },
    );
  }

  try {
    let content: string;
    switch (provider) {
      case "openai":
        content = await openaiChat(messages, model as OpenAIChatModel);
        break;
      case "gemini":
        content = await geminiChat(messages, model as GeminiChatModel);
        break;
      case "anthropic":
        content = await anthropicChat(messages, model as AnthropicChatModel);
        break;
    }

    const message: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role: "assistant",
      content,
      provider,
      model: model as ChatMessage["model"],
      timestamp: Date.now(),
    };

    const response: ChatResponseBody = { message };
    return NextResponse.json(response);
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown chat provider error.";
    console.error("[/api/chat] provider error:", err);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
