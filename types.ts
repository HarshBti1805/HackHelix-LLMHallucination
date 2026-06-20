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
  /**
   * When true, `/api/chat` streams the reply as a `text/plain` body of token
   * deltas instead of returning a `ChatResponseBody` JSON object (D1). The
   * client assembles the full text and assigns the message id locally. The
   * audit path is unchanged — it runs once the stream completes.
   */
  stream?: boolean;
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

// ---- Interrogate the verdict / Ask the auditor ----

/**
 * One turn in a per-claim interrogation thread.
 *   - "user":    the reviewer's question.
 *   - "auditor": the locked auditor's grounded explanation.
 *
 * Threads live only in client React state (CLAUDE.md rule 6 — in-memory
 * only). They are not persisted server-side; the compliance export
 * (`ReviewWorkspace.tsx`) is where they could become a durable artifact.
 */
export interface InterrogationTurn {
  role: "user" | "auditor";
  content: string;
}

/**
 * Request to interrogate a single claim's verdict (POST /api/interrogate).
 *
 * The ENTIRE evidence universe for the answer is `claim_audit` — the same
 * `ClaimAudit` already rendered in the UI (agent reports, their sources and
 * snippets, the consensus numbers, and any independent cross-check). The
 * auditor answers ONLY from that gathered evidence and NEVER re-searches the
 * web (CLAUDE.md rule 5 — "evidence is gathered once, reused everywhere").
 */
export interface InterrogateRequestBody {
  claim_audit: ClaimAudit;
  /** Prior turns in this claim's thread, oldest first. May be empty. */
  history: InterrogationTurn[];
  /** The reviewer's new question. */
  question: string;
}

export interface InterrogateResponseBody {
  /** The auditor's grounded explanation of its existing verdict. */
  answer: string;
  /** Which agent reports the answer leaned on, for UI attribution. */
  cited_agents: AgentRole[];
  /**
   * URLs the answer cited — guaranteed to be a subset of the evidence URLs
   * already present on `claim_audit`. The server drops any URL the model
   * invents that is not in the gathered evidence.
   */
  cited_source_urls: string[];
  /**
   * True when the question asked for something the gathered evidence cannot
   * answer. The auditor abstains rather than answering from parametric memory
   * or re-searching — keeping an anti-hallucination tool honest about its own
   * explanations.
   */
  abstained: boolean;
}

// ---- B1: Challenge the verdict with your own source ----

/**
 * How a piece of user-supplied evidence bears on a claim.
 *   - "supports":     the user's evidence backs the claim.
 *   - "contradicts":  the user's evidence is incompatible with the claim.
 *   - "insufficient": the evidence doesn't actually address the claim.
 */
export type ChallengeStance = "supports" | "contradicts" | "insufficient";

/**
 * Request to challenge a claim's verdict with the reviewer's OWN evidence
 * (POST /api/challenge). The reviewer pastes a source/excerpt they believe the
 * audit missed; the locked auditor re-judges the claim against THAT text only.
 *
 * This respects CLAUDE.md rule 5 (no re-search): the evidence is supplied by
 * the user, not fetched from the web. The result is ADVISORY — it never mutates
 * the stored `ClaimAudit`; the UI surfaces it as a "you challenged this" turn.
 */
export interface ChallengeRequestBody {
  claim_audit: ClaimAudit;
  /** The reviewer's pasted evidence text (an excerpt, abstract, quote, etc.). */
  user_evidence: string;
  /** Optional URL the evidence came from, shown for provenance. */
  source_url?: string;
}

export interface ChallengeResponseBody {
  stance: ChallengeStance;
  /** Advisory only — what the verdict WOULD be given this evidence. */
  suggested_verdict: Verdict;
  reasoning: string;
  /** Verbatim span copied from `user_evidence`, or "" — never fabricated. */
  quote: string;
}

// ---- B2: Interrogate the whole response ----

/**
 * Request to interrogate an ENTIRE response's audit, not a single claim
 * (POST /api/interrogate-audit). Useful for "which claim here is weakest?",
 * "summarize the risks", "what should I double-check before sending?".
 *
 * The auditor answers grounded only in the per-claim audit results already on
 * `audit` (no web re-search, CLAUDE.md rule 5) and abstains on out-of-evidence
 * questions, same discipline as the per-claim interrogator.
 */
