"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type {
  AuditRequestBody,
  AuditSummary,
  ChatMessage,
  ChatModel,
  ChatRequestBody,
  ChatResponseBody,
  MessageAudit,
  Provider,
  Verdict,
} from "@/types";
import { SummaryBar } from "@/components/audit/SummaryBar";
import {
  VERDICT_STYLES,
  formatConfidence,
} from "@/components/audit/verdict";
import type {
  BenchmarkView,
  CategoryProviderRow,
  CellSummary,
  PromptRow,
} from "./data";

/**
 * /benchmark page client.
 *
 * Three sections, top to bottom:
 *   1. Findings summary — copied verbatim from the README "Empirical
 *      model comparison" section so the two surfaces stay in sync.
 *   2. Interactive results table built from the slim `BenchmarkView`
 *      derivation (not the raw 1.5 MB JSON, which stays server-side).
 *   3. Live two-prompt comparison through GPT-4o + Claude Haiku 4.5
 *      via the existing `/api/chat` and `/api/audit` routes — no new
 *      API endpoints, no Gemini in this section by spec.
 *
 * State is intentionally ephemeral: live comparison results live in
 * useState only and are discarded on navigation away. The "this is a
 * live run" framing is part of the demo story and worth preserving.
 */

// ─── Provider visual tokens ──────────────────────────────────────────
//
// PROVIDER_DOT was referenced in the spec as living in `app/page.tsx`
// but was never actually defined there — defined here for the first
// time so the benchmark stat cards and table rows render a small
// colored dot per provider. Tints chosen to be distinct against both
// light and dark backgrounds without colliding with the verdict
// palette (emerald / amber / orange / rose).
type LiveProvider = Extract<Provider, "openai" | "anthropic">;

interface ProviderViz {
  label: string;
  short: string;
  dot: string;
  /** Chat-route routing target. */
  model: ChatModel;
}

const PROVIDER_VIZ: Record<Provider, ProviderViz> = {
  openai: {
    label: "OpenAI gpt-4o",
    short: "OpenAI",
    dot: "bg-emerald-500",
    model: "gpt-4o",
  },
  anthropic: {
    label: "Anthropic Haiku 4.5",
    short: "Anthropic",
    dot: "bg-violet-500",
    model: "claude-haiku-4-5",
  },
  gemini: {
    label: "Gemini 2.5 Flash",
    short: "Gemini",
    dot: "bg-sky-500",
    model: "gemini-2.5-flash",
  },
};

