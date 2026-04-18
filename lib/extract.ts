import { openaiJson } from "@/lib/providers/openai";
import { EXTRACTOR_PROMPT } from "@/lib/prompts/extractor";
import { type Claim, type ClaimType, MalformedLLMJsonError } from "@/types";

/**
 * Claim extractor.
 *
 * One OpenAI JSON-mode call. Per CLAUDE.md this module:
 *   - Does NOT search.
 *   - Does NOT verify.
 *   - Imports its prompt from lib/prompts/extractor.ts (no inline prompts).
 *
 * The caller is responsible for capping the returned list (e.g., `.slice(0, 6)`)
 * before fanning out to the verifier subagents — see ARCHITECTURE.md §5.4.
 */

const ALLOWED_TYPES: ClaimType[] = ["numerical", "entity", "citation"];

interface ExtractorPayload {
  claims?: Array<{
    id?: unknown;
    text?: unknown;
    sentence?: unknown;
    type?: unknown;
    entities?: unknown;
  }>;
}

export async function extractClaims(assistantText: string): Promise<Claim[]> {
  const trimmed = assistantText.trim();
  if (!trimmed) return [];

  const payload = await openaiJson<ExtractorPayload>(
    EXTRACTOR_PROMPT,
    `Assistant message to analyse:\n\n"""${trimmed}"""`,
  );

  if (!payload || !Array.isArray(payload.claims)) {
    throw new MalformedLLMJsonError(
      "Extractor JSON did not contain a `claims` array.",
      JSON.stringify(payload).slice(0, 500),
    );
  }

  const claims: Claim[] = [];
  payload.claims.forEach((raw, idx) => {
    const text = typeof raw.text === "string" ? raw.text.trim() : "";
    const sentence =
      typeof raw.sentence === "string" ? raw.sentence.trim() : "";
    const type = ALLOWED_TYPES.includes(raw.type as ClaimType)
      ? (raw.type as ClaimType)
      : null;
    const entities = Array.isArray(raw.entities)
      ? raw.entities
          .filter((e): e is string => typeof e === "string")
          .map((e) => e.trim())
          .filter((e) => e.length > 0)
      : [];
    if (!text || !type) return;
    claims.push({
      id:
        typeof raw.id === "string" && raw.id.trim().length > 0
          ? raw.id.trim()
          : `c${idx + 1}`,
      text,
      sentence: sentence || text,
      type,
      entities,
    });
  });

  return claims;
}
