import { NextRequest, NextResponse } from "next/server";
import {
  openaiChat,
  openaiChatStream,
  type OpenAIChatModel,
} from "@/lib/providers/openai";
import {
  geminiChat,
  geminiChatStream,
  type GeminiChatModel,
} from "@/lib/providers/gemini";
import {
  anthropicChat,
  anthropicChatStream,
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

  // D1: streaming branch. Returns a text/plain body of token deltas. The audit
  // is triggered client-side once the stream completes; this route stays a pure
  // chat dispatcher (CLAUDE.md — /api/chat does not audit).
  if (body.stream) {
    let iterator: AsyncIterable<string>;
    switch (provider) {
      case "openai":
        iterator = openaiChatStream(messages, model as OpenAIChatModel);
        break;
      case "gemini":
        iterator = geminiChatStream(messages, model as GeminiChatModel);
        break;
      case "anthropic":
        iterator = anthropicChatStream(messages, model as AnthropicChatModel);
        break;
    }
    const encoder = new TextEncoder();
    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const delta of iterator) {
            controller.enqueue(encoder.encode(delta));
          }
          controller.close();
        } catch (err) {
          console.error("[/api/chat] stream error:", err);
          controller.error(err);
        }
      },
    });
    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
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
