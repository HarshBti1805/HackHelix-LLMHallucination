import resultsRaw from "@/eval/results.json";
import promptsRaw from "@/eval/prompts.json";
import type { AuditSummary, Provider } from "@/types";

/**
 * Server-only derivation of the slim view of `eval/results.json` that the
 * `/benchmark` page renders. The raw artifact is ~1.5 MB and carries
 * full per-claim agent reasoning, source URLs, and response text we don't
 * need on the table or stat-card surface — pulling it through a server
 * component keeps the heavy JSON out of the client bundle.
 *
 * Imports are static so Next bundles `eval/results.json` and
 * `eval/prompts.json` at build time, matching the spec requirement
 * "Import the JSON at build time; do NOT fetch at runtime."
 */

export interface PromptRow {
  id: string;
  category: string;
  prompt: string;
  notes?: string;
}

export interface CellSummary {
  prompt_id: string;
  category: string;
  provider: Provider;
  has_data: boolean;
  summary: AuditSummary | null;
  hallucination_rate: number | null;
  wall_clock_ms: number;
}

export interface CategoryProviderRow {
  category: string;
  provider: Provider;
  prompts_total: number;
  prompts_completed: number;
  totals: AuditSummary;
  hallucination_rate: number | null;
  cells: CellSummary[];
}

export interface ProviderHeadline {
  provider: Provider;
  prompts_total: number;
  prompts_completed: number;
  totals: AuditSummary;
  hallucination_rate: number | null;
}

export interface BenchmarkView {
  generated_at: string;
  prompts: PromptRow[];
  /** Stable, deterministic order: ascending category list × providers. */
  category_provider_rows: CategoryProviderRow[];
  /** OpenAI / Anthropic / Gemini, in that order. */
  provider_headlines: ProviderHeadline[];
  category_order: string[];
}

interface RawCell {
  prompt_id: string;
  category: string;
  provider: Provider;
  model: string;
  response: string | null;
  audit: { summary?: AuditSummary } | null;
  error: string | null;
  wall_clock_ms: number;
}

interface RawResults {
  generated_at: string;
  prompts: PromptRow[];
  cells: RawCell[];
}

const PROVIDER_ORDER: Provider[] = ["openai", "anthropic", "gemini"];

/**
 * Sentinel category order matches `eval/results.md` / README, so the
 * table reads top-to-bottom in the same order the README references it.
 */
const CATEGORY_ORDER: string[] = [
  "fabricated-citation",
  "specific-fact",
  "contested-claim",
  "compound-claim",
  "open-research",
];

function emptySummary(): AuditSummary {
  return {
    total_claims: 0,
    verified: 0,
    unverified_plausible: 0,
    contradicted: 0,
    likely_hallucination: 0,
  };
}

function rateOf(s: AuditSummary): number | null {
  if (s.total_claims <= 0) return null;
  return (s.contradicted + s.likely_hallucination) / s.total_claims;
}

function buildView(): BenchmarkView {
  const raw = resultsRaw as RawResults;
  const prompts = promptsRaw as PromptRow[];

  // 1) Per-cell summary (no claims, no responses).
  const cells: CellSummary[] = raw.cells.map((c) => {
    const has_data = c.audit !== null && c.audit.summary !== undefined;
    const summary = has_data ? (c.audit!.summary as AuditSummary) : null;
    return {
      prompt_id: c.prompt_id,
      category: c.category,
      provider: c.provider,
      has_data,
      summary,
      hallucination_rate: summary ? rateOf(summary) : null,
      wall_clock_ms: c.wall_clock_ms,
    };
  });

  // 2) Per-(category, provider) aggregation.
  const category_provider_rows: CategoryProviderRow[] = [];
  for (const category of CATEGORY_ORDER) {
    for (const provider of PROVIDER_ORDER) {
      const inGroup = cells.filter(
        (c) => c.category === category && c.provider === provider,
      );
      const totals = emptySummary();
      let prompts_completed = 0;
      for (const c of inGroup) {
        if (!c.summary) continue;
        prompts_completed += 1;
        totals.total_claims += c.summary.total_claims;
        totals.verified += c.summary.verified;
        totals.unverified_plausible += c.summary.unverified_plausible;
        totals.contradicted += c.summary.contradicted;
        totals.likely_hallucination += c.summary.likely_hallucination;
      }
      category_provider_rows.push({
        category,
        provider,
        prompts_total: inGroup.length,
        prompts_completed,
        totals,
        hallucination_rate: rateOf(totals),
        cells: inGroup,
      });
    }
  }

  // 3) Provider headlines (across all categories).
  const provider_headlines: ProviderHeadline[] = PROVIDER_ORDER.map(
    (provider) => {
      const inProvider = cells.filter((c) => c.provider === provider);
      const totals = emptySummary();
      let prompts_completed = 0;
      for (const c of inProvider) {
        if (!c.summary) continue;
        prompts_completed += 1;
        totals.total_claims += c.summary.total_claims;
        totals.verified += c.summary.verified;
        totals.unverified_plausible += c.summary.unverified_plausible;
        totals.contradicted += c.summary.contradicted;
        totals.likely_hallucination += c.summary.likely_hallucination;
      }
      return {
        provider,
        prompts_total: inProvider.length,
        prompts_completed,
        totals,
        hallucination_rate: rateOf(totals),
      };
    },
  );

  return {
    generated_at: raw.generated_at,
    prompts,
    category_provider_rows,
    provider_headlines,
    category_order: CATEGORY_ORDER,
  };
}

let cached: BenchmarkView | null = null;

export function getBenchmarkView(): BenchmarkView {
  if (!cached) cached = buildView();
  return cached;
}
