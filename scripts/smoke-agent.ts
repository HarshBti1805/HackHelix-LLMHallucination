/**
 * Smoke test for lib/agents.ts runAgent (PROJECT_PLAN.md task 2.2).
 *
 * Hits one obvious truth and one obvious citation hallucination through each
 * of the three subagent roles, and prints verdict + reasoning. We are NOT
 * yet asserting agreement/disagreement — that is task 2.7/2.8. Goal here is
 * just: each agent runs end-to-end and returns a structurally valid report.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/smoke-agent.ts
 */

import { runAgent } from "../lib/agents";
import type { AgentRole, Claim } from "../types";

const ROLES: AgentRole[] = ["prosecutor", "defender", "literalist"];

const TRUE_CLAIM: Claim = {
  id: "c1",
  text: "The Eiffel Tower in Paris stands 330 metres tall.",
  sentence: "The Eiffel Tower in Paris stands 330 metres tall.",
  type: "numerical",
  entities: ["Eiffel Tower", "Paris", "330 metres"],
};

const HALLUCINATED_CLAIM: Claim = {
  id: "c2",
  text: "Johnson et al. (2021) in Nature reported that intermittent fasting reduced fasting glucose by 14% in adults with prediabetes.",
  sentence: TRUE_CLAIM.sentence,
  type: "citation",
  entities: ["Johnson et al.", "2021", "Nature", "intermittent fasting", "14%"],
};

async function runOne(label: string, claim: Claim) {
  console.log(`\n=== ${label} ===`);
  console.log(`claim: ${claim.text}\n`);
  for (const role of ROLES) {
    const t0 = Date.now();
    const report = await runAgent(claim, role);
    const ms = Date.now() - t0;
    console.log(
      `[${role}] verdict=${report.verdict} confidence=${report.confidence.toFixed(2)} ` +
        `sources=${report.sources.length} (${ms} ms)`,
    );
    console.log(`  reason: ${report.reasoning.slice(0, 280)}`);
  }
}

async function main() {
  await runOne("TRUE CLAIM", TRUE_CLAIM);
  await runOne("HALLUCINATED CITATION", HALLUCINATED_CLAIM);
}

main().catch((err) => {
  console.error("[smoke-agent] FAILED:", err);
  process.exit(1);
});
