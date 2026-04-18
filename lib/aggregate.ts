import type {
  AgentReport,
  Claim,
  ClaimAudit,
  Verdict,
} from "@/types";

/**
 * Consensus aggregator for subagent reports.
 *
 * This module is pure — no I/O, no async, no LLM calls — so it is
 * unit-testable in isolation (PROJECT_PLAN.md task 2.5).
 *
 * Rules from ARCHITECTURE.md §5.6:
 *   - consensus_verdict:    majority vote across agents. Ties broken by the
 *                           MOST SEVERE verdict (bias toward caution).
 *   - consensus_confidence: arithmetic mean of per-agent confidences.
 *   - agreement_score:      1 - (distinctVerdicts - 1) / 2, clamped to [0, 1].
 *                           3 same → 1.0, 2 distinct → 0.5, 3 distinct → 0.0.
 *   - agents_disagreed:     true when any two agents returned different
 *                           verdicts.
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
 * Pick the consensus verdict by majority vote, breaking ties on severity.
 * Exported for unit-test reuse; the production path goes through `aggregate`.
 */
export function consensusVerdict(reports: AgentReport[]): Verdict {
  if (reports.length === 0) return "unverified_plausible";

  const counts = new Map<Verdict, number>();
  for (const r of reports) {
    counts.set(r.verdict, (counts.get(r.verdict) ?? 0) + 1);
  }

  let topCount = 0;
  for (const c of counts.values()) if (c > topCount) topCount = c;

  let chosen: Verdict | null = null;
  for (const [verdict, count] of counts) {
    if (count !== topCount) continue;
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
  const verdict = consensusVerdict(reports);
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
