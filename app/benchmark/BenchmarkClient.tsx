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
import { ClaimList } from "@/components/audit/ClaimList";
import { VERDICT_STYLES, formatConfidence } from "@/components/audit/verdict";
import type {
  BenchmarkView,
  CategoryProviderRow,
  CellSummary,
  PromptRow,
} from "./data";

/**
 * /benchmark page client.
 *
 * Two purposes, in order of prominence:
 *
 *   1. "Run your own benchmark" — the interactive tool. Pick any number of
 *      built-in prompts AND/OR type your own, pick any subset of the three
 *      chat providers, and run the whole matrix through the existing
 *      `/api/chat` + `/api/audit` routes with a bounded concurrency pool.
 *      Results render as a per-provider scoreboard + per-prompt cards with
 *      expandable per-agent audit detail.
 *
 *   2. Reference results — the committed 15-prompt offline eval (the
 *      `eval/results.json` artifact reduced to a slim `BenchmarkView` on the
 *      server). Kept below the tool as published context.
 *
 * No new API endpoints, no changes to types.ts / lib / the audit pipeline —
 * this page only composes existing routes (CLAUDE.md "additive only").
 */

// ─── Provider visual tokens ──────────────────────────────────────────

interface ProviderViz {
  label: string;
  short: string;
  dot: string;
  /** Chat-route routing target. */
  model: ChatModel;
  /** Free-tier caveat surfaced near the toggle, if any. */
  note?: string;
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
    note: "Free tier allows ~20 requests/day — large runs may hit the quota.",
  },
};

const ALL_PROVIDERS: Provider[] = ["openai", "anthropic", "gemini"];
// Reliable defaults; Gemini is opt-in because of its free-tier daily cap.
const DEFAULT_PROVIDERS: Provider[] = ["openai", "anthropic"];

/**
 * Max prompt×provider cells executed at once. Each cell fires one chat call
 * plus one audit (which itself fans out to ~18 upstream calls), so the pool
 * is deliberately small to stay within provider rate limits on big runs.
 */
const MAX_CONCURRENT_CELLS = 3;