export interface InterrogateAuditRequestBody {
  audit: MessageAudit;
  history: InterrogationTurn[];
  question: string;
}

export interface InterrogateAuditResponseBody {
  answer: string;
  /** Claim ids the answer leaned on (subset of the audit's claim ids). */
  cited_claim_ids: string[];
  abstained: boolean;
}

// ---- Fetch a URL / webpage (MAJOR_CHANGES.md #5) ----

export interface FetchUrlRequestBody {
  url: string;
}

export interface FetchUrlResponseBody {
  url: string;
  /** Page <title> (or hostname fallback). */
  title: string;
  /** Readable, tag-stripped body text ready to feed into the auditor. */
  text: string;
}

// ---- Connectors (MAJOR_CHANGES.md #C1 — Notion source connector) ----

/**
 * External knowledge sources the workspace can pull text from:
 *   - "notion": Notion's hosted MCP server (OAuth + dynamic registration).
 *   - "google": Google Drive/Docs via the Drive + Docs REST API (OAuth app).
 *   - "gmail":  Gmail messages via the Gmail REST API (same Google OAuth app,
 *              gmail.readonly scope) — e.g. auditing an emailed meeting summary.
 * The union exists so the connector plumbing (`lib/connectors/*`, the token
 * store, the API routes) is written once against an id rather than hardcoding a
 * provider everywhere — each new connector reuses the same machinery.
 */
export type ConnectorId = "notion" | "google" | "gmail" | "slack";

/**
 * A page/document reference returned by a connector's search. `id` is whatever
 * the connector's `fetch` step needs to retrieve full text (a Notion page id
 * or URL). The rest is presentation only.
 */
export interface ConnectorPageRef {
  id: string;
  title: string;
  url: string;
  /** ISO timestamp of the last edit, or "" when the source doesn't report it. */
  last_edited: string;
  /** Short match highlight/snippet from the connector's search, when available. */
  snippet?: string;
}

/** Whether the current browser session has an authorized connection. */
export interface ConnectorStatus {
  connector: ConnectorId;
  connected: boolean;
  /** Human label for the connected account/workspace, when known. */
  account?: string;
}

/**
 * Provenance stamped onto a groundedness report when the trusted context was
 * pulled from a connector rather than pasted. Lets the report (and its export)
 * say "checked against <page> in Notion" and link back to the source.
 */
export interface ConnectorSource {
  connector: ConnectorId;
  page_id: string;
  title: string;
  url: string;
}

/** Response of `GET /api/connectors/notion/page?id=…`. */
export interface ConnectorPageTextResponse {
  id: string;
  title: string;
  url: string;
  text: string;
}

// ---- Agentic workspace audit (MAJOR_CHANGES.md #C1) ----

/**
 * A document the user attached (or the orchestrator discovered) for a workspace
 * audit turn. Carries only the lightweight reference — the full text is pulled
 * server-side via the connector, never sent from the client.
 */
export interface WorkspaceAttachment {
  connector: ConnectorId;
  id: string;
  title: string;
}

export interface WorkspaceRunRequestBody {
  /** The user's natural-language instruction ("check my summary vs the transcript"). */
  instruction: string;
  /** Docs the user picked. May be empty — the orchestrator will then search. */
  attachments: WorkspaceAttachment[];
  /**
   * Docs from the previous completed turn, so follow-ups ("now generate
   * citations for those claims", "make a report") operate on the same document
   * instead of re-searching. Empty on a fresh turn.
   */
  prior?: { connector: ConnectorId; id: string; title: string }[];
}

/**
 * Which audit the orchestrator chose to run:
 *   - "groundedness": faithfulness of one doc (the summary/draft) to the
 *     others (trusted source). No web search.
 *   - "factcheck": web fact-check of one doc's claims (full 3-agent audit).
 *   - "citations": gather supporting AND contradicting web sources for each of
 *     a doc's claims (evidence dossier — no verdict, both sides surfaced).
 */
export type WorkspaceMode = "groundedness" | "factcheck" | "citations";

