/**
 * Smoke test for lib/extract.ts (PROJECT_PLAN.md task 1.4).
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/smoke-extract.ts
 *
 * The test paragraph is engineered to mix:
 *   - obvious numerical claims      (extractor SHOULD pick up)
 *   - obvious entity claims         (extractor SHOULD pick up)
 *   - an obvious citation claim     (extractor SHOULD pick up)
 *   - an opinion                    (extractor SHOULD reject)
 *   - a prediction                  (extractor SHOULD reject)
 *   - a definition                  (extractor SHOULD reject)
 */

import { extractClaims } from "../lib/extract";

const PARAGRAPH = `
The Eiffel Tower in Paris stands 330 metres tall and was completed in 1889
for the Exposition Universelle. Marie Curie, born in Warsaw in 1867, won
two Nobel Prizes — one in Physics in 1903 and one in Chemistry in 1911.
A 2021 study by Johnson et al. in Nature reported that intermittent fasting
reduced fasting glucose by 14% in adults with prediabetes. Many people
believe Paris is the most beautiful city in Europe. By 2050, more than half
of all new cars sold worldwide will be electric. An algorithm is a finite
sequence of well-defined instructions.
`.trim();

async function main() {
  console.log("[smoke-extract] paragraph:\n" + PARAGRAPH + "\n");

  const claims = await extractClaims(PARAGRAPH);
  console.log(`[smoke-extract] extracted ${claims.length} claims\n`);

  for (const c of claims) {
    console.log(`- id:       ${c.id}`);
    console.log(`  type:     ${c.type}`);
    console.log(`  text:     ${c.text}`);
    console.log(`  entities: [${c.entities.join(", ")}]`);
    console.log();
  }

  const expectExtracted = [
    "330 metres",
    "1889",
    "Marie Curie",
    "1867",
    "1903",
    "1911",
    "Johnson",
    "14%",
  ];
  const expectRejected = [
    "most beautiful city",
    "By 2050",
    "algorithm is",
  ];

  const blob = claims
    .map((c) => `${c.text} :: ${c.sentence} :: ${c.entities.join(",")}`)
    .join("\n");

  console.log("--- coverage check ---");
  for (const needle of expectExtracted) {
    console.log(`  ${blob.includes(needle) ? "✓" : "MISS"}  expect: ${needle}`);
  }
  console.log("--- rejection check ---");
  for (const needle of expectRejected) {
    console.log(`  ${!blob.includes(needle) ? "✓" : "LEAK"}  reject: ${needle}`);
  }
}

main().catch((err) => {
  console.error("[smoke-extract] FAILED:", err);
  process.exit(1);
});
