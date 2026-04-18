import Anthropic from "@anthropic-ai/sdk";

/**
 * Anthropic Claude provider wrapper.
 *
 * Responsibility: chat-completion calls only. Anthropic is NEVER used by the
 * auditor — keeping the auditor fixed to OpenAI is what makes the chat-model
 * comparison meaningful (CLAUDE.md core rule 2). Same locked-auditor exemption
 * as Gemini.
 *
 * Single supported model: `claude-haiku-4-5` (rolling alias). Sonnet and the
 * older 3.5 Haiku entries were dropped at IMPROVEMENTS.md Phase B prep:
 *   - Haiku is the cheapest tier with the most generous rate limits, which
 *     matters because the eval harness (Phase B.7) issues hundreds of upstream
 *     calls in one run.
 *   - Mirrors the Gemini Flash decision from Phase 0 — single efficient-tier
 *     model per provider so the comparison is internally consistent.
 *   - Anthropic has no perpetual free API tier; new accounts get a one-time
 *     trial credit. Pinning to Haiku keeps the eval cost bounded.
 * Do not re-add Sonnet behind a config flag — single code path on purpose.
 *
 * Anthropic quirks handled here so the rest of the codebase doesn't have to:
 *   - System messages use a top-level `system` parameter, not a turn in the
 *     `messages` array (same shape as Gemini's `systemInstruction`).
 *   - `user` / `assistant` roles are native — no remapping needed.
 *   - `max_tokens` is REQUIRED by the SDK (unlike OpenAI/Gemini where it
 *     defaults). We set a generous chat-sized default (4096); responses won't
 *     hit it for normal Q&A but it's far short of Haiku's 64k cap so we won't
 *     accidentally bill huge generations.
 *   - Response `content` is `ContentBlock[]`, not a string. We concatenate
 *     all `text` blocks; `tool_use` etc. are not used in this codebase.
 */

let _client: Anthropic | null = null;

function client(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local before running.",
    );
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

export type AnthropicChatModel = "claude-haiku-4-5";

export interface AnthropicChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

const DEFAULT_MAX_TOKENS = 4096;

export async function anthropicChat(
  messages: AnthropicChatTurn[],
  model: AnthropicChatModel = "claude-haiku-4-5",
): Promise<string> {
  const systemTurns = messages.filter((m) => m.role === "system");
  const conversation = messages.filter((m) => m.role !== "system");

  const system =
    systemTurns.length > 0
      ? systemTurns.map((m) => m.content).join("\n\n")
      : undefined;

  const response = await client().messages.create({
    model,
    max_tokens: DEFAULT_MAX_TOKENS,
    ...(system ? { system } : {}),
    messages: conversation.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  if (!text) {
    throw new Error("Anthropic returned an empty response.");
  }
  return text;
}
