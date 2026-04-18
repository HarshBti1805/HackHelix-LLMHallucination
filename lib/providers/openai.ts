import OpenAI from "openai";
import { MalformedLLMJsonError } from "@/types";
import { withCache } from "@/lib/cache";

/**
 * OpenAI provider wrapper.
 *
 * Two responsibilities, both thin:
 *   - `openaiChat`: free-form chat-completion (used by /api/chat).
 *   - `openaiJson`: structured JSON-mode call returning a typed object (used
 *     by every auditor path — extractor, verifier subagents, dehallucinator).
 *
 * Per CLAUDE.md, this module must NOT contain extractor / verifier / aggregator
 * logic. It only knows how to talk to OpenAI.
 */

let _client: OpenAI | null = null;

function client(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to .env.local before running.",
    );
  }
  _client = new OpenAI({ apiKey });
  return _client;
}

export type OpenAIChatModel = "gpt-4o" | "gpt-4o-mini";

export interface OpenAIChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Plain chat-completion. Returns the assistant's message content as a single
 * string. Throws if the API rejects the call or returns no choices.
 */
export async function openaiChat(
  messages: OpenAIChatTurn[],
  model: OpenAIChatModel = "gpt-4o",
): Promise<string> {
  const completion = await client().chat.completions.create({
    model,
    messages,
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) {
    throw new Error("OpenAI returned an empty response.");
  }
  return text;
}

/**
 * Structured-JSON call. Forces `response_format: { type: "json_object" }` and
 * parses the result into `T`. Throws `MalformedLLMJsonError` on a parse
 * failure — never silently defaults (CLAUDE.md rule 4).
 *
 * The caller is responsible for runtime-validating the shape of `T`; this
 * wrapper only guarantees `JSON.parse` succeeded.
 *
 * The exported `openaiJson` is cached in dev (no-op in prod). Use
 * `openaiJsonUncached` if you specifically need to bypass the cache.
 */
export async function openaiJsonUncached<T>(
  systemPrompt: string,
  userPrompt: string,
  model: "gpt-4o-mini" = "gpt-4o-mini",
): Promise<T> {
  const completion = await client().chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  if (!raw) {
    throw new MalformedLLMJsonError(
      "OpenAI JSON call returned an empty response.",
      raw,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown parse error";
    throw new MalformedLLMJsonError(
      `OpenAI JSON call returned invalid JSON: ${reason}`,
      raw,
    );
  }
}

// Cache layer. Generic <T> is preserved at the call site by casting the
// cached unknown back to T — withCache stores plain JSON so the round-trip
// is structurally safe (the underlying call already ran the same JSON.parse).
const _openaiJsonCached = withCache(
  "openai-json",
  (systemPrompt: string, userPrompt: string, model: "gpt-4o-mini") =>
    openaiJsonUncached<unknown>(systemPrompt, userPrompt, model),
);

export async function openaiJson<T>(
  systemPrompt: string,
  userPrompt: string,
  model: "gpt-4o-mini" = "gpt-4o-mini",
): Promise<T> {
  return (await _openaiJsonCached(systemPrompt, userPrompt, model)) as T;
}
