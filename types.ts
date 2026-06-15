/**
 * Shared type contracts for Groundtruth (the multi-agent hallucination auditor).
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
  /**
   * Optional independent cross-check signal (MAJOR_CHANGES.md #2).
   *
   * Produced by a SEPARATE pre-step — not a fourth verifier subagent (the
   * three-agent rule in CLAUDE.md still holds). The locked auditor answers
   * the user's ORIGINAL question from scratch, without ever seeing the chat
   * model's response, and each extracted claim is compared against that
   * independent answer. When the independent answer contradicts a claim the
   * three agents marked `verified`/`unverified_plausible`, aggregation
   * escalates the verdict one severity step and records `escalated: true`.
   *
   * Only present when the audit was run with cross-checking enabled
   * (`AuditRequestBody.cross_check` + a non-empty `original_prompt`). Absent
   * on the existing default path, so eval results and prior behavior are
   * unchanged.
   */
  independent_check?: IndependentCheck;
}

/**
 * How the independent re-derivation relates to a single claim.
 *   - "supports":    the independent answer asserts the same fact.
 *   - "contradicts": the independent answer asserts something incompatible.
 *   - "absent":      the independent answer neither supports nor contradicts.
 */
export type IndependentStance = "supports" | "contradicts" | "absent";

export interface IndependentCheck {
  stance: IndependentStance;
  /** One-line rationale grounded in the independent answer. */
  note: string;
  /** True when this cross-check changed the three-agent consensus verdict. */
  escalated: boolean;
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
  /**
   * The user's original question that produced `content`. Required to run
   * the independent cross-check (MAJOR_CHANGES.md #2) — the auditor answers
   * THIS, not `content`, from scratch. Optional + ignored unless
   * `cross_check` is true.
   */
  original_prompt?: string;
  /** Opt into the independent re-derivation cross-check signal. */
  cross_check?: boolean;
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

/**
 * Document dehallucination shapes (see `lib/dehallucinate-document.ts` and
 * `app/api/dehallucinate-document/route.ts`).
 *
 * Why a separate type from the chat dehallucinator (`DehallucinateRequestBody`
 * → `{ suggested_prompt }`):
 *
 *   - The chat dehallucinator builds *one* prompt the user sends back through
 *     /api/chat to regenerate the entire answer. That makes sense for a chat
 *     turn — the user is still in conversation, the answer is short, and a
 *     full re-ask is the natural unit.
 *
 *   - A document is not a conversation. The user has invested authorial
 *     intent in surrounding paragraphs that the auditor judged just fine.
 *     Re-prompting the model to "rewrite this document" would smear the
 *     correct sentences along with the wrong ones and silently reshape the
 *     author's voice. The whole point of the document path is *surgical*
 *     correction: we only touch sentences carrying failed claims, leave
 *     everything else byte-identical, and let the user accept/reject each
 *     proposed fix.
 *
 * Hence `DocumentRevision` / `DocumentRevisions` rather than reusing the
 * chat shape. The model is asked to act as a copy editor, not as a
 * ghostwriter — see CLAUDE.md "Document dehallucination is surgical".
 */
export interface DocumentRevision {
  /** Stable id of the originating ClaimAudit (so the UI can pair revisions
   *  back to the audit row that produced them). */
  claim_id: string;
  /** Verbatim sentence from the source document that the audit flagged.
   *  Used as the search needle when applying revisions to the source text
   *  via the same first-occurrence-not-yet-replaced rule as
   *  `locateClaimSpans`. */
  original_sentence: string;
  /** Either (a) a corrected factual statement supported by the gathered
   *  evidence, or (b) an honest abstention sentence (e.g. "The source for
   *  this statistic could not be verified."). NEVER a fabrication — see
   *  `DEHALLUCINATOR_DOCUMENT_PROMPT` for the anti-fabrication clause. */
  replacement_sentence: string;
  /** One-line copy editor's note explaining why the replacement was chosen
   *  (cited evidence, abstention, etc.). Surfaced in the modal. */
  rationale: string;
  /** The original failed verdict, preserved purely for display so the modal
   *  can render the verdict pill alongside each revision card. */
  verdict: Verdict;
}

export interface DocumentRevisions {
  revisions: DocumentRevision[];
  /** Failed claims the model could NOT produce a grounded replacement for —
   *  surfaced honestly in the modal rather than silently dropped, and
   *  rendered with the model's reason so the user understands why. */
  unrevisable_claims: { claim_id: string; reason: string }[];
}

export interface DehallucinateDocumentRequestBody {
  sourceText: string;
  filename: string;
  audit: DocumentAudit;
}

export type DehallucinateDocumentResponseBody = DocumentRevisions;

// ---- Groundedness / RAG guardrail (MAJOR_CHANGES.md #10) ----

/**
 * Whether a claim in an answer is supported by the user-provided context.
 *   - "grounded":     the context directly supports the claim.
 *   - "ungrounded":   the context does not mention / support the claim
 *                     (the claim may still be true in the world — it just
 *                     isn't backed by the provided source).
 *   - "contradicted": the context asserts something incompatible.
 *
 * This is a DIFFERENT axis from the web-audit `Verdict`. The guardrail does
 * not consult the web; it asks only "is this answer faithful to the source
 * material the operator handed us?" — the canonical RAG faithfulness check.
 */
export type GroundingVerdict = "grounded" | "ungrounded" | "contradicted";

export interface GroundedClaim {
  claim: Claim;
  verdict: GroundingVerdict;
  confidence: number; // 0..1
  rationale: string;
  /** Verbatim span from the provided context that supports/contradicts the
   *  claim, or "" when none was found. Never fabricated. */
  supporting_quote: string;
}

export interface GroundednessSummary {
  total_claims: number;
  grounded: number;
  ungrounded: number;
  contradicted: number;
}

export interface GroundednessAudit {
  /** Human label for the answer being checked (e.g. "(pasted answer)"). */
  source_label: string;
  claims: GroundedClaim[];
  summary: GroundednessSummary;
}

export interface GuardrailRequestBody {
  /** The model output (RAG answer, chatbot reply, generated text) to check. */
  answer: string;
  /** The trusted source / knowledge-base text the answer must be faithful to. */
  context: string;
}

export type GuardrailResponseBody = GroundednessAudit;

// ---- Citation / reference checker (MAJOR_CHANGES.md #8) ----

/**
 *   - "verified":  a real matching work was found in a bibliographic index.
 *   - "not_found": no plausible match exists — likely a fabricated citation.
 *   - "uncertain": candidates exist but none clearly matches the cited
 *                  author/year/title (could be real-but-obscure or wrong).
 */
export type CitationStatus = "verified" | "not_found" | "uncertain";

export interface CitationCandidate {
  title: string;
  authors: string;
  year: string;
  venue: string;
  url: string;
  source: "crossref" | "semanticscholar" | "arxiv";
}

export interface CitationCheck {
  /** The citation-type claim the reference was pulled from. */
  claim: Claim;
  /** The reference as stated in the text (author/year/title/venue). */
  cited_reference: string;
  status: CitationStatus;
  confidence: number; // 0..1
  rationale: string;
  /** The candidate the matcher judged the best match (if any). */
  best_match?: CitationCandidate;
  /** All candidates returned by the bibliographic indices, for transparency. */
  candidates: CitationCandidate[];
}

export interface CitationSummary {
  total: number;
  verified: number;
  not_found: number;
  uncertain: number;
}

export interface CitationReport {
  claims: CitationCheck[];
  summary: CitationSummary;
}

export interface CheckCitationsRequestBody {
  text: string;
}

export type CheckCitationsResponseBody = CitationReport;

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
