/**
 * Shared type contracts for the Hallucination Audit Trail.
 *
 * Single source of truth — every module that touches Claims, Verdicts, agent
 * reports, or audits MUST import from this file. Do not redefine these types
 * inside feature modules. See ARCHITECTURE.md §3 and CLAUDE.md "Type contracts"
 * before changing field names or verdict strings.
 */

export type Provider = "openai" | "gemini";

export type ChatModel =
  | "gpt-4o"
  | "gpt-4o-mini"
  | "gemini-1.5-pro"
  | "gemini-1.5-flash";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  provider?: Provider;
  model?: ChatModel;
  timestamp: number;
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

export interface MessageAudit {
  message_id: string;
  claims: ClaimAudit[];
  summary: {
    total_claims: number;
    verified: number;
    unverified_plausible: number;
    contradicted: number;
    likely_hallucination: number;
  };
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