function PROVIDER_DOT({ provider }: { provider: Provider }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2 w-2 rounded-full ${PROVIDER_VIZ[provider].dot}`}
    />
  );
}

// Human-readable category labels (eval ids stay kebab-cased).
const CATEGORY_LABEL: Record<string, string> = {
  "fabricated-citation": "Fabricated citation",
  "specific-fact": "Specific fact",
  "contested-claim": "Contested claim",
  "compound-claim": "Compound claim",
  "open-research": "Open research",
  custom: "Your prompts",
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

// ─── Shared audit-summary math ───────────────────────────────────────

function emptySummary(): AuditSummary {
  return {
    total_claims: 0,
    verified: 0,
    unverified_plausible: 0,
    contradicted: 0,
    likely_hallucination: 0,
  };
}

function addInto(target: AuditSummary, s: AuditSummary) {
  target.total_claims += s.total_claims;
  target.verified += s.verified;
  target.unverified_plausible += s.unverified_plausible;
  target.contradicted += s.contradicted;
  target.likely_hallucination += s.likely_hallucination;
}

function rateOf(s: AuditSummary): number | null {
  if (s.total_claims <= 0) return null;
  return (s.contradicted + s.likely_hallucination) / s.total_claims;
}

// ─── Prompt pool model ───────────────────────────────────────────────

interface PoolPrompt {
  id: string;
  prompt: string;
  category: string;
  custom?: boolean;
}

function toPoolPrompt(p: PromptRow): PoolPrompt {
  return { id: p.id, prompt: p.prompt, category: p.category };
}

// ═════════════════════════════════════════════════════════════════════
// SECTION 01 — Run your own benchmark
// ═════════════════════════════════════════════════════════════════════

type CellStatus = "idle" | "chatting" | "auditing" | "done" | "error";

interface RunCellState {
  status: CellStatus;
  response?: string;
  audit?: MessageAudit;
  errorMessage?: string;
  chatStartedAt?: number;
  chatFinishedAt?: number;
  auditFinishedAt?: number;
}

interface RunState {
  promptIds: string[];
  providers: Provider[];
  startedAt: number;
  finishedAt?: number;
  /** Keyed by `${promptId}::${provider}`. */
  cells: Record<string, RunCellState>;
}

function cellKey(promptId: string, provider: Provider) {
  return `${promptId}::${provider}`;
}

function hallucinationCount(cell: RunCellState | undefined): number | null {
  if (!cell || cell.status !== "done" || !cell.audit) return null;
  return cell.audit.summary.contradicted + cell.audit.summary.likely_hallucination;
}

/**
 * Bounded-concurrency task pool. Keeps at most `limit` workers in flight,
 * pulling from a shared queue until exhausted. Used so a 15-prompt × 3-provider
 * selection doesn't fire 45 heavy audits simultaneously.
 */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        await worker(item);
      }
    },
  );
  await Promise.all(workers);
}

function BenchmarkRunner({
  prompts,
  promptIds,
  providers,
  onReset,
  onFinished,
  scrollTargetRef,
}: {
  prompts: PoolPrompt[];
  promptIds: string[];
  providers: Provider[];
  onReset: () => void;
  onFinished: () => void;
  scrollTargetRef: React.RefObject<HTMLDivElement | null>;
}) {
  const promptsById = useMemo(() => {
    const m = new Map<string, PoolPrompt>();
    for (const p of prompts) m.set(p.id, p);
    return m;
  }, [prompts]);

  const [run, setRun] = useState<RunState>(() => {
    const cells: Record<string, RunCellState> = {};
    for (const pid of promptIds) {
      for (const provider of providers) {
        cells[cellKey(pid, provider)] = { status: "idle" };
      }
    }
    return { promptIds, providers, startedAt: Date.now(), cells };
  });
  const [now, setNow] = useState(() => Date.now());
  const reduceMotion = useReducedMotion();
  const startedRef = useRef(false);

  useEffect(() => {
    if (run.finishedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [run.finishedAt]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    requestAnimationFrame(() => {
      scrollTargetRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });

    const tasks: { promptId: string; provider: Provider }[] = [];
    for (const pid of promptIds) {
      for (const provider of providers) {
        tasks.push({ promptId: pid, provider });
      }
    }

    void runPool(tasks, MAX_CONCURRENT_CELLS, (t) =>
      runOneCell(t.promptId, t.provider),
    ).then(() => {
      setRun((prev) => ({ ...prev, finishedAt: Date.now() }));
      onFinished();
    });
    // promptIds / providers are frozen for this mounted instance; the
    // start-once semantics are deliberate (parent re-mounts via key).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runOneCell(promptId: string, provider: Provider) {
    const prompt = promptsById.get(promptId);
    if (!prompt) return;
    const key = cellKey(promptId, provider);
    const chatStartedAt = Date.now();
    setRun((prev) => ({
      ...prev,
      cells: { ...prev.cells, [key]: { status: "chatting", chatStartedAt } },
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
        throw new Error(errBody.error ?? `chat responded ${chatRes.status}`);
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
        throw new Error(errBody.error ?? `audit responded ${auditRes.status}`);
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
  const total = run.promptIds.length * run.providers.length;
  const completed = Object.values(run.cells).filter(
    (c) => c.status === "done" || c.status === "error",
  ).length;

  return (
    <div ref={scrollTargetRef} className="flex flex-col gap-5">
      <RunProgressBar
        elapsedSec={elapsed}
        completed={completed}
        total={total}
        finished={Boolean(run.finishedAt)}
      />

      <Scoreboard run={run} />

      <div className="flex flex-col gap-4">
        {run.promptIds.map((pid) => (
          <PromptResultGroup
            key={pid}
            prompt={promptsById.get(pid)}
            providers={run.providers}
            run={run}
            reduceMotion={Boolean(reduceMotion)}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="text-[12px] text-[var(--foreground-muted)]">
          Live results — discarded on navigation. Re-running re-issues the
          calls.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => downloadRunResults(run, promptsById)}
            disabled={!run.finishedAt}
            className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-1.5 text-[13px] font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download results JSON
          </button>
          <button
            type="button"
            onClick={onReset}
            disabled={!run.finishedAt}
            className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-1.5 text-[13px] font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            New benchmark
          </button>
        </div>
      </div>
    </div>
  );
}

function RunProgressBar({
  elapsedSec,
  completed,
  total,
  finished,
}: {
  elapsedSec: number;
  completed: number;
  total: number;
  finished: boolean;
}) {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-[family-name:var(--font-instrument)] text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-muted)]">
          {finished ? "Benchmark complete" : "Running benchmark…"}
        </span>
        <span className="font-[family-name:var(--font-dm-mono)] text-[13px] text-[var(--foreground)]">
          {completed}/{total} cells · {elapsedSec.toFixed(1)}s
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]">
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Scoreboard ──────────────────────────────────────────────────────

interface ProviderAgg {
  provider: Provider;
  summary: AuditSummary;
  rate: number | null;
  done: number;
  errors: number;
  total: number;
}

function aggregateRun(run: RunState): ProviderAgg[] {
  return run.providers.map((provider) => {
    const summary = emptySummary();
    let done = 0;
    let errors = 0;
    for (const pid of run.promptIds) {
      const cell = run.cells[cellKey(pid, provider)];
      if (!cell) continue;
      if (cell.status === "done" && cell.audit) {
        done += 1;
        addInto(summary, cell.audit.summary);
      } else if (cell.status === "error") {
        errors += 1;
      }
    }
    return {
      provider,
      summary,
      rate: rateOf(summary),
      done,
      errors,
      total: run.promptIds.length,
    };
  });
}

function Scoreboard({ run }: { run: RunState }) {
  const aggs = aggregateRun(run);
  const ratedValues = aggs
    .map((a) => a.rate)
    .filter((r): r is number => r !== null);
  const bestRate =
    ratedValues.length >= 2 ? Math.min(...ratedValues) : null;

  const gridCols =
    run.providers.length >= 3
      ? "lg:grid-cols-3"
      : run.providers.length === 2
        ? "sm:grid-cols-2"
        : "";

  return (
    <div className="flex flex-col gap-3">
      <span className="font-[family-name:var(--font-instrument)] text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-muted)]">
        Scoreboard · lower hallucination rate is better
      </span>
      <div className={`grid grid-cols-1 gap-3 ${gridCols}`}>
        {aggs.map((agg) => (
          <ScoreCard
            key={agg.provider}
            agg={agg}
            isBest={
              bestRate !== null && agg.rate !== null && agg.rate === bestRate
            }
          />
        ))}
      </div>
    </div>
  );
}

function ScoreCard({ agg, isBest }: { agg: ProviderAgg; isBest: boolean }) {
  return (
    <div
      className={`flex flex-col gap-3 rounded-2xl border bg-[var(--surface)] p-5 transition ${
        isBest
          ? "border-[var(--accent)] ring-1 ring-[var(--accent)]/30"
          : "border-[var(--border)]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2">
          <PROVIDER_DOT provider={agg.provider} />
          <span className="font-[family-name:var(--font-instrument)] text-[12px] uppercase tracking-[0.16em] text-[var(--foreground-muted)]">
            {PROVIDER_VIZ[agg.provider].label}
          </span>
        </span>
        {isBest && (
          <span className="rounded-full bg-[var(--accent)]/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
            Fewest
          </span>
        )}
      </div>
      <div className="flex items-end gap-2">
        <span className="font-serif text-[44px] leading-none tracking-tight text-[var(--foreground)]">
          {formatRate(agg.rate)}
        </span>
        <span className="pb-1 text-[12px] text-[var(--foreground-muted)]">
          hallucination rate
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--foreground-muted)]">
        <span>
          <span className="font-[family-name:var(--font-dm-mono)]">
            {agg.done}/{agg.total}
          </span>{" "}
          prompts
        </span>
        <span aria-hidden="true" className="opacity-50">
          ·
        </span>
        <span>
          <span className="font-[family-name:var(--font-dm-mono)]">
            {agg.summary.total_claims}
          </span>{" "}
          claims
        </span>
        {agg.errors > 0 && (
          <>
            <span aria-hidden="true" className="opacity-50">
              ·
            </span>
            <span className="text-rose-700 dark:text-rose-300">
              {agg.errors} failed
            </span>
          </>
        )}
      </div>
      <SummaryBar summary={agg.summary} />
    </div>
  );
}

