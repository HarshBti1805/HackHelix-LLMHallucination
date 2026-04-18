/**
 * Shared type contracts for the Hallucination Audit Trail.
 *
 * Single source of truth — every module that touches Claims, Verdicts, agent
 * reports, or audits MUST import from this file. Do not redefine these types
 * inside feature modules. See ARCHITECTURE.md §3 and CLAUDE.md "Type contracts"
 * before changing field names or verdict strings.
 */

export type Provider = "openai" | "gemini" | "anthropic";

export type ChatModel =
  | "gpt-4o"
  | "gpt-4o-mini"
  | "gemini-2.5-flash"
  | "claude-haiku-4-5";

/**
 * Anthropic chat-model entry rationale (IMPROVEMENTS.md Phase B prep):
 *
 * Single Claude entry on purpose. The earlier `claude-3-5-sonnet-latest` and
 * `claude-3-5-haiku-latest` placeholders (added during Phase A as type-only
 * stubs) are gone. `claude-haiku-4-5` is the rolling alias for Claude Haiku
 * 4.5 — the current efficient-tier model from Anthropic's overview docs.
 *
 * Why Haiku and not Sonnet:
 *   - Mirrors the Gemini Flash decision (Phase 0). Single efficient-tier
 *     model per non-OpenAI provider keeps the eval comparison internally
 *     consistent.
 *   - The eval harness (Phase B.7) issues hundreds of upstream calls — Haiku
 *     gives the most generous rate limits and lowest per-token cost.
 *   - Anthropic has no perpetual free API tier, so cost discipline matters
 *     here even more than for Gemini.
 *
 * Why the rolling alias and not the dated snapshot
 * (`claude-haiku-4-5-20251001`): consistency with `gpt-4o` and
 * `gemini-2.5-flash`, which are also rolling. The eval is a one-shot run, so
 * snapshot-pinning for reproducibility isn't a concern. Do not re-add Sonnet
 * or older Haiku entries behind a config flag — single code path on purpose.
 */

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  provider?: Provider;
  model?: ChatModel;
  timestamp: number;
  /**
   * If set, this message is part of a dehallucinate regeneration loop
   * (PROJECT_PLAN.md task 4.6/4.7). Points to the *flawed* assistant
   * message id that this regeneration is trying to fix.
   *
   * Stamped on BOTH the user message that carries the edited dehallucinate
   * prompt AND on the assistant message produced in response to it, so the
   * before/after diff can be rendered from either direction by the same
   * pointer. Lives only in client React state — never persisted, never
   * sent to /api/chat as part of the message payload.
   */
  regenerates_message_id?: string;
}

// ---- Claims and audits ----

export type ClaimType = "numerical" | "entity" | "citation";

export interface Claim {
  id: string;
  text: string;
  sentence: string;
  type: ClaimType;
  entities: string[];
}

export type Verdict =
  | "verified"
  | "unverified_plausible"
  | "contradicted"
  | "likely_hallucination";

export interface EvidenceSource {
  url: string;
  title: string;
  snippet: string;
  domain: string;
}

export type AgentRole = "prosecutor" | "defender" | "literalist";

export interface AgentReport {
  agent_role: AgentRole;
  verdict: Verdict;
  confidence: number;
  reasoning: string;
  sources: EvidenceSource[];
}

export interface ClaimAudit {
  claim: Claim;
  consensus_verdict: Verdict;
  consensus_confidence: number;
  agreement_score: number;
  agents_disagreed: boolean;
  per_agent_reports: AgentReport[];
}

export interface AuditSummary {
  total_claims: number;
  verified: number;
  unverified_plausible: number;
  contradicted: number;
  likely_hallucination: number;
}

export interface MessageAudit {
  message_id: string;
  claims: ClaimAudit[];
  summary: AuditSummary;
}

/**
 * Audit shape returned by `/api/audit-document` (IMPROVEMENTS.md Phase A).
 *
 * Same `ClaimAudit[]` + `AuditSummary` shape as `MessageAudit` — the audit
 * pipeline (`extractClaims` → 3 subagents in parallel → `aggregateReports`)
 * is reused unchanged from the chat path. The document-specific fields are:
 *
 *   - `document_id`  client-side UUID for React keys / cross-references
 *   - `filename`     original file name (or "(pasted)" for textarea input);
 *                    surfaced in the JSON download filename
 *   - `source_text`  the full document text the audit ran against; the
 *                    `/document` view re-renders it on the left column with
 *                    each claim's `sentence` highlighted in-place. Stored
 *                    here (not just on the client) so the downloaded JSON is
 *                    self-contained — re-opening the audit later doesn't
 *                    need the original file.
 *
 * Default `maxClaims` for documents is 25 (vs 6 for chat messages); see
 * `lib/document-audit.ts` for the cap and the orchestration parameter.
 */
export interface DocumentAudit {
  document_id: string;
  filename: string;
  source_text: string;
  claims: ClaimAudit[];
  summary: AuditSummary;
}

// ---- API request/response shapes ----

export interface ChatRequestBody {
  messages: { role: "user" | "assistant"; content: string }[];
  provider: Provider;
  model: ChatModel;
}

export interface ChatResponseBody {
  message: ChatMessage;
}

export interface AuditRequestBody {
  message_id: string;
  content: string;
}

export interface DehallucinateRequestBody {
  originalUserMessage: string;
  flawedResponse: string;
  audit: MessageAudit;
}

export interface DehallucinateResponseBody {
  suggested_prompt: string;
}

export interface AuditDocumentRequestBody {
  text: string;
  filename: string;
}

export type AuditDocumentResponseBody = DocumentAudit;

// ---- Errors ----

/**
 * Thrown when an LLM call returns text that is not valid JSON or does not
 * match the expected schema. Per CLAUDE.md rule 4, we never silently default
 * — the API route catches this and surfaces it to the client.
 */
export class MalformedLLMJsonError extends Error {
  public readonly raw: string;

  constructor(message: string, raw: string) {
    super(message);
    this.name = "MalformedLLMJsonError";
    this.raw = raw;
  }
}
