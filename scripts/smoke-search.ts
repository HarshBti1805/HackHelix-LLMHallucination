/**
 * Smoke test for lib/search.ts (PROJECT_PLAN.md task 1.2).
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/smoke-search.ts
 */

import { search } from "../lib/search";

async function main() {
  const query = process.argv[2] ?? "Eiffel Tower height";
  console.log(`[smoke-search] query: ${JSON.stringify(query)}`);

  const results = await search(query, { maxResults: 5 });
  console.log(`[smoke-search] got ${results.length} results\n`);

  for (const [i, r] of results.entries()) {
    console.log(`#${i + 1}  [${r.domain}]`);
    console.log(`  title:   ${r.title}`);
    console.log(`  url:     ${r.url}`);
    console.log(`  snippet: ${r.snippet.slice(0, 200).replace(/\s+/g, " ")}`);
    console.log();
  }
}

main().catch((err) => {
  console.error("[smoke-search] FAILED:", err);
  process.exit(1);
});
