import OpenAI from "openai";

/**
 * OpenAI provider wrapper.
 *
 * Responsibility: chat-completion calls only. The auditor JSON wrapper
 * (`openaiJson`) lives here too once task 1.3 adds it — both share a single
 * client instance to keep connection pooling clean.
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
