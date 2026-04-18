import {
  type AgentReport,
  type AgentRole,
  type Claim,
  type ClaimAudit,
  type EvidenceSource,
  MalformedLLMJsonError,
  type Verdict,
} from "@/types";
import { openaiJson } from "@/lib/providers/openai";
import { search } from "@/lib/search";
import { aggregate } from "@/lib/aggregate";
import { PROSECUTOR_PROMPT } from "@/lib/prompts/prosecutor";
import { DEFENDER_PROMPT } from "@/lib/prompts/defender";
import { LITERALIST_PROMPT } from "@/lib/prompts/literalist";

/**
 * Subagent runner.
 *
 * Per CLAUDE.md, this module:
 *   - Defines the three role prompts via imports (one file per role).
 *   - Runs subagents IN PARALLEL when verifying a claim. Subagents must not
 *     see each other's outputs.
 *   - Does NOT extract claims, does NOT compute consensus (that's
 *     `lib/aggregate.ts`).
 *
 * `runAgent(claim, role)` is a single subagent end-to-end: search → reason →
 * AgentReport. `verifyClaim(claim)` (added in task 2.3) fans out all three.
 */

// High-trust domain whitelist for the Literalist. Adjustable here without
// touching prompts. Picked for breadth (encyclopedic, scientific, official).
export const LITERALIST_DOMAINS: string[] = [
  "wikipedia.org",
  "britannica.com",
  "nature.com",
  "science.org",
  "arxiv.org",
  "semanticscholar.org",
  "ncbi.nlm.nih.gov",
  "who.int",
  "cdc.gov",
  "nih.gov",
  "data.gov",
  "europa.eu",
  "un.org",
  "worldbank.org",
];

const MAX_SEARCH_RESULTS = 6;

const AGENT_PROMPTS: Record<AgentRole, string> = {
  prosecutor: PROSECUTOR_PROMPT,
  defender: DEFENDER_PROMPT,
  literalist: LITERALIST_PROMPT,
};

const VALID_VERDICTS: Verdict[] = [
  "verified",
  "unverified_plausible",
  "contradicted",
  "likely_hallucination",
];

interface RawAgentResponse {
  verdict?: unknown;
  confidence?: unknown;
  reasoning?: unknown;
  cited_source_indices?: unknown;
}

/**
 * Build the search query a subagent will run for the given claim.
 * Heuristic: prefer the claim text itself (it's already a single declarative
 * sentence from the extractor), augmented with the most distinctive entity
 * tokens. The exact phrasing matters less than getting the right page in
 * the top 5 results — Tavily handles ranking from there.
 */
function buildSearchQuery(claim: Claim): string {
  const distinctiveEntities = claim.entities.filter((e) => e.length > 0);
  if (distinctiveEntities.length === 0) return claim.text;
  return `${claim.text} ${distinctiveEntities.join(" ")}`;
}

/** Render the evidence list as the numbered block the prompts reference. */
function formatEvidence(sources: EvidenceSource[]): string {
  if (sources.length === 0) {
    return "(no evidence retrieved — return unverified_plausible with low confidence)";
  }
  return sources
    .map((s, i) => {
      const snippet = s.snippet.replace(/\s+/g, " ").slice(0, 600);
      return `[${i}] ${s.title} — ${s.domain}\nURL: ${s.url}\nSnippet: ${snippet}`;
    })
    .join("\n\n");
}

/** Build the user-message body the role prompt expects. */
function buildUserPrompt(claim: Claim, sources: EvidenceSource[]): string {
  return [
    "CLAIM TO EVALUATE",
    `Type: ${claim.type}`,
    `Sentence (verbatim): ${claim.sentence}`,
    `Restated claim: ${claim.text}`,
    `Key entities: ${claim.entities.join(", ") || "(none provided)"}`,
    "",
    "EVIDENCE (numbered)",
    formatEvidence(sources),
  ].join("\n");
}

/**
 * Parse the model's JSON response and assemble a typed AgentReport.
 * Maps `cited_source_indices` back to the actual EvidenceSource objects so
 * the model never has the chance to fabricate URLs or quotes.
 */
