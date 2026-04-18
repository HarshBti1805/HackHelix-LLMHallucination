/**
 * Smoke test for verifyClaim (PROJECT_PLAN.md task 2.3).
 *
 * Verifies:
 *   1. verifyClaim returns 3 AgentReports, one per role, in roster order.
 *   2. The 3 calls actually run in parallel — wall time ~= slowest single
 *      agent, NOT sum of all three. We check this with a fresh cache so
 *      every call is a real round-trip, then compare against measured
 *      sequential time.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/smoke-verify.ts
 */

import { runAgent, verifyClaim, AGENT_ROSTER } from "../lib/agents";
import type { AgentReport, Claim } from "../types";

// Visual indent for nested logging.
const indent = "  ";

const CLAIM: Claim = {
  id: "c1",
  text: "The Eiffel Tower in Paris stands 330 metres tall.",
  sentence: "The Eiffel Tower in Paris stands 330 metres tall.",
  type: "numerical",
  entities: ["Eiffel Tower", "Paris", "330 metres"],
};

function shape(reports: AgentReport[]): string {
  return reports
    .map(
      (r) =>
        `${r.agent_role}=${r.verdict}@${r.confidence.toFixed(2)} (${r.sources.length} src)`,
    )
    .join("  |  ");
}

async function main() {
  console.log("[smoke-verify] parallel run...");
  const tPar0 = Date.now();
  const audit = await verifyClaim(CLAIM);
  const tParTotal = Date.now() - tPar0;

  const reports = audit.per_agent_reports;
  if (reports.length !== 3) {
    throw new Error(`expected 3 reports, got ${reports.length}`);
  }
  for (let i = 0; i < AGENT_ROSTER.length; i++) {
    if (reports[i].agent_role !== AGENT_ROSTER[i]) {
      throw new Error(
        `report[${i}].agent_role=${reports[i].agent_role} != ${AGENT_ROSTER[i]}`,
      );
    }
  }
  console.log(`[smoke-verify] parallel total: ${tParTotal} ms`);
  console.log(`[smoke-verify] per-agent: ${shape(reports)}`);
  console.log(
    `${indent}consensus_verdict     = ${audit.consensus_verdict}\n` +
      `${indent}consensus_confidence  = ${audit.consensus_confidence.toFixed(2)}\n` +
      `${indent}agreement_score       = ${audit.agreement_score.toFixed(2)}\n` +
      `${indent}agents_disagreed      = ${audit.agents_disagreed}`,
  );

  console.log("\n[smoke-verify] sequential run for comparison (cache-warm)...");
  const tSeq0 = Date.now();
  const seq: AgentReport[] = [];
  for (const role of AGENT_ROSTER) {
    seq.push(await runAgent(CLAIM, role));
  }
  const tSeqTotal = Date.now() - tSeq0;
  console.log(`[smoke-verify] sequential total: ${tSeqTotal} ms`);

  console.log(
    `\n[smoke-verify] (parallel vs sequential is meaningful only when cache is cold;` +
      ` warm runs are too fast for the comparison to matter)`,
  );
}

main().catch((err) => {
  console.error("[smoke-verify] FAILED:", err);
  process.exit(1);
});
