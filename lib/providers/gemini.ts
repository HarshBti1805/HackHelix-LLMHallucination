import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Google Gemini provider wrapper.
 *
 * Responsibility: chat-completion calls only. Gemini is NEVER used by the
 * auditor — keeping the auditor fixed to OpenAI is what makes the chat-model
 * comparison meaningful (CLAUDE.md core rule 2).
 *
 * Single supported model: `gemini-2.5-flash`. Pro is intentionally excluded
 * (IMPROVEMENTS.md Phase 0 decision): on the consumer Gemini API, Pro is
 * paid-tier only (free-tier quota = 0), which makes it a footgun for the
 * three-provider eval harness in IMPROVEMENTS.md Phase B and a 500-on-first-
 * click hazard in the chat UI. Flash is on the free tier, has the same SDK
 * shape, and is the model the eval comparison runs against. Do not re-add
 * Pro behind a config flag — single code path on purpose.
 *
 * Gemini quirks handled here so the rest of the codebase doesn't have to care:
 *   - Gemini uses `"model"` for the assistant role; we accept `"assistant"` and
 *     normalize.
 *   - System instructions are passed via `systemInstruction`, not as a turn in
 *     the message history.
 */

let _client: GoogleGenerativeAI | null = null;

function client(): GoogleGenerativeAI {
  if (_client) return _client;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env.local before running.",
    );
  }
  _client = new GoogleGenerativeAI(apiKey);
  return _client;
}

export type GeminiChatModel = "gemini-2.5-flash";

export interface GeminiChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function geminiChat(
  messages: GeminiChatTurn[],
  model: GeminiChatModel = "gemini-2.5-flash",
): Promise<string> {
  const systemTurns = messages.filter((m) => m.role === "system");
  const conversation = messages.filter((m) => m.role !== "system");

  const systemInstruction =
    systemTurns.length > 0
      ? systemTurns.map((m) => m.content).join("\n\n")
      : undefined;

  const generativeModel = client().getGenerativeModel({
    model,
    ...(systemInstruction ? { systemInstruction } : {}),
  });

  const contents = conversation.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const result = await generativeModel.generateContent({ contents });
  const text = result.response.text();
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }
  return text;
}