// ─── Per-prompt result group ─────────────────────────────────────────

function PromptResultGroup({
  prompt,
  providers,
  run,
  reduceMotion,
}: {
  prompt: PoolPrompt | undefined;
  providers: Provider[];
  run: RunState;
  reduceMotion: boolean;
}) {
  if (!prompt) return null;

  const counts = providers.map((provider) => ({
    provider,
    count: hallucinationCount(run.cells[cellKey(prompt.id, provider)]),
  }));
  const known = counts.filter((c) => c.count !== null) as {
    provider: Provider;
    count: number;
  }[];
  const minCount =
    known.length >= 2 ? Math.min(...known.map((c) => c.count)) : null;

  const gridCols =
    providers.length >= 3
      ? "md:grid-cols-2 xl:grid-cols-3"
      : providers.length === 2
        ? "md:grid-cols-2"
        : "";

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)]/30 p-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {prompt.custom ? (
            <span className="rounded-full bg-[var(--accent)]/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
              Your prompt
            </span>
          ) : (
            <span className="font-[family-name:var(--font-dm-mono)] text-[10.5px] uppercase tracking-wide text-[var(--foreground-muted)]">
              {prompt.id}
            </span>
          )}
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--foreground-muted)]">
            {categoryLabel(prompt.category)}
          </span>
        </div>
        <p className="text-[13.5px] leading-snug text-[var(--foreground)]">
          {prompt.prompt}
        </p>
      </div>

      <div className={`grid grid-cols-1 gap-3 ${gridCols}`}>
        {providers.map((provider) => (
          <RunResultCell
            key={provider}
            provider={provider}
            cell={run.cells[cellKey(prompt.id, provider)]}
            reduceMotion={reduceMotion}
            isBest={
              minCount !== null &&
              hallucinationCount(run.cells[cellKey(prompt.id, provider)]) ===
                minCount
            }
          />
        ))}
      </div>
    </div>
  );
}

