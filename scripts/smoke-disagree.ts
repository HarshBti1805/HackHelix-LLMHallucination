/**
 * Disagreement smoke test (PROJECT_PLAN.md task 2.8).
 *
 * Confirms two things at once:
 *   (a) The truth path still produces 3-way agreement (Eiffel Tower).
 *   (b) A genuinely contested claim produces visible per-agent disagreement
 *       (agents_disagreed = true, >= 2 distinct verdicts).
 *
 * The contested claim is the Tesla founding question:
 *   "Tesla was founded by Elon Musk in 2003."
 *
 * This is an ENTITY claim (not citation), so the tightened citation rules
 * from task 2.7 don't apply — the agents are free to land where their
 * stances actually take them. The historical record is genuinely mixed:
 *   - Eberhard and Tarpenning incorporated Tesla Motors on 1 Jul 2003.
 *   - Musk led the Series A in Feb 2004 and became chairman.
 *   - A 2009 settlement formally designated Musk a "co-founder".
 * So:
 *   - Literalist should fail the word-for-word check on "founded by".
 *   - Defender should steelman ("commonly described as a Tesla founder").
 *   - Prosecutor should attack the literal falsehood.
 *
 * If we get matching verdicts here, the prompts are too close — see
 * CLAUDE.md guidance: "If two agents produce similar-sounding reasoning,
 * the prompts are too close — fix the prompts, don't add more agents."
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/smoke-disagree.ts
 */

import { auditMessage } from "../lib/audit";
import type { AgentReport, ClaimAudit } from "../types";

const MESSAGE_ID = "smoke-disagree-1";

const RESPONSE = `The Eiffel Tower in Paris stands 330 metres tall including its antenna. Tesla was founded by Elon Musk in 2003.`;

async function main() {
  console.log("[smoke-disagree] input:");
  console.log("  " + RESPONSE);
  console.log("");

  const t0 = Date.now();
  const audit = await auditMessage(MESSAGE_ID, RESPONSE);
  const elapsed = Date.now() - t0;

  console.log(`[smoke-disagree] pipeline ${elapsed} ms`);
  console.log(`[smoke-disagree] summary:`, audit.summary);
  console.log("");

  audit.claims.forEach((ca, i) => {
    printClaim(i, ca);
  });

  // ---- assertions ----------------------------------------------------------
  const truth = audit.claims.find((c) =>
    c.claim.entities.includes("Eiffel Tower"),
  );
  const tesla = audit.claims.find((c) =>
    c.claim.entities.some((e) => /tesla/i.test(e)),
  );

  let failed = 0;
  failed += assert("found Eiffel Tower claim", !!truth);
  failed += assert("found Tesla claim", !!tesla);
  if (truth) {
    failed += assert(
      "Eiffel Tower consensus = verified",
      truth.consensus_verdict === "verified",
    );
    failed += assert(
      "Eiffel Tower agreement = 1.0",
      truth.agreement_score === 1.0,
    );
    failed += assert(
      "Eiffel Tower confidence ~ 0.9 (>= 0.8)",
      truth.consensus_confidence >= 0.8,
    );
    failed += assert(
      "Eiffel Tower agents_disagreed = false",
      truth.agents_disagreed === false,
    );
  }
  if (tesla) {
    const distinct = new Set(
      tesla.per_agent_reports.map((r) => r.verdict),
    ).size;
    failed += assert(
      "Tesla agents_disagreed = true",
      tesla.agents_disagreed === true,
    );
    failed += assert(
      `Tesla has >= 2 distinct verdicts (saw ${distinct})`,
      distinct >= 2,
    );

    console.log("─── Tesla per-agent reasoning (full) ───");
    for (const r of tesla.per_agent_reports) {
      printFullReport(r);
    }
  }

  console.log(`\n[smoke-disagree] ${failed === 0 ? "ALL ASSERTIONS PASS" : `${failed} ASSERTION(S) FAILED`}`);
  if (failed > 0) process.exit(1);
}

function printClaim(i: number, ca: ClaimAudit) {
  console.log(`─── claim ${i + 1} ───`);
  console.log(`  text:      ${ca.claim.text}`);
  console.log(`  type:      ${ca.claim.type}`);
  console.log(`  entities:  ${JSON.stringify(ca.claim.entities)}`);
  console.log(
    `  consensus: ${ca.consensus_verdict}` +
      `  conf=${ca.consensus_confidence.toFixed(2)}` +
      `  agreement=${ca.agreement_score.toFixed(2)}` +
      `  disagreed=${ca.agents_disagreed}`,
  );
  for (const r of ca.per_agent_reports) {
    console.log(
      `    ${r.agent_role.padEnd(11)} ${r.verdict.padEnd(22)} ` +
        `conf=${r.confidence.toFixed(2)}  sources=${r.sources.length}`,
    );
  }
  console.log("");
}

function printFullReport(r: AgentReport) {
  console.log(`\n  [${r.agent_role.toUpperCase()}] verdict=${r.verdict} conf=${r.confidence}`);
  console.log(`  reasoning: ${r.reasoning}`);
  if (r.sources.length > 0) {
    console.log(`  sources cited (${r.sources.length}):`);
    for (const s of r.sources) {
      console.log(`    - ${s.title} [${s.domain || s.url}]`);
    }
  } else {
    console.log(`  sources cited: none`);
  }
}

function assert(label: string, cond: boolean): number {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  return cond ? 0 : 1;
}

main().catch((err) => {
  console.error("[smoke-disagree] FAILED:", err);
  process.exit(1);
});