/** A single web source attached to a claim as for/against evidence. */
export interface EvidenceCitation {
  title: string;
  url: string;
  domain: string;
  snippet: string;
}

export interface ClaimCitations {
  claim: string;
  /** One-line synthesis of where the evidence net lands. */
  stance_summary: string;
  supporting: EvidenceCitation[];
  contradicting: EvidenceCitation[];
}

export interface CitationsReport {
  doc_title: string;
  claims: ClaimCitations[];
}

/** A doc the orchestrator actually used, and the role it played. */
export interface WorkspaceUsedDoc {
  connector: ConnectorId;
  id: string;
  title: string;
  url: string;
  role: "checked" | "source";
}

export interface WorkspaceRunResult {
  mode: WorkspaceMode;
  /** One-line, human explanation of what the orchestrator decided to do. */
  note: string;
  used: WorkspaceUsedDoc[];
  /** Present when mode === "groundedness". */
  groundedness?: GroundednessAudit;
  /** Present when mode === "factcheck". */
  audit?: DocumentAudit;
  /** Present when mode === "citations". */
  citations?: CitationsReport;
}

export type WorkspaceRunResponseBody = WorkspaceRunResult;

// ---- C: Close the loop — write audits back to Notion ----

/**
 * Write an audit report back to Notion as a child "audit report" page
 * (POST /api/connectors/notion/writeback).
 *
 * `parent_page_id` is where the report is filed: when omitted, the route uses
 * the audited Notion page (the "checked" doc) so the report lands right under
 * the source. Requires a connected Notion session. This is the ONE connector
 * operation that WRITES — every other connector op is read-only.
 */
export interface NotionWritebackRequestBody {
  result: WorkspaceRunResult;
  parent_page_id?: string;
}

export interface NotionWritebackResponseBody {
  /** URL of the created Notion report page (may be "" if Notion didn't return one). */
  url: string;
  /** Notion page id of the created report (may be "" if not reported). */
  id: string;
  title: string;
}

// ---- C: Connector watches (scheduled / on-demand re-audits) ----

/**
 * A standing watch on a connector document. Groundtruth re-audits the page on
 * demand (or on a schedule), and — when `writeback` is on and Notion is
 * connected — files the report back as a Notion page automatically.
 *
 * DELIBERATE persistence (mirrors the token store's exception to CLAUDE.md rule
 * 6): only WATCH METADATA is persisted (which page, its content hash for change
 * detection, last-run timestamp, and verdict COUNTS) — never claim text or audit
 * content. The durable audit artifact remains the exported/Notion report.
 */
export interface ConnectorWatch {
  id: string;
  connector: ConnectorId;
  page_id: string;
  title: string;
  url: string;
  /** Auto-file the report back to Notion after each changed re-audit. */
  writeback: boolean;
  last_run_at?: number;
  /** Verdict COUNTS only (no claim text) from the last run, for the list UI. */
  last_summary?: { total: number; flagged: number };
  /** URL of the most recent Notion report written for this watch. */
  last_report_url?: string;
  created_at: number;
}

export interface AddWatchRequestBody {
  connector: ConnectorId;
  page_id: string;
  title: string;
  url?: string;
  writeback?: boolean;
}

export interface UpdateWatchRequestBody {
  writeback?: boolean;
}

export interface WatchListResponseBody {
  watches: ConnectorWatch[];
}

/**
 * Outcome of running a single watch.
 *   - "audited":           page changed (or run was forced) → re-audited.
 *   - "unchanged":         content hash matched the last run → skipped the audit.
 *   - "writeback_skipped": audited, but Notion wasn't connected to file the report.
 *   - "error":             the run failed (see `error`).
 */
export interface WatchRunOutcome {
  watch_id: string;
  status: "audited" | "unchanged" | "writeback_skipped" | "error";
  summary?: { total: number; flagged: number };
  report_url?: string;
  note?: string;
  error?: string;
}

export interface WatchRunRequestBody {
  /** Run one watch by id, or omit to run all watches for the session. */
  id?: string;
  /** Re-audit even when the content hash is unchanged. */
  force?: boolean;
}

export interface WatchRunResponseBody {
  outcomes: WatchRunOutcome[];
}

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