function buildReport(
  role: AgentRole,
  sources: EvidenceSource[],
  raw: RawAgentResponse,
): AgentReport {
  if (!raw || typeof raw !== "object") {
    throw new MalformedLLMJsonError(
      `${role} returned a non-object payload.`,
      JSON.stringify(raw).slice(0, 500),
    );
  }
  const verdict = VALID_VERDICTS.includes(raw.verdict as Verdict)
    ? (raw.verdict as Verdict)
    : null;
  if (!verdict) {
    throw new MalformedLLMJsonError(
      `${role} returned an invalid verdict: ${JSON.stringify(raw.verdict)}`,
      JSON.stringify(raw).slice(0, 500),
    );
  }

  const confidenceRaw = typeof raw.confidence === "number" ? raw.confidence : 0;
  const confidence = Math.max(0, Math.min(1, confidenceRaw));

  const reasoning =
    typeof raw.reasoning === "string" && raw.reasoning.trim().length > 0
      ? raw.reasoning.trim()
      : "(no reasoning provided)";

  const indices = Array.isArray(raw.cited_source_indices)
    ? raw.cited_source_indices
        .filter((i): i is number => typeof i === "number" && Number.isInteger(i))
        .filter((i) => i >= 0 && i < sources.length)
    : [];
  const seen = new Set<number>();
  const cited: EvidenceSource[] = [];
  for (const i of indices) {
    if (seen.has(i)) continue;
    seen.add(i);
    cited.push(sources[i]);
  }

  return {
    agent_role: role,
    verdict,
    confidence,
    reasoning,
    sources: cited,
  };
}

/** Verdict to use when the agent cannot run at all (e.g. search hard-failed). */
function emptyEvidenceReport(role: AgentRole, reason: string): AgentReport {
  return {
    agent_role: role,
    verdict: "unverified_plausible",
    confidence: 0.1,
    reasoning: `No evidence available (${reason}); defaulting to unverified_plausible per ARCHITECTURE.md §10.`,
    sources: [],
  };
}

/**
 * The fixed roster of subagent roles. Order is stable and does NOT imply
 * any precedence — `verifyClaim` runs them all in parallel.
 */
export const AGENT_ROSTER: AgentRole[] = ["prosecutor", "defender", "literalist"];

/**
 * Verify a single claim by running all subagents IN PARALLEL, then
 * combining their reports into a `ClaimAudit`.
 *
 * Independence guarantee (CLAUDE.md core rule 3): each `runAgent` call
 * receives only the claim — never another agent's output, evidence, or
 * verdict. `Promise.all` enforces concurrency; the architecture enforces
 * isolation by virtue of `runAgent` taking no inter-agent inputs.
 *
 * `per_agent_reports` in the returned audit preserves `AGENT_ROSTER` order
 * so the UI can show prosecutor / defender / literalist columns stably.
 */
export async function verifyClaim(claim: Claim): Promise<ClaimAudit> {
  const reports = await Promise.all(
    AGENT_ROSTER.map((role) => runAgent(claim, role)),
  );
  return aggregate(claim, reports);
}

/**
 * Run a single subagent end-to-end for one claim.
 * Independence: this function does not see other agents' outputs by design.
 */
export async function runAgent(
  claim: Claim,
  role: AgentRole,
): Promise<AgentReport> {
  const prompt = AGENT_PROMPTS[role];
  if (!prompt) {
    throw new Error(`Unknown agent role: ${role}`);
  }

  const query = buildSearchQuery(claim);
  const searchOpts =
    role === "literalist"
      ? { includeDomains: LITERALIST_DOMAINS, maxResults: MAX_SEARCH_RESULTS }
      : { maxResults: MAX_SEARCH_RESULTS };

  let sources: EvidenceSource[] = [];
  try {
    sources = await search(query, searchOpts);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown search error";
    console.error(`[agents/${role}] search failed:`, reason);
    return emptyEvidenceReport(role, `search error: ${reason.slice(0, 120)}`);
  }

  let raw: RawAgentResponse;
  try {
    raw = await openaiJson<RawAgentResponse>(
      prompt,
      buildUserPrompt(claim, sources),
    );
  } catch (err) {
    if (err instanceof MalformedLLMJsonError) throw err;
    const reason = err instanceof Error ? err.message : "unknown LLM error";
    console.error(`[agents/${role}] LLM call failed:`, reason);
    return emptyEvidenceReport(role, `LLM error: ${reason.slice(0, 120)}`);
  }

  return buildReport(role, sources, raw);
}