function RunResultCell({
  provider,
  cell,
  reduceMotion,
  isBest,
}: {
  provider: Provider;
  cell: RunCellState | undefined;
  reduceMotion: boolean;
  isBest: boolean;
}) {
  const status = cell?.status ?? "idle";
  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border bg-[var(--surface)] p-4 transition ${
        isBest && status === "done"
          ? "border-[var(--accent)]/60"
          : "border-[var(--border)]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PROVIDER_DOT provider={provider} />
          <span className="font-[family-name:var(--font-instrument)] text-[11.5px] uppercase tracking-[0.16em] text-[var(--foreground-muted)]">
            {PROVIDER_VIZ[provider].label}
          </span>
        </div>
        {status === "done" && cell?.audit && (
          <span className="font-[family-name:var(--font-dm-mono)] text-[12px] font-semibold text-[var(--foreground)]">
            {formatRate(rateOf(cell.audit.summary))}
          </span>
        )}
      </div>

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
          {cell.audit.claims.length === 0 ? (
            <p className="text-[11.5px] italic text-[var(--foreground-muted)]">
              No verifiable claims found.
            </p>
          ) : (
            <details className="group">
              <summary className="cursor-pointer list-none text-[11.5px] font-medium text-[var(--foreground-muted)] hover:text-[var(--foreground)]">
                <span className="group-open:hidden">
                  Show {cell.audit.claims.length} claim
                  {cell.audit.claims.length === 1 ? "" : "s"} ▸
                </span>
                <span className="hidden group-open:inline">Hide claims ▾</span>
              </summary>
              <div className="mt-2">
                <ClaimList claims={cell.audit.claims} />
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function CellStatusLine({
  cell,
  reduceMotion,
}: {
  cell: RunCellState | undefined;
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
    <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--foreground-muted)]">
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
          audit{" "}
          {((cell.auditFinishedAt - cell.chatFinishedAt) / 1000).toFixed(1)}s
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

function downloadRunResults(
  run: RunState,
  promptsById: Map<string, PoolPrompt>,
) {
  const payload = {
    generated_at: new Date().toISOString(),
    providers: run.providers,
    duration_ms: (run.finishedAt ?? Date.now()) - run.startedAt,
    cells: run.promptIds.flatMap((pid) => {
      const prompt = promptsById.get(pid);
      return run.providers.map((provider) => {
        const cell = run.cells[cellKey(pid, provider)];
        return {
          prompt_id: pid,
          prompt: prompt?.prompt ?? "",
          category: prompt?.category ?? "",
          custom: Boolean(prompt?.custom),
          provider,
          model: PROVIDER_VIZ[provider].model,
          status: cell?.status ?? "idle",
          response: cell?.response ?? null,
          summary: cell?.audit?.summary ?? null,
          hallucination_rate: cell?.audit
            ? rateOf(cell.audit.summary)
            : null,
          claims: cell?.audit?.claims ?? null,
          error: cell?.errorMessage ?? null,
        };
      });
    }),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 15);
  const a = document.createElement("a");
  a.href = url;
  a.download = `benchmark_${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── Builder: prompt + provider selection ────────────────────────────

function BenchmarkBuilder({
  pool,
  selectedIds,
  setSelectedIds,
  selectedProviders,
  toggleProvider,
  onAddCustom,
  onRemoveCustom,
  onRun,
  isRunning,
}: {
  pool: PoolPrompt[];
  selectedIds: Set<string>;
  setSelectedIds: (next: Set<string>) => void;
  selectedProviders: Set<Provider>;
  toggleProvider: (p: Provider) => void;
  onAddCustom: (text: string) => void;
  onRemoveCustom: (id: string) => void;
  onRun: () => void;
  isRunning: boolean;
}) {
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [customText, setCustomText] = useState("");

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return pool;
    return pool.filter(
      (p) =>
        p.prompt.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        categoryLabel(p.category).toLowerCase().includes(q),
    );
  }, [pool, filter]);

  const grouped = useMemo(() => {
    const map = new Map<string, PoolPrompt[]>();
    for (const p of filtered) {
      if (!map.has(p.category)) map.set(p.category, []);
      map.get(p.category)!.push(p);
    }
    // "custom" group always last.
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === "custom") return 1;
      if (b === "custom") return -1;
      return 0;
    });
  }, [filtered]);

  function togglePrompt(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  function toggleCategorySelection(list: PoolPrompt[]) {
    const next = new Set(selectedIds);
    const allSelected = list.every((p) => next.has(p.id));
    if (allSelected) {
      for (const p of list) next.delete(p.id);
    } else {
      for (const p of list) next.add(p.id);
    }
    setSelectedIds(next);
  }

  function toggleCollapse(cat: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function submitCustom() {
    const text = customText.trim();
    if (!text) return;
    onAddCustom(text);
    setCustomText("");
  }

  const providerCount = selectedProviders.size;
  const cellCount = selectedIds.size * providerCount;
  const canRun = selectedIds.size > 0 && providerCount > 0 && !isRunning;

  return (
    <div id="benchmark-builder" className="flex flex-col gap-5">
      {/* Providers */}
      <div className="flex flex-col gap-2">
        <span className="font-[family-name:var(--font-instrument)] text-[11.5px] uppercase tracking-[0.16em] text-[var(--foreground-muted)]">
          1 · Providers to test
        </span>
        <div className="flex flex-wrap gap-2">
          {ALL_PROVIDERS.map((p) => {
            const active = selectedProviders.has(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => toggleProvider(p)}
                aria-pressed={active}
                className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] transition ${
                  active
                    ? "border-[var(--accent)] bg-[var(--accent)]/8 text-[var(--foreground)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground-muted)] hover:border-[var(--accent)]/40"
                }`}
              >
                <PROVIDER_DOT provider={p} />
                <span className="font-medium">{PROVIDER_VIZ[p].label}</span>
                <span
                  aria-hidden="true"
                  className={`text-[12px] ${active ? "opacity-90" : "opacity-40"}`}
                >
                  {active ? "✓" : "+"}
                </span>
              </button>
            );
          })}
        </div>
        {selectedProviders.has("gemini") && PROVIDER_VIZ.gemini.note && (
          <p className="text-[11.5px] text-[var(--foreground-muted)]">
            {PROVIDER_VIZ.gemini.note}
          </p>
        )}
      </div>

      {/* Custom prompt */}
      <div className="flex flex-col gap-2">
        <span className="font-[family-name:var(--font-instrument)] text-[11.5px] uppercase tracking-[0.16em] text-[var(--foreground-muted)]">
          2 · Add your own prompts (optional)
        </span>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <textarea
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                submitCustom();
              }
            }}
            rows={2}
            placeholder="Type a prompt to test for hallucinations, then add it to the pool…"
            className="min-h-[44px] flex-1 resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13.5px] text-[var(--foreground)] placeholder:text-[var(--foreground-muted)]/70 focus-visible:border-[var(--accent)]/50"
          />
          <button
            type="button"
            onClick={submitCustom}
            disabled={!customText.trim()}
            className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[13px] font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add prompt
          </button>
        </div>
      </div>

      {/* Prompt pool */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-[family-name:var(--font-instrument)] text-[11.5px] uppercase tracking-[0.16em] text-[var(--foreground-muted)]">
            3 · Pick prompts
          </span>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${
                selectedIds.size > 0
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                  : "bg-[var(--surface-muted)] text-[var(--foreground-muted)]"
              }`}
            >
              {selectedIds.size} selected
            </span>
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-[11.5px] text-[var(--foreground-muted)] underline-offset-2 hover:text-[var(--foreground)] hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter prompts…"
          className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--foreground)] placeholder:text-[var(--foreground-muted)]/70 focus-visible:border-[var(--accent)]/50"
        />

        <div className="flex flex-col gap-3">
          {grouped.length === 0 && (
            <p className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-6 text-center text-[13px] text-[var(--foreground-muted)]">
              No prompts match “{filter}”.
            </p>
          )}
          {grouped.map(([category, list]) => {
            const isCollapsed = collapsed.has(category);
            const allSelected = list.every((p) => selectedIds.has(p.id));
            const someSelected = list.some((p) => selectedIds.has(p.id));
            return (
              <div
                key={category}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]"
              >
                <div className="flex items-center justify-between gap-2 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => toggleCollapse(category)}
                    className="flex items-center gap-2 text-left"
                    aria-expanded={!isCollapsed}
                  >
                    <span
                      aria-hidden="true"
                      className={`text-[10px] text-[var(--foreground-muted)] transition-transform ${
                        isCollapsed ? "" : "rotate-90"
                      }`}
                    >
                      ▶
                    </span>
                    <span className="font-[family-name:var(--font-instrument)] text-[12px] uppercase tracking-[0.16em] text-[var(--foreground-muted)]">
                      {categoryLabel(category)}{" "}
                      <span className="opacity-60">({list.length})</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleCategorySelection(list)}
                    className="text-[11.5px] font-medium text-[var(--foreground-muted)] underline-offset-2 hover:text-[var(--foreground)] hover:underline"
                  >
                    {allSelected
                      ? "Deselect all"
                      : someSelected
                        ? "Select rest"
                        : "Select all"}
                  </button>
                </div>
                {!isCollapsed && (
                  <div className="grid grid-cols-1 gap-2 border-t border-[var(--border)] p-3 sm:grid-cols-2 lg:grid-cols-3">
                    {list.map((p) => (
                      <PromptCard
                        key={p.id}
                        prompt={p}
                        isSelected={selectedIds.has(p.id)}
                        onToggle={() => togglePrompt(p.id)}
                        onRemove={
                          p.custom ? () => onRemoveCustom(p.id) : undefined
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Sticky run bar */}
      <div className="sticky bottom-3 z-20 flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/95 px-4 py-3 shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <span className="text-[12px] text-[var(--foreground-muted)]">
          {cellCount > 0 ? (
            <>
              Will run{" "}
              <strong className="text-[var(--foreground)]">
                {selectedIds.size}
              </strong>{" "}
              prompt{selectedIds.size === 1 ? "" : "s"} ×{" "}
              <strong className="text-[var(--foreground)]">
                {providerCount}
              </strong>{" "}
              provider{providerCount === 1 ? "" : "s"} ={" "}
              <strong className="text-[var(--foreground)]">{cellCount}</strong>{" "}
              audited response{cellCount === 1 ? "" : "s"}.
              {cellCount > 12 && " Large runs take a few minutes."}
            </>
          ) : (
            "Pick at least one provider and one prompt to run."
          )}
        </span>
        <button
          type="button"
          onClick={onRun}
          disabled={!canRun}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-5 py-2 text-[13.5px] font-semibold text-[var(--accent-foreground)] transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isRunning ? "Running…" : "Run benchmark"}
        </button>
      </div>
    </div>
  );
}

function PromptCard({
  prompt,
  isSelected,
  onToggle,
  onRemove,
}: {
  prompt: PoolPrompt;
  isSelected: boolean;
  onToggle: () => void;
  onRemove?: () => void;
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
          {prompt.custom ? "custom" : prompt.id}
        </span>
        <span className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-[var(--foreground-muted)]">
          {categoryLabel(prompt.category)}
        </span>
      </div>
      <p className="line-clamp-3 text-[12.5px] leading-snug text-[var(--foreground)]">
        {prompt.prompt}
      </p>
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-[var(--foreground)]">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggle}
            className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent)]"
          />
          <span>{isSelected ? "Selected" : "Select"}</span>
        </label>
        <div className="flex items-center gap-2">
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="text-[11px] text-[var(--foreground-muted)] transition hover:text-rose-600 dark:hover:text-rose-400"
              title="Remove this custom prompt"
            >
              Remove
            </button>
          )}
          <Link
            href={`/?prompt=${encodeURIComponent(prompt.prompt)}`}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--foreground-muted)] transition hover:border-[var(--accent)]/40 hover:text-[var(--foreground)]"
            title="Open this prompt in the main chat"
          >
            Open in chat ↗
          </Link>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// SECTION 02 — Reference results (published offline eval)
// ═════════════════════════════════════════════════════════════════════

function FindingsSummary() {
  return (
    <section aria-labelledby="findings-summary" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="font-[family-name:var(--font-dm-mono)] text-[11px] uppercase tracking-[0.32em] text-[var(--accent)]">
          02 — Reference eval
        </span>
        <h2
          id="findings-summary"
          className="font-serif text-[34px] leading-[1.05] tracking-tight text-[var(--foreground)] sm:text-[40px]"
        >
          What we already <span className="italic">measured</span>.
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
          {cellsTotal - cellsCompleted === 1 ? "" : "s"} unavailable (provider
          quota exhausted).
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
        <NumCell
          value={row.totals.total_claims}
          hasData={hasData}
          note={noteForPartial}
        />
        <VerdictCell
          value={row.totals.verified}
          hasData={hasData}
          verdict="verified"
        />
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
            <td
              colSpan={COLUMNS.length}
              className="border-b border-[var(--border)] bg-[var(--surface-muted)]/40 px-3 py-3"
            >
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

// ═════════════════════════════════════════════════════════════════════
// Page shell
// ═════════════════════════════════════════════════════════════════════

export function BenchmarkClient({ view }: { view: BenchmarkView }) {
  const [customPrompts, setCustomPrompts] = useState<PoolPrompt[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectedProviders, setSelectedProviders] = useState<Set<Provider>>(
    () => new Set(DEFAULT_PROVIDERS),
  );
  const comparisonRef = useRef<HTMLDivElement>(null);

  const pool = useMemo<PoolPrompt[]>(
    () => [...view.prompts.map(toPoolPrompt), ...customPrompts],
    [view.prompts, customPrompts],
  );

  const [committed, setCommitted] = useState<{
    when: number;
    promptIds: string[];
    providers: Provider[];
  } | null>(null);
  const [committedFinished, setCommittedFinished] = useState(false);

  function toggleProvider(p: Provider) {
    setSelectedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  function addCustom(text: string) {
    const id = `custom-${Date.now().toString(36)}`;
    const newPrompt: PoolPrompt = {
      id,
      prompt: text,
      category: "custom",
      custom: true,
    };
    setCustomPrompts((prev) => [...prev, newPrompt]);
    setSelectedIds((prev) => new Set(prev).add(id));
  }

  function removeCustom(id: string) {
    setCustomPrompts((prev) => prev.filter((p) => p.id !== id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function requestRun() {
    if (selectedIds.size === 0 || selectedProviders.size === 0) return;
    // Freeze selection order: pool order so results read predictably.
    const orderedIds = pool
      .filter((p) => selectedIds.has(p.id))
      .map((p) => p.id);
    const orderedProviders = ALL_PROVIDERS.filter((p) =>
      selectedProviders.has(p),
    );
    setCommitted({
      when: Date.now(),
      promptIds: orderedIds,
      providers: orderedProviders,
    });
    setCommittedFinished(false);
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)", color: "var(--text-primary)", display: "flex", flexDirection: "column" }}>
      <BenchmarkHeader />

      <main style={{ maxWidth: 1100, margin: "0 auto", width: "100%", flex: 1, padding: "40px 24px 80px", display: "flex", flexDirection: "column", gap: 56 }}>
        {/* SECTION 01 — interactive tool */}
        <section style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: 11, letterSpacing: "0.28em", textTransform: "uppercase", color: "var(--accent)" }}>
              01 — Run your own benchmark
            </span>
            <h2 style={{ fontFamily: "var(--font-space-grotesk, sans-serif)", fontWeight: 600, fontSize: "clamp(26px, 3.5vw, 36px)", lineHeight: 1.1, letterSpacing: "-0.02em", color: "var(--text-primary)", margin: 0 }}>
              Run your own benchmark
            </h2>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-secondary)", maxWidth: 640, margin: 0 }}>
              Pick any number of prompts from the set below — or write your own — choose which providers to test,
              and run them all through the locked OpenAI auditor.
            </p>
          </div>

          <BenchmarkBuilder
            pool={pool}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            selectedProviders={selectedProviders}
            toggleProvider={toggleProvider}
            onAddCustom={addCustom}
            onRemoveCustom={removeCustom}
            onRun={requestRun}
            isRunning={committed !== null && !committedFinished}
          />

          {committed ? (
            <BenchmarkRunner
              key={committed.when}
              prompts={pool}
              promptIds={committed.promptIds}
              providers={committed.providers}
              onFinished={() => setCommittedFinished(true)}
              onReset={() => {
                setCommitted(null);
                setCommittedFinished(false);
                requestAnimationFrame(() => {
                  document
                    .getElementById("benchmark-builder")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                });
              }}
              scrollTargetRef={comparisonRef}
            />
          ) : (
            <div
              ref={comparisonRef}
              style={{ borderRadius: 16, border: "1px dashed var(--border)", background: "var(--bg-card)", padding: "40px 24px", textAlign: "center", fontSize: 14, color: "var(--text-secondary)" }}
            >
              Select prompts and providers above, then press <em>Run benchmark</em> — your live results will appear here.
            </div>
          )}
        </section>

        {/* SECTION 02 — reference eval */}
        <FindingsSummary />

        <section style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: 11, letterSpacing: "0.28em", textTransform: "uppercase", color: "var(--accent)" }}>
              03 — Per-category breakdown
            </span>
            <h2 style={{ fontFamily: "var(--font-space-grotesk, sans-serif)", fontWeight: 600, fontSize: "clamp(26px, 3.5vw, 36px)", lineHeight: 1.1, letterSpacing: "-0.02em", color: "var(--text-primary)", margin: 0 }}>
              The published numbers.
            </h2>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-secondary)", maxWidth: 640, margin: 0 }}>
              Aggregate hallucination rate per provider, then a sortable 15-row table (5 categories × 3 providers).
              Click any row to expand the per-prompt detail.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
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
      </main>
    </div>
  );
}

function BenchmarkHeader() {
  return (
    <header style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-base)" }}>
      {/* top nav strip */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 48, gap: 12 }}>
        <Link
          href="/"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontFamily: "var(--font-geist-mono, monospace)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", textDecoration: "none" }}
        >
          ← Back to chat
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 11, fontFamily: "var(--font-geist-mono, monospace)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            Auditor: OpenAI · gpt-4o-mini
          </span>
          <Link
            href="/document"
            style={{ fontSize: 12, color: "var(--text-secondary)", textDecoration: "none", padding: "4px 12px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--bg-card)" }}
          >
            Audit a document
          </Link>
        </div>
      </div>
      {/* hero */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px 36px" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 16, padding: "3px 12px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--bg-card)" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", display: "inline-block" }} />
          <span style={{ fontSize: 11, fontFamily: "var(--font-geist-mono, monospace)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            Lab sheet · Auditor locked · OpenAI gpt-4o-mini
          </span>
        </div>
        <h1 style={{ fontFamily: "var(--font-space-grotesk, sans-serif)", fontWeight: 600, fontSize: "clamp(32px, 5vw, 52px)", lineHeight: 1.1, letterSpacing: "-0.02em", color: "var(--text-primary)", margin: "0 0 14px" }}>
          How often do they make things up?
        </h1>
        <p style={{ maxWidth: 680, fontSize: 15, lineHeight: 1.65, color: "var(--text-secondary)", margin: 0 }}>
          Run your own hallucination benchmark: choose prompts (or write your own), pick the chat
          models to compare, and let the locked OpenAI auditor score every response. Below the tool:
          the published 15-prompt reference eval.
        </p>
      </div>
    </header>
  );
}
