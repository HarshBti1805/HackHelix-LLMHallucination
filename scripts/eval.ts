#!/usr/bin/env -S npx tsx
/**
 * Phase B eval harness — three-provider hallucination comparison.
 *
 * For each prompt in `eval/prompts.json`, this script:
 *   1. Sends the prompt to all three chat providers SEQUENTIALLY
 *      (openai gpt-4o → gemini-2.5-flash → anthropic claude-haiku-4-5).
 *      Sequential to keep upstream concurrency low and avoid the 429s that
 *      a 3 × 15 fan-out would trigger on free / efficient-tier accounts.
 *   2. Runs each response through `auditDocument(text, …, { maxClaims: 25 })`
 *      — treats the response as a one-off document so the existing extract
 *      → 3-subagent → aggregate pipeline applies unchanged. The auditor is
 *      LOCKED to OpenAI gpt-4o-mini per CLAUDE.md core rule 2; Gemini and
 *      Anthropic never appear on the auditor side, only on the chat side.
 *   3. Records the per-cell `AuditSummary` plus the raw chat response.
 *
 * Output:
 *   - eval/results.json  full records (every prompt × every provider, with
 *                        chat response text and full DocumentAudit envelope)
 *   - eval/results.md    summary table + per-category breakdown + per-prompt
 *                        verdict spread; ready to paste into README.md
 *                        (IMPROVEMENTS.md task B.10).
 *
 * Usage:
 *   npx tsx scripts/eval.ts                  # full 15-prompt run
 *   npx tsx scripts/eval.ts --prompt cite-01 # single-prompt dry run (B.8)
 *   npx tsx scripts/eval.ts --prompt cite-01,fact-01
 *
 * Headline metric in the summary table:
 *   hallucination_rate = (contradicted + likely_hallucination) / total_claims
 * (per IMPROVEMENTS.md "Hallucination rate metric" section).
 *
 * Failure mode policy: a single provider erroring out (rate limit, 5xx,
 * malformed JSON from the auditor) MUST NOT crash the run — too expensive
 * to lose 14 prompts of work because one cell failed. Errors are caught,
 * recorded into the cell as { error: "..." }, and surfaced in the summary.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { openaiChat } from "@/lib/providers/openai";
import { geminiChat } from "@/lib/providers/gemini";
import { anthropicChat } from "@/lib/providers/anthropic";
import { auditDocument } from "@/lib/document-audit";
import type { DocumentAudit, Provider, ChatModel, Verdict } from "@/types";

// ─────────────────────────────────────────────────────────────────────────────
// Env loading
//
// `npx tsx` does NOT auto-load .env files the way `next dev` does. The
// chat providers + auditor all read process.env.*_API_KEY, so we manually
// load .env.local first (preferred) and then .env as fallback. Both files
// are gitignored (.env*) per .gitignore line 34. No dotenv dependency
// because the format we use is trivial: KEY=value lines, # comments, blanks.
// ─────────────────────────────────────────────────────────────────────────────
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  // Synchronous read at startup — keeps the "load env, then run" sequence
  // obvious. Async would interleave with the .env precedence logic below.
  const raw = require("node:fs").readFileSync(path, "utf8") as string;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // Strip optional surrounding quotes (single or double).
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    // First-set-wins: .env.local loaded first, .env doesn't override.
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = val;
    }
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..");

loadEnvFile(join(REPO_ROOT, ".env.local"));
loadEnvFile(join(REPO_ROOT, ".env"));

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface PromptRecord {
  id: string;
  category: string;
  prompt: string;
  notes?: string;
}

interface ProviderConfig {
  provider: Provider;
  model: ChatModel;
  label: string; // human-readable, used in tables + console output
  call: (prompt: string) => Promise<string>;
}

interface Cell {
  prompt_id: string;
  category: string;
  provider: Provider;
  model: ChatModel;
  response: string | null;
  audit: DocumentAudit | null;
  error: string | null;
  wall_clock_ms: number;
}

interface FullResults {
  generated_at: string;
  prompts: PromptRecord[];
  cells: Cell[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider configs
//
// Models match exactly what's wired into the chat UI (PROVIDER_MODELS in
// app/page.tsx). One efficient-tier model per provider — see types.ts and
// IMPROVEMENTS.md Phase 0 + Phase B prep for the rationale.
// ─────────────────────────────────────────────────────────────────────────────
const PROVIDERS: ProviderConfig[] = [
  {
    provider: "openai",
    model: "gpt-4o",
    label: "OpenAI gpt-4o",
    call: (prompt) => openaiChat([{ role: "user", content: prompt }], "gpt-4o"),
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    call: (prompt) =>
      geminiChat([{ role: "user", content: prompt }], "gemini-2.5-flash"),
  },
  {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    label: "Anthropic Haiku 4.5",
    call: (prompt) =>
      anthropicChat([{ role: "user", content: prompt }], "claude-haiku-4-5"),
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Run-loop
// ─────────────────────────────────────────────────────────────────────────────
async function runCell(
  prompt: PromptRecord,
  cfg: ProviderConfig,
): Promise<Cell> {
  const start = Date.now();
  const cell: Cell = {
    prompt_id: prompt.id,
    category: prompt.category,
    provider: cfg.provider,
    model: cfg.model,
    response: null,
    audit: null,
    error: null,
    wall_clock_ms: 0,
  };

  try {
    const response = await cfg.call(prompt.prompt);
    cell.response = response;

    const filename = `eval-${prompt.id}-${cfg.provider}.txt`;
    const audit = await auditDocument(response, filename);
    cell.audit = audit;
  } catch (err) {
    cell.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }

  cell.wall_clock_ms = Date.now() - start;
  return cell;
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregator: builds the markdown report from collected cells.
// ─────────────────────────────────────────────────────────────────────────────
const VERDICT_KEYS: Verdict[] = [
  "verified",
  "unverified_plausible",
  "contradicted",
  "likely_hallucination",
];

interface ProviderRollup {
  provider: Provider;
  model: ChatModel;
  label: string;
  prompts_run: number;
  prompts_errored: number;
  total_claims: number;
  verified: number;
  unverified_plausible: number;
  contradicted: number;
  likely_hallucination: number;
}

function rollupByProvider(cells: Cell[]): ProviderRollup[] {
  return PROVIDERS.map((cfg) => {
    const ours = cells.filter((c) => c.provider === cfg.provider);
    const errored = ours.filter((c) => c.error !== null);
    const summed = ours.reduce(
      (acc, c) => {
        if (!c.audit) return acc;
        const s = c.audit.summary;
        acc.total_claims += s.total_claims;
        acc.verified += s.verified;
        acc.unverified_plausible += s.unverified_plausible;
        acc.contradicted += s.contradicted;
        acc.likely_hallucination += s.likely_hallucination;
        return acc;
      },
      {
        total_claims: 0,
        verified: 0,
        unverified_plausible: 0,
        contradicted: 0,
        likely_hallucination: 0,
      },
    );
    return {
      provider: cfg.provider,
      model: cfg.model,
      label: cfg.label,
      prompts_run: ours.length,
      prompts_errored: errored.length,
      ...summed,
    };
  });
}

function pctOrDash(num: number, denom: number): string {
  if (denom === 0) return "—";
  return `${((num / denom) * 100).toFixed(1)}%`;
}

function buildMarkdownReport(results: FullResults): string {
  const lines: string[] = [];
  const rollup = rollupByProvider(results.cells);

  lines.push("# Three-provider hallucination comparison");
  lines.push("");
  lines.push(
    `Generated ${results.generated_at}. Auditor: locked to OpenAI \`gpt-4o-mini\` ` +
      `(extractor + 3 verifier subagents) per CLAUDE.md core rule 2.`,
  );
  lines.push("");
  lines.push(
    `Prompts: ${results.prompts.length} (` +
      summarizeCategoryCounts(results.prompts) +
      ")",
  );
  lines.push("");

  // Headline summary table
  lines.push("## Summary");
  lines.push("");
  lines.push(
    "| Provider | Prompts | Errors | Total claims | Verified | Unverified | Contradicted | Hallucinated | Hallucination rate |",
  );
  lines.push(
    "|---|---|---|---|---|---|---|---|---|",
  );
  for (const r of rollup) {
    const halluc = r.contradicted + r.likely_hallucination;
    lines.push(
      `| ${r.label} | ${r.prompts_run} | ${r.prompts_errored} | ${r.total_claims} | ${r.verified} | ${r.unverified_plausible} | ${r.contradicted} | ${r.likely_hallucination} | ${pctOrDash(halluc, r.total_claims)} |`,
    );
  }
  lines.push("");
  lines.push(
    "Hallucination rate = `(contradicted + likely_hallucination) / total_claims`. " +
      "A higher rate means the auditor caught more atomic claims it judged false " +
      "or unsupportable.",
  );
  lines.push("");

  // Per-category breakdown
  lines.push("## Per-category breakdown");
  lines.push("");
  const categories = Array.from(
    new Set(results.prompts.map((p) => p.category)),
  );
  for (const cat of categories) {
    lines.push(`### ${cat}`);
    lines.push("");
    lines.push(
      "| Provider | Prompts | Total claims | Verified | Unverified | Contradicted | Hallucinated | Halluc. rate |",
    );
    lines.push("|---|---|---|---|---|---|---|---|");
    for (const cfg of PROVIDERS) {
      const cells = results.cells.filter(
        (c) => c.category === cat && c.provider === cfg.provider,
      );
      const r = cells.reduce(
        (acc, c) => {
          if (!c.audit) return acc;
          const s = c.audit.summary;
          acc.total_claims += s.total_claims;
          acc.verified += s.verified;
          acc.unverified_plausible += s.unverified_plausible;
          acc.contradicted += s.contradicted;
          acc.likely_hallucination += s.likely_hallucination;
          return acc;
        },
        {
          total_claims: 0,
          verified: 0,
          unverified_plausible: 0,
          contradicted: 0,
          likely_hallucination: 0,
        },
      );
      const halluc = r.contradicted + r.likely_hallucination;
      lines.push(
        `| ${cfg.label} | ${cells.length} | ${r.total_claims} | ${r.verified} | ${r.unverified_plausible} | ${r.contradicted} | ${r.likely_hallucination} | ${pctOrDash(halluc, r.total_claims)} |`,
      );
    }
    lines.push("");
  }

  // Per-prompt detail
  lines.push("## Per-prompt detail");
  lines.push("");
  for (const p of results.prompts) {
    lines.push(`### ${p.id} — *${p.category}*`);
    lines.push("");
    lines.push(`> ${p.prompt}`);
    lines.push("");
    if (p.notes) {
      lines.push(`*Ground truth / notes:* ${p.notes}`);
      lines.push("");
    }
    lines.push(
      "| Provider | Claims | V | UP | C | H | Wall-clock |",
    );
    lines.push("|---|---|---|---|---|---|---|");
    for (const cfg of PROVIDERS) {
      const cell = results.cells.find(
        (c) => c.prompt_id === p.id && c.provider === cfg.provider,
      );
      if (!cell) {
        lines.push(`| ${cfg.label} | — | — | — | — | — | — |`);
        continue;
      }
      if (cell.error) {
        lines.push(
          `| ${cfg.label} | ERROR | — | — | — | — | ${(cell.wall_clock_ms / 1000).toFixed(1)}s |`,
        );
        continue;
      }
      const s = cell.audit!.summary;
      lines.push(
        `| ${cfg.label} | ${s.total_claims} | ${s.verified} | ${s.unverified_plausible} | ${s.contradicted} | ${s.likely_hallucination} | ${(cell.wall_clock_ms / 1000).toFixed(1)}s |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

function summarizeCategoryCounts(prompts: PromptRecord[]): string {
  const counts = new Map<string, number>();
  for (const p of prompts) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([cat, n]) => `${n} ${cat}`)
    .join(", ");
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────
function parseFilter(argv: string[]): Set<string> | null {
  const idx = argv.indexOf("--prompt");
  if (idx === -1 || idx + 1 >= argv.length) return null;
  return new Set(argv[idx + 1].split(",").map((s) => s.trim()).filter(Boolean));
}

async function main() {
  const promptsPath = join(REPO_ROOT, "eval/prompts.json");
  const raw = await readFile(promptsPath, "utf8");
  const allPrompts = JSON.parse(raw) as PromptRecord[];

  const filter = parseFilter(process.argv.slice(2));
  const prompts = filter
    ? allPrompts.filter((p) => filter.has(p.id))
    : allPrompts;

  if (prompts.length === 0) {
    console.error(
      `No prompts matched filter ${JSON.stringify(filter ? Array.from(filter) : null)}. ` +
        `Available IDs: ${allPrompts.map((p) => p.id).join(", ")}`,
    );
    process.exit(1);
  }

  const isDryRun = filter !== null && prompts.length < allPrompts.length;
  console.log(
    `[eval] ${isDryRun ? "DRY RUN" : "FULL RUN"}: ${prompts.length} prompt(s) × ` +
      `${PROVIDERS.length} provider(s) = ${prompts.length * PROVIDERS.length} cells`,
  );
  console.log(
    `[eval] providers: ${PROVIDERS.map((p) => p.label).join(", ")}`,
  );
  console.log("[eval] auditor: OpenAI gpt-4o-mini (locked) — extractor + 3 subagents per claim");
  console.log("");

  const cells: Cell[] = [];
  const overallStart = Date.now();

  for (let pi = 0; pi < prompts.length; pi++) {
    const prompt = prompts[pi];
    console.log(
      `[eval] (${pi + 1}/${prompts.length}) ${prompt.id} [${prompt.category}]`,
    );

    for (const cfg of PROVIDERS) {
      const cellStart = Date.now();
      process.stdout.write(`  → ${cfg.label.padEnd(22)} `);
      const cell = await runCell(prompt, cfg);
      cells.push(cell);
      const ms = Date.now() - cellStart;
      if (cell.error) {
        process.stdout.write(`ERROR (${(ms / 1000).toFixed(1)}s): ${cell.error}\n`);
      } else {
        const s = cell.audit!.summary;
        const halluc = s.contradicted + s.likely_hallucination;
        process.stdout.write(
          `${s.total_claims} claims (V${s.verified} UP${s.unverified_plausible} C${s.contradicted} H${s.likely_hallucination}) ` +
            `→ ${pctOrDash(halluc, s.total_claims)} halluc rate (${(ms / 1000).toFixed(1)}s)\n`,
        );
      }
    }
    console.log("");
  }

  const overallMs = Date.now() - overallStart;
  console.log(
    `[eval] all cells complete in ${(overallMs / 1000).toFixed(1)}s`,
  );

  const results: FullResults = {
    generated_at: new Date().toISOString(),
    prompts,
    cells,
  };

  const outDir = join(REPO_ROOT, "eval");
  if (!existsSync(outDir)) await mkdir(outDir, { recursive: true });

  // For dry runs, write to suffixed files so they don't clobber a real run.
  const suffix = isDryRun ? `.dryrun-${Array.from(filter!).join("_")}` : "";
  const jsonOut = join(outDir, `results${suffix}.json`);
  const mdOut = join(outDir, `results${suffix}.md`);

  await writeFile(jsonOut, JSON.stringify(results, null, 2), "utf8");
  await writeFile(mdOut, buildMarkdownReport(results), "utf8");

  console.log("");
  console.log(`[eval] wrote ${jsonOut}`);
  console.log(`[eval] wrote ${mdOut}`);
}

main().catch((err) => {
  console.error("[eval] fatal:", err);
  process.exit(1);
});