export function PROVIDER_DOT({ provider }: { provider: Provider }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2 w-2 rounded-full ${PROVIDER_VIZ[provider].dot}`}
    />
  );
}

const LIVE_PROVIDERS: LiveProvider[] = ["openai", "anthropic"];

// Human-readable category labels (eval ids stay kebab-cased).
const CATEGORY_LABEL: Record<string, string> = {
  "fabricated-citation": "Fabricated citation",
  "specific-fact": "Specific fact",
  "contested-claim": "Contested claim",
  "compound-claim": "Compound claim",
  "open-research": "Open research",
};

function categoryLabel(c: string): string {
  return CATEGORY_LABEL[c] ?? c;
}

function formatRate(r: number | null): string {
  if (r === null) return "—";
  return `${(r * 100).toFixed(1)}%`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

// ─── Section 1: Findings summary ─────────────────────────────────────
function FindingsSummary() {
  return (
    <section
      aria-labelledby="findings-summary"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        <span className="font-[family-name:var(--font-dm-mono)] text-[11px] uppercase tracking-[0.32em] text-[var(--accent)]">
          01 — Findings summary
        </span>
        <h2
          id="findings-summary"
          className="font-serif text-[34px] leading-[1.05] tracking-tight text-[var(--foreground)] sm:text-[40px]"
        >
          What was <span className="italic">measured</span>.
        </h2>
      </div>

      <div className="flex flex-col gap-3 text-[15.5px] leading-relaxed text-[var(--foreground)]/90 sm:max-w-3xl">
        <p>
          Three efficient-tier chat models — OpenAI{" "}
          <span className="font-[family-name:var(--font-dm-mono)] text-[14px]">
            gpt-4o
          </span>
          , Anthropic{" "}
          <span className="font-[family-name:var(--font-dm-mono)] text-[14px]">
            claude-haiku-4-5
          </span>
          , Google{" "}
          <span className="font-[family-name:var(--font-dm-mono)] text-[14px]">
            gemini-2.5-flash
          </span>{" "}
          — were each prompted with the same 15 prompts spread across five
          categories (
          <span className="font-[family-name:var(--font-dm-mono)] text-[13.5px]">
            fabricated-citation, specific-fact, contested-claim,
            compound-claim, open-research
          </span>
          ; 3 prompts each).
        </p>

        <p>
          Every response was audited by the fixed OpenAI auditor pipeline
          (extractor + 3 verifier subagents on{" "}
          <span className="font-[family-name:var(--font-dm-mono)] text-[14px]">
            gpt-4o-mini
          </span>
          ). The hallucination rate reports{" "}
          <span className="italic">
            (contradicted + likely_hallucination) / total_claims
          </span>{" "}
          per provider per category.
        </p>

        <p>
          <span className="font-semibold">Coverage disclosure.</span> Gemini
          exhausted its free-tier daily quota (20 requests/day on{" "}
          <span className="font-[family-name:var(--font-dm-mono)] text-[14px]">
            gemini-2.5-flash
          </span>
          ) mid-run. 7 of 15 Gemini cells failed — specifically all 3{" "}
          <span className="font-[family-name:var(--font-dm-mono)] text-[13.5px]">
            compound-claim
          </span>{" "}
          cells, all 3{" "}
          <span className="font-[family-name:var(--font-dm-mono)] text-[13.5px]">
            open-research
          </span>{" "}
          cells, and the third{" "}
          <span className="font-[family-name:var(--font-dm-mono)] text-[13.5px]">
            contested-claim
          </span>{" "}
          cell. Gemini results below cover only the 8 cells that completed
          before the quota wall; full-coverage cross-provider comparison is
          between OpenAI and Anthropic.
        </p>

        <p className="text-[14px] text-[var(--foreground-muted)]">
          Methodology: the eval compares{" "}
          <span className="font-[family-name:var(--font-dm-mono)] text-[13px]">
            gpt-4o
          </span>{" "}
          vs{" "}
          <span className="font-[family-name:var(--font-dm-mono)] text-[13px]">
            claude-haiku-4-5
          </span>{" "}
          vs{" "}
          <span className="font-[family-name:var(--font-dm-mono)] text-[13px]">
            gemini-2.5-flash
          </span>{" "}
          — a consistent efficient-tier comparison chosen for rate-limit
          reliability and per-token cost. Results are suggestive, not a
          ranking of flagship models.
        </p>
      </div>
    </section>
  );
}

// ─── Section 2: Stat cards + sortable table ──────────────────────────

function ProviderStatCard({
  provider,
  totals,
  rate,
  cellsCompleted,
  cellsTotal,
}: {
  provider: Provider;
  totals: AuditSummary;
  rate: number | null;
  cellsCompleted: number;
  cellsTotal: number;
}) {
  const isPartial = cellsCompleted < cellsTotal;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center gap-2">
        <PROVIDER_DOT provider={provider} />
        <span className="font-[family-name:var(--font-instrument)] text-[12px] uppercase tracking-[0.16em] text-[var(--foreground-muted)]">
          {PROVIDER_VIZ[provider].label}
        </span>
      </div>
      <div className="flex items-end gap-2">
        <span className="font-serif text-[44px] leading-none tracking-tight text-[var(--foreground)]">
          {formatRate(rate)}
        </span>
        <span className="pb-1 text-[12px] text-[var(--foreground-muted)]">
          aggregate hallucination rate
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--foreground-muted)]">
        <span>
          <span className="font-[family-name:var(--font-dm-mono)]">
            {cellsCompleted}/{cellsTotal}
          </span>{" "}
          cells
        </span>
        <span aria-hidden="true" className="opacity-50">
          ·
        </span>
        <span>
          <span className="font-[family-name:var(--font-dm-mono)]">
            {totals.total_claims}
          </span>{" "}
          claims
        </span>
      </div>
      <SummaryBar summary={totals} />
      {isPartial && (
        <p className="rounded-md border border-amber-500/40 bg-amber-50/60 px-2 py-1.5 text-[11.5px] text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          Partial coverage — {cellsTotal - cellsCompleted} cell
          {cellsTotal - cellsCompleted === 1 ? "" : "s"} unavailable
          (provider quota exhausted).
        </p>
      )}
    </div>
  );
}

type SortKey =
  | "category"
  | "provider"
  | "total_claims"
  | "verified"
  | "unverified_plausible"
  | "contradicted"
  | "likely_hallucination"
  | "rate";

interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "category", label: "Category" },
  { key: "provider", label: "Provider" },
  { key: "total_claims", label: "Total claims", align: "right" },
  { key: "verified", label: "Verified", align: "right" },
  { key: "unverified_plausible", label: "Unverified", align: "right" },
  { key: "contradicted", label: "Contradicted", align: "right" },
  { key: "likely_hallucination", label: "Hallucinated", align: "right" },
  { key: "rate", label: "Rate", align: "right" },
];

const VERDICT_BY_COLUMN: Partial<Record<SortKey, Verdict>> = {
  verified: "verified",
  unverified_plausible: "unverified_plausible",
  contradicted: "contradicted",
  likely_hallucination: "likely_hallucination",
};

function rowSortValue(row: CategoryProviderRow, key: SortKey): string | number {
  switch (key) {
    case "category":
      return row.category;
    case "provider":
      return row.provider;
    case "total_claims":
      return row.totals.total_claims;
    case "verified":
      return row.totals.verified;
    case "unverified_plausible":
      return row.totals.unverified_plausible;
    case "contradicted":
      return row.totals.contradicted;
    case "likely_hallucination":
      return row.totals.likely_hallucination;
    case "rate":
      // null sorts to the bottom regardless of direction so missing
      // Gemini cells don't pollute the ranking.
      return row.hallucination_rate ?? Number.POSITIVE_INFINITY;
  }
}

function ResultsTable({
  rows,
  prompts,
}: {
  rows: CategoryProviderRow[];
  prompts: PromptRow[];
}) {
  const [sort, setSort] = useState<SortState>({ key: "category", dir: "asc" });
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const reduceMotion = useReducedMotion();

  const promptsById = useMemo(() => {
    const m = new Map<string, PromptRow>();
    for (const p of prompts) m.set(p.id, p);
    return m;
  }, [prompts]);

  const sortedRows = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const va = rowSortValue(a, sort.key);
      const vb = rowSortValue(b, sort.key);
      let cmp: number;
      if (typeof va === "number" && typeof vb === "number") {
        cmp = va - vb;
      } else {
        cmp = String(va).localeCompare(String(vb));
      }
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, sort]);

  function onSort(key: SortKey) {
    setSort((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      // Default direction by column type — strings ascending, numbers
      // descending, so a first click on "Rate" puts the worst at the top.
      const dir: "asc" | "desc" =
        key === "category" || key === "provider" ? "asc" : "desc";
      return { key, dir };
    });
  }

  function toggleRow(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
      <table className="w-full min-w-[800px] border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr className="text-left">
            {COLUMNS.map((col) => {
              const active = sort.key === col.key;
              return (
                <th
                  key={col.key}
                  scope="col"
                  className={`sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 ${
                    col.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSort(col.key)}
                    className={`inline-flex items-center gap-1 font-[family-name:var(--font-instrument)] text-[11px] uppercase tracking-[0.14em] ${
                      active
                        ? "text-[var(--foreground)]"
                        : "text-[var(--foreground-muted)]"
                    } hover:text-[var(--foreground)]`}
                    aria-sort={
                      active
                        ? sort.dir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <span>{col.label}</span>
                    <span aria-hidden="true" className="text-[10px]">
                      {active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => {
            const id = `${row.category}::${row.provider}`;
            const isOpen = expanded.has(id);
            const hasData = row.totals.total_claims > 0;
            const partial = row.prompts_completed < row.prompts_total;
            return (
              <RowAndDrawer
                key={id}
                id={id}
                row={row}
                isOpen={isOpen}
                hasData={hasData}
                partial={partial}
                promptsById={promptsById}
                onToggle={() => toggleRow(id)}
                reduceMotion={Boolean(reduceMotion)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RowAndDrawer({
  id,
  row,
  isOpen,
  hasData,
  partial,
  promptsById,
  onToggle,
  reduceMotion,
}: {
  id: string;
  row: CategoryProviderRow;
  isOpen: boolean;
  hasData: boolean;
  partial: boolean;
  promptsById: Map<string, PromptRow>;
  onToggle: () => void;
  reduceMotion: boolean;
}) {
  const noteForPartial =
    row.provider === "gemini" && partial
      ? "Provider quota exhausted; see coverage note above."
      : undefined;

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-[var(--surface-muted)]/60"
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <td className="border-b border-[var(--border)] px-3 py-2 align-middle">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`inline-block text-[10px] text-[var(--foreground-muted)] transition-transform ${
                isOpen ? "rotate-90" : ""
              }`}
            >
              ▶
            </span>
            <span className="font-medium text-[var(--foreground)]">
              {categoryLabel(row.category)}
            </span>
          </div>
        </td>
        <td className="border-b border-[var(--border)] px-3 py-2 align-middle">
          <span className="inline-flex items-center gap-2">
            <PROVIDER_DOT provider={row.provider} />
            <span className="text-[var(--foreground)]">
              {PROVIDER_VIZ[row.provider].short}
            </span>
          </span>
        </td>
        <NumCell value={row.totals.total_claims} hasData={hasData} note={noteForPartial} />
        <VerdictCell value={row.totals.verified} hasData={hasData} verdict="verified" />
        <VerdictCell
          value={row.totals.unverified_plausible}
          hasData={hasData}
          verdict="unverified_plausible"
        />
        <VerdictCell
          value={row.totals.contradicted}
          hasData={hasData}
          verdict="contradicted"
        />
        <VerdictCell
          value={row.totals.likely_hallucination}
          hasData={hasData}
          verdict="likely_hallucination"
        />
        <td className="border-b border-[var(--border)] px-3 py-2 text-right align-middle">
          <span className="font-[family-name:var(--font-dm-mono)] text-[13px] text-[var(--foreground)]">
            {formatRate(row.hallucination_rate)}
          </span>
        </td>
      </tr>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.tr
            key={`${id}-detail`}
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <td colSpan={COLUMNS.length} className="border-b border-[var(--border)] bg-[var(--surface-muted)]/40 px-3 py-3">
              <PromptDrillDown row={row} promptsById={promptsById} />
            </td>
          </motion.tr>
        )}
      </AnimatePresence>
    </>
  );
}

function NumCell({
  value,
  hasData,
  note,
}: {
  value: number;
  hasData: boolean;
  note?: string;
}) {
  return (
    <td
      className="border-b border-[var(--border)] px-3 py-2 text-right align-middle"
      title={note}
    >
      <span className="font-[family-name:var(--font-dm-mono)] text-[13px] text-[var(--foreground)]">
        {hasData ? value : "—"}
      </span>
    </td>
  );
}

function VerdictCell({
  value,
  hasData,
  verdict,
}: {
  value: number;
  hasData: boolean;
  verdict: Verdict;
}) {
  if (!hasData) {
    return <NumCell value={0} hasData={false} />;
  }
  const style = VERDICT_STYLES[verdict];
  return (
    <td className="border-b border-[var(--border)] px-3 py-2 text-right align-middle">
      {value === 0 ? (
        <span className="font-[family-name:var(--font-dm-mono)] text-[13px] text-[var(--foreground-muted)] opacity-60">
          0
        </span>
      ) : (
        <span
          className={`inline-flex min-w-[1.75rem] justify-center rounded-full px-1.5 py-0.5 text-[11.5px] font-semibold ${style.pill}`}
        >
          {value}
        </span>
      )}
    </td>
  );
}

function PromptDrillDown({
  row,
  promptsById,
}: {
  row: CategoryProviderRow;
  promptsById: Map<string, PromptRow>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-[family-name:var(--font-instrument)] text-[10.5px] uppercase tracking-[0.16em] text-[var(--foreground-muted)]">
        Prompts in this category
      </span>
      <ul className="flex flex-col gap-1.5">
        {row.cells.map((cell) => {
          const prompt = promptsById.get(cell.prompt_id);
          return (
            <PromptDetailLine
              key={`${cell.prompt_id}::${cell.provider}`}
              cell={cell}
              promptText={prompt?.prompt ?? "(unknown prompt)"}
            />
          );
        })}
      </ul>
    </div>
  );
}

function PromptDetailLine({
  cell,
  promptText,
}: {
  cell: CellSummary;
  promptText: string;
}) {
  return (
    <li className="flex flex-col gap-0.5 rounded-md border border-[var(--border)]/60 bg-[var(--surface)] px-3 py-2 sm:flex-row sm:items-center sm:gap-3">
      <span className="font-[family-name:var(--font-dm-mono)] text-[11.5px] uppercase tracking-wide text-[var(--foreground-muted)] sm:w-[5.5rem] sm:shrink-0">
        {cell.prompt_id}
      </span>
      <span className="flex-1 text-[12.5px] leading-snug text-[var(--foreground)]">
        {truncate(promptText, 140)}
      </span>
      <span className="flex items-center gap-2 sm:ml-auto sm:shrink-0">
        {cell.has_data ? (
          <>
            <span className="font-[family-name:var(--font-dm-mono)] text-[11.5px] text-[var(--foreground-muted)]">
              {cell.summary?.total_claims ?? 0} claim
              {(cell.summary?.total_claims ?? 0) === 1 ? "" : "s"}
            </span>
            <span
              aria-hidden="true"
              className="text-[var(--foreground-muted)] opacity-50"
            >
              ·
            </span>
            <span className="font-[family-name:var(--font-dm-mono)] text-[12px] font-semibold text-[var(--foreground)]">
              {formatRate(cell.hallucination_rate)}
            </span>
          </>
        ) : (
          <span
            title="Provider quota exhausted; see coverage note above."
            className="rounded-full border border-amber-500/40 bg-amber-50/60 px-2 py-0.5 text-[11px] text-amber-900 dark:bg-amber-900/30 dark:text-amber-200"
          >
            no data
          </span>
        )}
      </span>
    </li>
  );
}

// ─── Section 3: Live two-prompt comparison ───────────────────────────

type CellStatus = "idle" | "chatting" | "auditing" | "done" | "error";

interface LiveCellState {
  status: CellStatus;
  response?: string;
  audit?: MessageAudit;
  errorMessage?: string;
  chatStartedAt?: number;
  chatFinishedAt?: number;
  auditFinishedAt?: number;
}

interface LiveRunState {
  /** The two selected prompt ids, in selection order. */
  promptIds: [string, string];
  startedAt: number;
  finishedAt?: number;
  /** Keyed by `${promptId}::${provider}`. */
  cells: Record<string, LiveCellState>;
}

function cellKey(promptId: string, provider: LiveProvider) {
  return `${promptId}::${provider}`;
}

function LiveComparison({
  prompts,
  promptIds,
  onReset,
  onFinished,
  scrollTargetRef,
}: {
  prompts: PromptRow[];
  promptIds: [string, string];
  onReset: () => void;
  onFinished: () => void;
  scrollTargetRef: React.RefObject<HTMLDivElement | null>;
}) {
  const promptsById = useMemo(() => {
    const m = new Map<string, PromptRow>();
    for (const p of prompts) m.set(p.id, p);
    return m;
  }, [prompts]);

  const [run, setRun] = useState<LiveRunState>(() => {
    const startedAt = Date.now();
    const cells: Record<string, LiveCellState> = {};
    for (const pid of promptIds) {
      for (const provider of LIVE_PROVIDERS) {
        cells[cellKey(pid, provider)] = { status: "idle" };
      }
    }
    return { promptIds, startedAt, cells };
  });
  const [now, setNow] = useState(() => Date.now());
  const reduceMotion = useReducedMotion();
  const startedRef = useRef(false);

  // Live wall-clock timer. We only tick while the run is active and
  // has not yet finished — otherwise the timer renders the final delta.
  useEffect(() => {
    if (run.finishedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [run.finishedAt]);

  // Auto-start exactly once on mount. The parent re-mounts this
  // component (via a `key`) for every fresh comparison, so this guard
  // protects against React 19 strict-mode double-invocation rather
  // than against re-runs.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    requestAnimationFrame(() => {
      scrollTargetRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });

    // Fire all 4 (prompt × provider) chats in parallel. Each chat owns
    // its own audit follow-up, so audits also fan out in parallel —
    // but each audit waits for its specific chat response, never
    // blocking the others.
    const tasks: Promise<unknown>[] = [];
    for (const pid of promptIds) {
      for (const provider of LIVE_PROVIDERS) {
        tasks.push(runOneCell(pid, provider));
      }
    }
    void Promise.allSettled(tasks).then(() => {
      setRun((prev) => ({ ...prev, finishedAt: Date.now() }));
      onFinished();
    });
    // promptIds / runOneCell are stable for this mounted instance; the
    // start-once semantics are deliberate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runOneCell(promptId: string, provider: LiveProvider) {
    const prompt = promptsById.get(promptId);
    if (!prompt) return;
    const key = cellKey(promptId, provider);
    const chatStartedAt = Date.now();
    setRun((prev) => ({
      ...prev,
      cells: {
        ...prev.cells,
        [key]: { status: "chatting", chatStartedAt },
      },
    }));

    try {
      const chatBody: ChatRequestBody = {
        messages: [{ role: "user", content: prompt.prompt }],
        provider,
        model: PROVIDER_VIZ[provider].model,
      };
      const chatRes = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chatBody),
      });
      if (!chatRes.ok) {
        const errBody = (await chatRes.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          errBody.error ?? `chat responded ${chatRes.status}`,
        );
      }
      const chatData = (await chatRes.json()) as ChatResponseBody;
      const message: ChatMessage = chatData.message;
      const chatFinishedAt = Date.now();

      setRun((prev) => ({
        ...prev,
        cells: {
          ...prev.cells,
          [key]: {
            ...(prev.cells[key] ?? { status: "idle" }),
            status: "auditing",
            response: message.content,
            chatStartedAt,
            chatFinishedAt,
          },
        },
      }));

      const auditBody: AuditRequestBody = {
        message_id: message.id,
        content: message.content,
      };
      const auditRes = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(auditBody),
      });
      if (!auditRes.ok) {
        const errBody = (await auditRes.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          errBody.error ?? `audit responded ${auditRes.status}`,
        );
      }
      const audit = (await auditRes.json()) as MessageAudit;
      const auditFinishedAt = Date.now();

      setRun((prev) => ({
        ...prev,
        cells: {
          ...prev.cells,
          [key]: {
            ...(prev.cells[key] ?? { status: "idle" }),
            status: "done",
            response: message.content,
            audit,
            chatStartedAt,
            chatFinishedAt,
            auditFinishedAt,
          },
        },
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setRun((prev) => ({
        ...prev,
        cells: {
          ...prev.cells,
          [key]: {
            ...(prev.cells[key] ?? { status: "idle" }),
            status: "error",
            errorMessage: msg,
            chatStartedAt,
          },
        },
      }));
    }
  }

  const elapsed = ((run.finishedAt ?? now) - run.startedAt) / 1000;

  return (
    <div ref={scrollTargetRef} className="flex flex-col gap-4">
      <ComparisonHeadline
        run={run}
        promptsById={promptsById}
        elapsedSec={elapsed}
      />
      <ComparisonGrid
        run={run}
        promptsById={promptsById}
        reduceMotion={Boolean(reduceMotion)}
      />
      <PerPromptSummaryBlock run={run} promptsById={promptsById} />
      <div className="flex items-center justify-between gap-3 pt-2">
        <p className="text-[12px] text-[var(--foreground-muted)]">
          Live results — discarded on navigation. Re-running the same two
          prompts re-issues the calls.
        </p>
        <button
          type="button"
          onClick={onReset}
          disabled={!run.finishedAt}
          className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-1.5 text-[13px] font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Run another comparison
        </button>
      </div>
    </div>
  );
}

