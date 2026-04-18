/**
 * Unit tests for lib/aggregate.ts (PROJECT_PLAN.md task 2.5).
 *
 * `aggregate` is a pure function, so this file uses synthetic AgentReports
 * — no LLM, no search, no env needed. Run:
 *
 *   npx tsx scripts/test-aggregate.ts
 *
 * Exit code is non-zero on any failure so CI/Make targets can catch
 * regressions later.
 */

import {
  aggregate,
  agreementScore,
  consensusVerdict,
} from "../lib/aggregate";
import type { AgentReport, AgentRole, Claim, Verdict } from "../types";

const CLAIM: Claim = {
  id: "c1",
  text: "synthetic claim",
  sentence: "synthetic claim.",
  type: "entity",
  entities: ["synthetic"],
};

function report(
  role: AgentRole,
  verdict: Verdict,
  confidence: number,
): AgentReport {
  return {
    agent_role: role,
    verdict,
    confidence,
    reasoning: "synthetic",
    sources: [],
  };
}

let passed = 0;
let failed = 0;

function assertEq<T>(label: string, actual: T, expected: T) {
  const ok = Object.is(actual, expected);
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`);
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
  }
}

function assertClose(label: string, actual: number, expected: number) {
  const ok = Math.abs(actual - expected) < 1e-9;
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}  (${actual})`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`);
    console.log(`      expected: ${expected}`);
    console.log(`      actual:   ${actual}`);
  }
}

// ---------------------------------------------------------------- agreement

console.log("\nagreement_score: canonical 3-agent cases");
{
  const allSame: AgentReport[] = [
    report("prosecutor", "verified", 0.9),
    report("defender", "verified", 0.9),
    report("literalist", "verified", 0.9),
  ];
  assertClose("3 agents, all same verdict → 1.0", agreementScore(allSame), 1.0);

  const twoDistinct: AgentReport[] = [
    report("prosecutor", "verified", 0.9),
    report("defender", "verified", 0.9),
    report("literalist", "contradicted", 0.9),
  ];
  assertClose(
    "3 agents, 2 distinct verdicts → 0.5",
    agreementScore(twoDistinct),
    0.5,
  );

  const threeDistinct: AgentReport[] = [
    report("prosecutor", "verified", 0.9),
    report("defender", "unverified_plausible", 0.9),
    report("literalist", "contradicted", 0.9),
  ];
  assertClose(
    "3 agents, 3 distinct verdicts → 0.0",
    agreementScore(threeDistinct),
    0.0,
  );
}

console.log("\nagreement_score: edge cases");
{
  assertClose("0 agents → 1.0 (vacuous)", agreementScore([]), 1.0);
  assertClose(
    "1 agent → 1.0",
    agreementScore([report("prosecutor", "verified", 0.5)]),
    1.0,
  );
  assertClose(
    "2 agents, same → 1.0",
    agreementScore([
      report("prosecutor", "verified", 0.5),
      report("defender", "verified", 0.5),
    ]),
    1.0,
  );
  assertClose(
    "2 agents, different → 0.5",
    agreementScore([
      report("prosecutor", "verified", 0.5),
      report("defender", "contradicted", 0.5),
    ]),
    0.5,
  );
}

// --------------------------------------------------------------- consensus

console.log("\nconsensus_verdict: majority rules");
{
  assertEq(
    "2 verified + 1 contradicted → verified",
    consensusVerdict([
      report("prosecutor", "verified", 0.9),
      report("defender", "verified", 0.9),
      report("literalist", "contradicted", 0.9),
    ]),
    "verified",
  );

  assertEq(
    "2 likely_hallucination + 1 verified → likely_hallucination",
    consensusVerdict([
      report("prosecutor", "likely_hallucination", 0.9),
      report("defender", "likely_hallucination", 0.9),
      report("literalist", "verified", 0.9),
    ]),
    "likely_hallucination",
  );
}

console.log("\nconsensus_verdict: ties → most severe");
{
  // 1-1-1 split across all four severity classes is impossible with 3
  // agents, but a tie at the top is. Severity order from the spec:
  //   likely_hallucination > contradicted > unverified_plausible > verified
  assertEq(
    "1-1-1 [verified, contradicted, likely_hallucination] → likely_hallucination",
    consensusVerdict([
      report("prosecutor", "verified", 0.9),
      report("defender", "contradicted", 0.9),
      report("literalist", "likely_hallucination", 0.9),
    ]),
    "likely_hallucination",
  );

  assertEq(
    "1-1-1 [verified, unverified_plausible, contradicted] → contradicted",
    consensusVerdict([
      report("prosecutor", "verified", 0.9),
      report("defender", "unverified_plausible", 0.9),
      report("literalist", "contradicted", 0.9),
    ]),
    "contradicted",
  );

  // 2 each — only possible with even agent counts. Included for safety
  // since clamp logic must handle it.
  assertEq(
    "tie at top [verified, verified, contradicted, contradicted] → contradicted",
    consensusVerdict([
      report("prosecutor", "verified", 0.9),
      report("defender", "verified", 0.9),
      report("literalist", "contradicted", 0.9),
      report("literalist", "contradicted", 0.9),
    ]),
    "contradicted",
  );
}

// --------------------------------------------------------------- aggregate

console.log("\naggregate: full ClaimAudit assembly");
{
  const reports: AgentReport[] = [
    report("prosecutor", "verified", 0.8),
    report("defender", "verified", 1.0),
    report("literalist", "contradicted", 0.6),
  ];
  const audit = aggregate(CLAIM, reports);

  assertEq("claim is preserved by reference", audit.claim, CLAIM);
  assertEq("consensus_verdict = verified", audit.consensus_verdict, "verified");
  assertClose(
    "consensus_confidence = mean(0.8, 1.0, 0.6) = 0.8",
    audit.consensus_confidence,
    0.8,
  );
  assertClose("agreement_score = 0.5", audit.agreement_score, 0.5);
  assertEq("agents_disagreed = true", audit.agents_disagreed, true);
  assertEq(
    "per_agent_reports preserved in order",
    audit.per_agent_reports,
    reports,
  );
}

console.log("\naggregate: confidence clamping on bad inputs");
{
  // Defensive: aggregator must never propagate out-of-range confidences
  // even if a misbehaving agent returns >1 or <0.
  const reports: AgentReport[] = [
    report("prosecutor", "verified", 1.5),
    report("defender", "verified", -0.2),
    report("literalist", "verified", 0.5),
  ];
  const audit = aggregate(CLAIM, reports);
  assertClose(
    "confidences clamped before averaging → mean(1.0, 0.0, 0.5) = 0.5",
    audit.consensus_confidence,
    0.5,
  );
}

console.log("\naggregate: unanimous case");
{
  const reports: AgentReport[] = [
    report("prosecutor", "likely_hallucination", 0.95),
    report("defender", "likely_hallucination", 0.85),
    report("literalist", "likely_hallucination", 0.90),
  ];
  const audit = aggregate(CLAIM, reports);
  assertEq(
    "consensus = likely_hallucination",
    audit.consensus_verdict,
    "likely_hallucination",
  );
  assertClose("agreement = 1.0", audit.agreement_score, 1.0);
  assertEq("agents_disagreed = false", audit.agents_disagreed, false);
  assertClose("confidence ≈ 0.9", audit.consensus_confidence, 0.9);
}

// ----------------------------------------------------------------- summary

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
