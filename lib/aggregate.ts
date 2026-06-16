import type {
  AgentReport,
  Claim,
  ClaimAudit,
  ClaimType,
  Verdict,
} from "@/types";

/**
 * Consensus aggregator for subagent reports.
 *
 * This module is pure — no I/O, no async, no LLM calls — so it is
 * unit-testable in isolation (PROJECT_PLAN.md task 2.5).
 *
 * Rules from ARCHITECTURE.md §5.6:
 *   - consensus_verdict:    WEIGHTED majority vote across agents. Ties broken
 *                           by the MOST SEVERE verdict (bias toward caution).
 *   - consensus_confidence: arithmetic mean of per-agent confidences.
 *   - agreement_score:      1 - (distinctVerdicts - 1) / 2, clamped to [0, 1].
 *                           3 same → 1.0, 2 distinct → 0.5, 3 distinct → 0.0.
 *   - agents_disagreed:     true when any two agents returned different
 *                           verdicts.
 *
 * ── A1: claim-type-aware weighting (MAJOR_CHANGES.md, "smarter auditor") ──
 * Plain majority vote has a documented failure mode (README "Strict date/year
 * verification can be outvoted"): on a fabricated date/citation the Literalist
 * correctly returns `contradicted` from a high-trust, domain-scoped source, but
 * the Prosecutor and Defender — fed adjacent-topic web results — both `verified`,
 * and 2-of-3 majority reports the fabrication as `verified`.
 *
 * The fix: for `citation` and `numerical` claims ONLY, a Literalist SEVERE
 * verdict (`contradicted` / `likely_hallucination`) that is BACKED BY at least
 * one cited high-trust source carries extra voting weight — enough to overturn
 * a 2-vote benign majority. The Literalist is the only agent that searches
 * domain-scoped trusted sources, so on exactly the claim types where "absence
 * on a trusted index" is meaningful (dates, fabricated papers) its evidence is
 * the most trustworthy signal. Entity claims and unsupported verdicts are
 * unaffected, and `agreement_score` / `agents_disagreed` still reflect the RAW
 * verdict spread so the UI surfaces the disagreement regardless of who won.
 */

/**
 * Severity ordering used for tie-breaking. Higher index = more severe / more
 * alarming. A 1-1-1 split therefore resolves to whichever of the tied
 * verdicts ranks highest here, ensuring the UI never under-reports a
 * potential hallucination.
 */
const SEVERITY: Verdict[] = [
  "verified",
  "unverified_plausible",
  "contradicted",
  "likely_hallucination",
];

function severityRank(v: Verdict): number {
  const i = SEVERITY.indexOf(v);
  return i < 0 ? -1 : i;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Claim types for which a domain-scoped Literalist contradiction is the most
 * trustworthy signal (see A1 note above). On these, "no trusted source backs
 * this exact date/reference" is strong evidence of fabrication.
 */
const LITERALIST_WEIGHTED_TYPES: ClaimType[] = ["citation", "numerical"];

const SEVERE_VERDICTS: Verdict[] = ["contradicted", "likely_hallucination"];

/**
 * Voting weight for a single agent report under the given claim type.
 *
 * Default is 1.0 (one agent, one vote). The one exception (A1): a Literalist
 * SEVERE verdict on a citation/numerical claim, backed by ≥1 cited source,
 * gets 2.5 — enough to overturn a 2-vote benign majority (2.0) while staying
 * a no-op for entity claims, unsupported verdicts, and the other two agents.
 */
function voteWeight(report: AgentReport, claimType?: ClaimType): number {
  if (
    claimType &&
    LITERALIST_WEIGHTED_TYPES.includes(claimType) &&
    report.agent_role === "literalist" &&
    SEVERE_VERDICTS.includes(report.verdict) &&
    report.sources.length > 0
  ) {
    return 2.5;
  }
  return 1;
}

/**
 * Pick the consensus verdict by WEIGHTED majority vote, breaking ties on
 * severity. `claimType` is optional: when omitted (e.g. unit tests, callers
 * that don't care), every report weighs 1.0 and this reduces to a plain
 * majority vote — preserving the original behavior exactly. The production
 * path (`aggregate`) always passes the claim type so A1 weighting applies.
 *
 * Exported for unit-test reuse.
 */
export function consensusVerdict(
  reports: AgentReport[],
  claimType?: ClaimType,
): Verdict {
  if (reports.length === 0) return "unverified_plausible";

  const weights = new Map<Verdict, number>();
  for (const r of reports) {
    weights.set(r.verdict, (weights.get(r.verdict) ?? 0) + voteWeight(r, claimType));
  }

  let topWeight = 0;
  for (const w of weights.values()) if (w > topWeight) topWeight = w;

  let chosen: Verdict | null = null;
  for (const [verdict, weight] of weights) {
    // Float-safe equality for the tie check.
    if (Math.abs(weight - topWeight) > 1e-9) continue;
    if (chosen === null || severityRank(verdict) > severityRank(chosen)) {
      chosen = verdict;
    }
  }
  return chosen ?? "unverified_plausible";
}

/**
 * Agreement score in [0, 1]. 1.0 = total consensus, 0.0 = maximum spread.
 * Formula assumes 3 agents (the project default); for arbitrary N the
 * clamping prevents negative outputs but the curve no longer means quite
 * the same thing — see ARCHITECTURE.md §12.
 */
export function agreementScore(reports: AgentReport[]): number {
  if (reports.length <= 1) return 1;
  const distinct = new Set(reports.map((r) => r.verdict)).size;
  return clamp01(1 - (distinct - 1) / 2);
}

/**
 * Combine subagent reports for one claim into a ClaimAudit.
 */
export function aggregate(
  claim: Claim,
  reports: AgentReport[],
): ClaimAudit {
  const verdict = consensusVerdict(reports, claim.type);
  const confidence =
    reports.length === 0
      ? 0
      : reports.reduce((acc, r) => acc + clamp01(r.confidence), 0) /
        reports.length;
  const agreement = agreementScore(reports);
  const disagreed = new Set(reports.map((r) => r.verdict)).size > 1;

  return {
    claim,
    consensus_verdict: verdict,
    consensus_confidence: confidence,
    agreement_score: agreement,
    agents_disagreed: disagreed,
    per_agent_reports: reports,
  };
}