function ComparisonHeadline({
  run,
  promptsById,
  elapsedSec,
}: {
  run: LiveRunState;
  promptsById: Map<string, PromptRow>;
  elapsedSec: number;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <span className="font-[family-name:var(--font-instrument)] text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-muted)]">
          Live comparison · {run.finishedAt ? "complete" : "in flight"}
        </span>
        <span className="font-[family-name:var(--font-dm-mono)] text-[13px] text-[var(--foreground)]">
          {elapsedSec.toFixed(1)}s
        </span>
      </div>
      <div className="flex flex-col gap-1 text-[13px] text-[var(--foreground)] sm:flex-row sm:flex-wrap sm:gap-x-4">
        {run.promptIds.map((pid, i) => {
          const p = promptsById.get(pid);
          return (
            <span key={pid} className="inline-flex items-center gap-2">
              <span className="font-[family-name:var(--font-dm-mono)] text-[11.5px] uppercase tracking-wide text-[var(--foreground-muted)]">
                Prompt {i + 1}
              </span>
              <span className="font-[family-name:var(--font-dm-mono)] text-[12px] text-[var(--foreground)]">
                {pid}
              </span>
              <span className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-0.5 text-[10.5px] uppercase tracking-wide text-[var(--foreground-muted)]">
                {categoryLabel(p?.category ?? "")}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ComparisonGrid({
  run,
  promptsById,
  reduceMotion,
}: {
  run: LiveRunState;
  promptsById: Map<string, PromptRow>;
  reduceMotion: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {run.promptIds.flatMap((pid) =>
        LIVE_PROVIDERS.map((provider) => {
          const key = cellKey(pid, provider);
          const cell = run.cells[key];
          const prompt = promptsById.get(pid);
          return (
            <LiveResultCell
              key={key}
              promptId={pid}
              promptText={prompt?.prompt ?? ""}
              provider={provider}
              cell={cell}
              reduceMotion={reduceMotion}
            />
          );
        }),
      )}
    </div>
  );
}

function LiveResultCell({
  promptId,
  promptText,
  provider,
  cell,
  reduceMotion,
}: {
  promptId: string;
  promptText: string;
  provider: LiveProvider;
  cell: LiveCellState | undefined;
  reduceMotion: boolean;
}) {
  const status = cell?.status ?? "idle";
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PROVIDER_DOT provider={provider} />
          <span className="font-[family-name:var(--font-instrument)] text-[11.5px] uppercase tracking-[0.16em] text-[var(--foreground-muted)]">
            {PROVIDER_VIZ[provider].label}
          </span>
        </div>
        <span className="font-[family-name:var(--font-dm-mono)] text-[10.5px] uppercase tracking-wide text-[var(--foreground-muted)]">
          {promptId}
        </span>
      </div>

      <p className="text-[12.5px] italic leading-snug text-[var(--foreground-muted)]">
        “{truncate(promptText, 160)}”
      </p>

      <CellStatusLine cell={cell} reduceMotion={reduceMotion} />

      {status === "error" && cell?.errorMessage && (
        <p className="rounded-md border border-rose-500/40 bg-rose-50/60 px-2 py-1.5 text-[11.5px] text-rose-900 dark:bg-rose-900/30 dark:text-rose-200">
          {cell.errorMessage}
        </p>
      )}

      {(status === "auditing" || status === "done") && cell?.response && (
        <details className="group">
          <summary className="cursor-pointer list-none text-[11.5px] font-medium text-[var(--foreground-muted)] hover:text-[var(--foreground)]">
            <span className="group-open:hidden">Show response ▸</span>
            <span className="hidden group-open:inline">Hide response ▾</span>
          </summary>
          <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-[var(--border)]/60 bg-[var(--surface-muted)]/40 p-2 text-[12px] leading-snug text-[var(--foreground)]">
            {cell.response}
          </p>
        </details>
      )}

      {status === "done" && cell?.audit && (
        <>
          <SummaryBar summary={cell.audit.summary} />
          <CompactClaimList audit={cell.audit} />
        </>
      )}
    </div>
  );
}

function CellStatusLine({
  cell,
  reduceMotion,
}: {
  cell: LiveCellState | undefined;
  reduceMotion: boolean;
}) {
  const status = cell?.status ?? "idle";

  const labelByStatus: Record<CellStatus, string> = {
    idle: "Queued",
    chatting: "Chatting…",
    auditing: "Auditing…",
    done: "Complete",
    error: "Failed",
  };

  return (
    <div className="flex items-center gap-2 text-[11.5px] text-[var(--foreground-muted)]">
      {status !== "done" && status !== "error" && (
        <Dots reduceMotion={reduceMotion} />
      )}
      {status === "done" && <span aria-hidden="true">✓</span>}
      {status === "error" && <span aria-hidden="true">⚠</span>}
      <span>{labelByStatus[status]}</span>
      {cell?.chatFinishedAt && cell.chatStartedAt && (
        <span className="font-[family-name:var(--font-dm-mono)] text-[10.5px] opacity-70">
          chat {((cell.chatFinishedAt - cell.chatStartedAt) / 1000).toFixed(1)}s
        </span>
      )}
      {cell?.auditFinishedAt && cell.chatFinishedAt && (
        <span className="font-[family-name:var(--font-dm-mono)] text-[10.5px] opacity-70">
          audit {((cell.auditFinishedAt - cell.chatFinishedAt) / 1000).toFixed(1)}s
        </span>
      )}
    </div>
  );
}

function Dots({ reduceMotion }: { reduceMotion: boolean }) {
  if (reduceMotion) {
    return (
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--foreground-muted)]" />
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--foreground-muted)]" />
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--foreground-muted)]" />
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--foreground-muted)] [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--foreground-muted)] [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--foreground-muted)]" />
    </span>
  );
}

