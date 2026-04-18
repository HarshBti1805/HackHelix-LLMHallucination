/**
 * End-to-end smoke test of the audit pipeline (PROJECT_PLAN.md task 2.6).
 *
 *   extractClaims → verifyClaim (parallel × 3 agents) → aggregate → MessageAudit
 *
 * Input: a synthetic assistant response we control, mixing
 *   (a) one obvious truth   — Eiffel Tower height
 *   (b) one obvious hallucination — a fabricated 2021 Johnson et al. study
 *       on intermittent fasting (this is the exact failure mode CLAUDE.md
 *       lists as demo priority #1).
 *
 * The script just runs the pipeline and prints the full MessageAudit.
 * Tasks 2.7 and 2.8 will assert specific outcomes against this output.
 *
 *   npx tsx --env-file=.env.local scripts/smoke-audit.ts
 */

import { auditMessage } from "../lib/audit";

const MESSAGE_ID = "smoke-msg-1";

const RESPONSE = `The Eiffel Tower in Paris stands 330 metres tall including its antenna. According to a 2021 study by Johnson et al. published in the Journal of Clinical Nutrition, intermittent fasting for 16 hours daily reduces visceral fat by 27% in adults over a 12-week period.`;

async function main() {
  console.log("[smoke-audit] input message:");
  console.log("  " + RESPONSE.replace(/\n/g, "\n  "));
  console.log("");

  const t0 = Date.now();
  const audit = await auditMessage(MESSAGE_ID, RESPONSE);
  const elapsed = Date.now() - t0;

  console.log(`[smoke-audit] pipeline completed in ${elapsed} ms`);
  console.log(`[smoke-audit] message_id: ${audit.message_id}`);
  console.log(`[smoke-audit] summary:`, audit.summary);
  console.log("");

  audit.claims.forEach((ca, i) => {
    console.log(`─── claim ${i + 1} / ${audit.claims.length} ───`);
    console.log(`  id:           ${ca.claim.id}`);
    console.log(`  type:         ${ca.claim.type}`);
    console.log(`  text:         ${ca.claim.text}`);
    console.log(`  sentence:     ${ca.claim.sentence}`);
    console.log(`  entities:     ${JSON.stringify(ca.claim.entities)}`);
    console.log(`  consensus:    ${ca.consensus_verdict}` +
      `  conf=${ca.consensus_confidence.toFixed(2)}` +
      `  agreement=${ca.agreement_score.toFixed(2)}` +
      `  disagreed=${ca.agents_disagreed}`);
    console.log(`  per-agent:`);
    for (const r of ca.per_agent_reports) {
      console.log(
        `    ${r.agent_role.padEnd(11)} ${r.verdict.padEnd(22)} ` +
          `conf=${r.confidence.toFixed(2)}  sources=${r.sources.length}`,
      );
      console.log(`      reasoning: ${oneLine(r.reasoning)}`);
    }
    console.log("");
  });

  console.log("[smoke-audit] full MessageAudit JSON:");
  console.log(JSON.stringify(audit, null, 2));
}

function oneLine(s: string): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > 200 ? flat.slice(0, 200) + "…" : flat;
}

main().catch((err) => {
  console.error("[smoke-audit] FAILED:", err);
  process.exit(1);
});
