import { openaiJson } from "@/lib/providers/openai";
import { INTERROGATE_PROMPT } from "@/lib/prompts/interrogate";
import {
  type AgentRole,
  type ClaimAudit,
  type InterrogateResponseBody,
  type InterrogationTurn,
  MalformedLLMJsonError,
} from "@/types";

/**
 * "Interrogate the verdict / Ask the auditor".
 *
 * A read-only conversation that lets a reviewer ask why a claim got the
 * verdict it did. The locked auditor (gpt-4o-mini) answers grounded ONLY in
 * the evidence already gathered for that claim — the agent reports, their
 * sources/snippets, the consensus numbers, and any independent cross-check.
 *
 * It deliberately does NOT search the web (CLAUDE.md rule 5 — evidence is
 * gathered once, reused everywhere) and never changes the verdict. When a
 * question needs facts that were never gathered, the auditor abstains rather
 * than answering from parametric memory.
 *
 * One LLM call per question.
 */

const VALID_ROLES: AgentRole[] = ["prosecutor", "defender", "literalist"];

// Mirrors AGENT_ROLE_STANCE in components/audit/verdict.ts. Inlined here so a
// server lib module doesn't import from the client component tree.
const AGENT_STANCE: Record<AgentRole, string> = {
  prosecutor: "Skeptical — assumes claims may be false",
  defender: "Charitable — steelmans the claim",
  literalist: "Literal — checks exact wording only",
};

// Keep the token budget bounded on long threads — only the most recent turns
// are sent back. The claim evidence is always sent in full.
const MAX_HISTORY_TURNS = 10;

interface RawInterrogatePayload {
  answer?: unknown;
  cited_agents?: unknown;
  cited_source_urls?: unknown;
  abstained?: unknown;
}

/**
 * Serialize a `ClaimAudit` into the compact evidence object the prompt
 * expects. This is the auditor's entire evidence universe for the answer —
 * nothing outside it may be asserted as fact.
 */
function buildEvidence(ca: ClaimAudit) {
  return {
    CLAIM: {
      text: ca.claim.text,
      sentence: ca.claim.sentence,
      type: ca.claim.type,
    },
    VERDICT: {
      consensus: ca.consensus_verdict,
      confidence: ca.consensus_confidence,
      agreement_score: ca.agreement_score,
      agents_disagreed: ca.agents_disagreed,
    },
    AGENT_REPORTS: ca.per_agent_reports.map((r) => ({
      role: r.agent_role,
      stance: AGENT_STANCE[r.agent_role],
      verdict: r.verdict,
      confidence: r.confidence,
      reasoning: r.reasoning,
      sources: r.sources.map((s) => ({
        domain: s.domain,
        title: s.title,
        snippet: s.snippet,
        url: s.url,
      })),
    })),
    INDEPENDENT_CHECK: ca.independent_check
      ? {
          stance: ca.independent_check.stance,
          note: ca.independent_check.note,
          escalated: ca.independent_check.escalated,
        }
      : null,
  };
}

/** Every source URL present in the gathered evidence, for citation filtering. */
function evidenceUrls(ca: ClaimAudit): Set<string> {
  const urls = new Set<string>();
  for (const report of ca.per_agent_reports) {
    for (const src of report.sources) {
      if (src.url) urls.add(src.url);
    }
  }
  return urls;
}

export async function interrogateClaim(
  claimAudit: ClaimAudit,
  history: InterrogationTurn[],
  question: string,
): Promise<InterrogateResponseBody> {
  const trimmedHistory = history
    .slice(-MAX_HISTORY_TURNS)
    .map((t) => ({ role: t.role, content: t.content }));

  const payload = JSON.stringify({
    ...buildEvidence(claimAudit),
    HISTORY: trimmedHistory,
    QUESTION: question,
  });

  const raw = await openaiJson<RawInterrogatePayload>(
    INTERROGATE_PROMPT,
    payload,
  );

  if (!raw || typeof raw.answer !== "string" || raw.answer.trim().length === 0) {
    throw new MalformedLLMJsonError(
      "Interrogator did not return a non-empty `answer` string.",
      JSON.stringify(raw).slice(0, 500),
    );
  }

  // cited_agents: keep only the three known roles.
  const citedAgents = Array.isArray(raw.cited_agents)
    ? (raw.cited_agents.filter(
        (a): a is AgentRole =>
          typeof a === "string" && VALID_ROLES.includes(a as AgentRole),
      ) as AgentRole[])
    : [];

  // cited_source_urls: drop anything the model invents that is not in the
  // gathered evidence. The auditor must never surface a URL it didn't audit.
  const allowed = evidenceUrls(claimAudit);
  const citedUrls = Array.isArray(raw.cited_source_urls)
    ? raw.cited_source_urls.filter(
        (u): u is string => typeof u === "string" && allowed.has(u),
      )
    : [];

  return {
    answer: raw.answer.trim(),
    cited_agents: Array.from(new Set(citedAgents)),
    cited_source_urls: Array.from(new Set(citedUrls)),
    abstained: raw.abstained === true,
  };
}