function CompactClaimList({ audit }: { audit: MessageAudit }) {
  if (audit.claims.length === 0) {
    return (
      <p className="text-[11.5px] italic text-[var(--foreground-muted)]">
        No verifiable claims found.
      </p>
    );
  }
  return (
    <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto pr-1">
      {audit.claims.map((ca) => {
        const style = VERDICT_STYLES[ca.consensus_verdict];
        return (
          <li
            key={ca.claim.id}
            className="flex items-start gap-2 rounded-md border-l-2 border-[var(--border)] py-1 pl-2 pr-1 text-[12px] leading-snug"
            style={{ borderLeftColor: undefined }}
          >
            <span
              className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide ${style.pill}`}
              title={style.label}
            >
              {style.label}
            </span>
            <span className="flex-1 text-[var(--foreground)]">
              {truncate(ca.claim.text, 130)}
            </span>
            <span className="shrink-0 font-[family-name:var(--font-dm-mono)] text-[10.5px] text-[var(--foreground-muted)]">
              {formatConfidence(ca.consensus_confidence)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function PerPromptSummaryBlock({
  run,
  promptsById,
}: {
  run: LiveRunState;
  promptsById: Map<string, PromptRow>;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
      <span className="font-[family-name:var(--font-instrument)] text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-muted)]">
        Per-prompt summary
      </span>
      <ul className="flex flex-col gap-1.5">
        {run.promptIds.map((pid) => {
          const prompt = promptsById.get(pid);
          const counts: Record<LiveProvider, number | null> = {
            openai: hallucinationCount(run.cells[cellKey(pid, "openai")]),
            anthropic: hallucinationCount(
              run.cells[cellKey(pid, "anthropic")],
            ),
          };

          // "lower one is bold" — only meaningful if both are known.
          const both =
            counts.openai !== null && counts.anthropic !== null
              ? Math.min(counts.openai, counts.anthropic)
              : null;

          return (
            <li
              key={pid}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]"
            >
              <span className="font-[family-name:var(--font-dm-mono)] text-[11.5px] uppercase tracking-wide text-[var(--foreground-muted)]">
                {pid}
              </span>
              <span className="text-[12px] italic text-[var(--foreground-muted)]">
                {truncate(prompt?.prompt ?? "", 60)}
              </span>
              <PromptCountChip
                providerLabel="GPT-4o"
                count={counts.openai}
                bold={both !== null && counts.openai === both}
              />
              <PromptCountChip
                providerLabel="Anthropic"
                count={counts.anthropic}
                bold={both !== null && counts.anthropic === both}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PromptCountChip({
  providerLabel,
  count,
  bold,
}: {
  providerLabel: string;
  count: number | null;
  bold: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-muted)]/40 px-2 py-0.5 text-[12px] ${
        bold ? "font-bold text-[var(--foreground)]" : "text-[var(--foreground-muted)]"
      }`}
    >
      <span>{providerLabel}</span>
      <span className="font-[family-name:var(--font-dm-mono)] text-[12px]">
        {count === null ? "—" : count}
      </span>
      <span className="text-[11px] opacity-70">
        hallucination{count === 1 ? "" : "s"}
      </span>
    </span>
  );
}

function hallucinationCount(cell: LiveCellState | undefined): number | null {
  if (!cell || cell.status !== "done" || !cell.audit) return null;
  return (
    cell.audit.summary.contradicted +
    cell.audit.summary.likely_hallucination
  );
}

// ─── Prompt selector ─────────────────────────────────────────────────

function PromptSelector({
  prompts,
  selected,
  setSelected,
  onRun,
  isRunning,
}: {
  prompts: PromptRow[];
  selected: string[];
  setSelected: (next: string[]) => void;
  onRun: () => void;
  isRunning: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const grouped = useMemo(() => {
    const map = new Map<string, PromptRow[]>();
    for (const p of prompts) {
      if (!map.has(p.category)) map.set(p.category, []);
      map.get(p.category)!.push(p);
    }
    return Array.from(map.entries());
  }, [prompts]);

  function togglePrompt(id: string) {
    if (selected.includes(id)) {
      setSelected(selected.filter((x) => x !== id));
      return;
    }
    if (selected.length >= 2) {
      // Replace the oldest selection so the user can pivot quickly
      // without manually unchecking — the alternative ("disable
      // further selection") felt fiddly during prototyping.
      setSelected([selected[1], id]);
      return;
    }
    setSelected([...selected, id]);
  }

  function toggleCategory(cat: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  const indicator =
    selected.length === 2
      ? "2/2 selected ✓ ready"
      : `${selected.length}/2 selected`;

  return (
    <div id="prompt-selector" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-[family-name:var(--font-instrument)] text-[11.5px] uppercase tracking-[0.16em] text-[var(--foreground-muted)]">
            Select two prompts
          </span>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${
              selected.length === 2
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                : "bg-[var(--surface-muted)] text-[var(--foreground-muted)]"
            }`}
          >
            {indicator}
          </span>
        </div>

        <div className="flex flex-col gap-3">
          {grouped.map(([category, list]) => {
            const isCollapsed = collapsed.has(category);
            return (
              <div
                key={category}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]"
              >
                <button
                  type="button"
                  onClick={() => toggleCategory(category)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                  aria-expanded={!isCollapsed}
                >
                  <span className="font-[family-name:var(--font-instrument)] text-[12px] uppercase tracking-[0.16em] text-[var(--foreground-muted)]">
                    {categoryLabel(category)}{" "}
                    <span className="opacity-60">({list.length})</span>
                  </span>
                  <span
                    aria-hidden="true"
                    className={`text-[10px] text-[var(--foreground-muted)] transition-transform ${
                      isCollapsed ? "" : "rotate-90"
                    }`}
                  >
                    ▶
                  </span>
                </button>
                {!isCollapsed && (
                  <div className="grid grid-cols-1 gap-2 border-t border-[var(--border)] p-3 sm:grid-cols-2 lg:grid-cols-3">
                    {list.map((p) => (
                      <PromptCard
                        key={p.id}
                        prompt={p}
                        isSelected={selected.includes(p.id)}
                        wouldReplace={
                          !selected.includes(p.id) && selected.length >= 2
                        }
                        onToggle={() => togglePrompt(p.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="sticky bottom-3 z-20 flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/95 px-4 py-3 shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <span className="text-[12px] text-[var(--foreground-muted)]">
          Live comparison fires <strong>4 calls in parallel</strong> (2
          prompts × 2 providers). Gemini is excluded from live runs by
          design.
        </span>
        <button
          type="button"
          onClick={onRun}
          disabled={selected.length !== 2 || isRunning}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-5 py-2 text-[13.5px] font-semibold text-[var(--accent-foreground)] transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isRunning ? "Running…" : "Run comparison (2 prompts × 2 providers)"}
        </button>
      </div>
    </div>
  );
}

function PromptCard({
  prompt,
  isSelected,
  wouldReplace,
  onToggle,
}: {
  prompt: PromptRow;
  isSelected: boolean;
  /**
   * True iff the user already has 2 prompts selected and clicking
   * this card would push the oldest one out (selection strategy (b)
   * from the spec). We render a hint so the swap behavior isn't
   * surprising.
   */
  wouldReplace: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-xl border p-3 transition ${
        isSelected
          ? "border-[var(--accent)] bg-[var(--accent)]/5"
          : "border-[var(--border)] bg-[var(--surface)]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-[family-name:var(--font-dm-mono)] text-[10.5px] uppercase tracking-wide text-[var(--foreground-muted)]">
          {prompt.id}
        </span>
        <span className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-[var(--foreground-muted)]">
          {categoryLabel(prompt.category)}
        </span>
      </div>
      <p className="line-clamp-3 text-[12.5px] leading-snug text-[var(--foreground)]">
        {prompt.prompt}
      </p>
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <label
          className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-[var(--foreground)]"
          title={
            wouldReplace
              ? "Selecting this will replace your oldest current selection."
              : undefined
          }
        >
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggle}
            className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent)]"
          />
          <span>
            {isSelected
              ? "Selected"
              : wouldReplace
                ? "Select (replaces oldest)"
                : "Select"}
          </span>
        </label>
        <Link
          href={`/?prompt=${encodeURIComponent(prompt.prompt)}`}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--foreground-muted)] transition hover:border-[var(--accent)]/40 hover:text-[var(--foreground)]"
          title="Open this prompt in the main chat"
        >
          Open in chat ↗
        </Link>
      </div>
    </div>
  );
}

// ─── Page shell ──────────────────────────────────────────────────────

export function BenchmarkClient({ view }: { view: BenchmarkView }) {
  const [selected, setSelected] = useState<string[]>([]);
  const comparisonRef = useRef<HTMLDivElement>(null);

  // The "Run" button commits the current 2-prompt selection into a
  // separate "active run" snapshot so that any further checkbox edits
  // don't mutate the in-flight run. The LiveComparison child is
  // re-mounted on each commit (via `key`) so a prior run's cell state
  // never leaks into a fresh one.
  const [committed, setCommitted] = useState<{
    when: number;
    prompts: [string, string];
  } | null>(null);
  const [committedFinished, setCommittedFinished] = useState(false);

  function requestRun() {
    if (selected.length !== 2) return;
    setCommitted({
      when: Date.now(),
      prompts: [selected[0], selected[1]],
    });
    setCommittedFinished(false);
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-foreground">
      <BenchmarkHeader />

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-12 px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
        <FindingsSummary />

        <section className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <span className="font-[family-name:var(--font-dm-mono)] text-[11px] uppercase tracking-[0.32em] text-[var(--accent)]">
              02 — Eval results
            </span>
            <h2 className="font-serif text-[34px] leading-[1.05] tracking-tight text-[var(--foreground)] sm:text-[40px]">
              Per-category <span className="italic">breakdown</span>.
            </h2>
            <p className="text-[14px] text-[var(--foreground-muted)] sm:max-w-2xl">
              Aggregate hallucination rate per provider, then a sortable 15-row
              table (5 categories × 3 providers). Click any row to expand
              the per-prompt detail.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {view.provider_headlines.map((h) => (
              <ProviderStatCard
                key={h.provider}
                provider={h.provider}
                totals={h.totals}
                rate={h.hallucination_rate}
                cellsCompleted={h.prompts_completed}
                cellsTotal={h.prompts_total}
              />
            ))}
          </div>

          <ResultsTable
            rows={view.category_provider_rows}
            prompts={view.prompts}
          />
        </section>

        <section className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <span className="font-[family-name:var(--font-dm-mono)] text-[11px] uppercase tracking-[0.32em] text-[var(--accent)]">
              03 — Live comparison
            </span>
            <h2 className="font-serif text-[34px] leading-[1.05] tracking-tight text-[var(--foreground)] sm:text-[40px]">
              Run any two prompts <span className="italic">side by side</span>.
            </h2>
            <p className="text-[14px] text-[var(--foreground-muted)] sm:max-w-2xl">
              Pick any 2 of the 15 prompts above and run them through GPT-4o
              and Claude Haiku 4.5 in parallel. Gemini is excluded from
              live comparisons (free-tier quota would interfere).
            </p>
          </div>

          <PromptSelector
            prompts={view.prompts}
            selected={selected}
            setSelected={setSelected}
            onRun={requestRun}
            isRunning={committed !== null && !committedFinished}
          />

          {committed ? (
            <LiveComparison
              key={committed.when}
              prompts={view.prompts}
              promptIds={committed.prompts}
              onFinished={() => setCommittedFinished(true)}
              onReset={() => {
                setSelected([]);
                setCommitted(null);
                setCommittedFinished(false);
                requestAnimationFrame(() => {
                  document
                    .getElementById("prompt-selector")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                });
              }}
              scrollTargetRef={comparisonRef}
            />
          ) : (
            <div
              ref={comparisonRef}
              className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center text-[14px] text-[var(--foreground-muted)]"
            >
              Pick two prompts above and press{" "}
              <span className="italic">Run comparison</span> — the live
              results panel will appear here.
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function BenchmarkHeader() {
  return (
    <header className="border-b border-[var(--border)] bg-background">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Link
          href="/"
          className="group inline-flex items-center gap-2 text-[12px] font-[family-name:var(--font-instrument)] uppercase tracking-[0.16em] text-[var(--foreground-muted)] transition hover:text-[var(--foreground)]"
        >
          <span
            aria-hidden="true"
            className="inline-block transition-transform group-hover:-translate-x-0.5"
          >
            ←
          </span>
          <span>Back to chat</span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden font-[family-name:var(--font-dm-mono)] text-[11px] uppercase tracking-[0.14em] text-[var(--foreground-muted)] sm:inline">
            Auditor: OpenAI · gpt-4o-mini
          </span>
          <Link
            href="/document"
            className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[12px] text-[var(--foreground-muted)] transition hover:border-[var(--accent)]/40 hover:text-[var(--foreground)]"
          >
            Audit a document
          </Link>
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 pb-8 pt-2 sm:px-6">
        <span className="font-[family-name:var(--font-dm-mono)] text-[11px] uppercase tracking-[0.32em] text-[var(--accent)]">
          Benchmark
        </span>
        <h1 className="font-serif text-[44px] leading-[1.02] tracking-tight text-[var(--foreground)] sm:text-[60px]">
          How often do they{" "}
          <span className="italic">make things up?</span>
        </h1>
        <p className="max-w-2xl text-[16px] leading-relaxed text-[var(--foreground-muted)]">
          A 15-prompt labeled test set across three efficient-tier chat
          models, audited by the locked OpenAI pipeline. Below: the
          headline rates, the per-category table, and a live two-prompt
          duel between OpenAI and Anthropic.
        </p>
      </div>
    </header>
  );
}
