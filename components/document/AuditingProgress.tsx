"use client";

import { useEffect, useState } from "react";

const STAGES = [
  {
    key: "extract",
    title: "Extracting claims",
    detail: "Splitting the document into atomic factual claims.",
  },
  {
    key: "dispatch",
    title: "Dispatching subagents",
    detail: "Three independent verifiers — Prosecutor, Defender, Literalist — start in parallel.",
  },
  {
    key: "search",
    title: "Searching evidence",
    detail: "Each agent runs its own web search and forms an opinion.",
  },
  {
    key: "aggregate",
    title: "Aggregating verdicts",
    detail: "Reconciling the three reports into a consensus per claim.",
  },
] as const;

/**
 * Staged loading UI shown while `/api/audit-document` is in flight.
 *
 * Why a fake stepper over a single spinner:
 *   - The audit really does take 30–60s on a cold cache. Without
 *     intermediate signals the page feels frozen and users tend to
 *     bail.
 *   - Each stage maps to a real backend step (extract → parallel verify →
 *     aggregate), so the copy is informational, not theatre. The timing
 *     is approximate — the client can't observe server progress, so we
 *     advance on a fixed schedule and just hold the last stage open
 *     until the response lands.
 *
 * The component owns no fetch logic itself; the parent handles the
 * request and unmounts this when the response arrives.
 */
export function AuditingProgress() {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    // Advance one stage every ~6s and clamp at the last one. The clamp
    // means a slow audit just leaves the final stage spinning rather
    // than wrapping back around (which would falsely imply progress).
    const id = window.setInterval(() => {
      setActiveIndex((i) => Math.min(i + 1, STAGES.length - 1));
    }, 6000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section className="flex flex-col gap-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
      <header className="flex items-center justify-between">
        <span className="font-[family-name:var(--font-instrument)] text-[11px] uppercase tracking-[0.2em] text-[var(--accent)]">
          Auditing in progress
        </span>
        <PulsingDots />
      </header>

      <h2 className="font-serif text-3xl tracking-tight text-[var(--foreground)] sm:text-4xl">
        Three agents are <span className="italic">arguing</span> about your
        document.
      </h2>

      <ol className="flex flex-col gap-3">
        {STAGES.map((stage, i) => {
          const state =
            i < activeIndex ? "done" : i === activeIndex ? "active" : "pending";
          return (
            <li
              key={stage.key}
              className={`flex items-start gap-4 rounded-xl border px-4 py-3 transition ${
                state === "active"
                  ? "border-[var(--accent)]/50 bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface))]"
                  : "border-[var(--border)] bg-background"
              }`}
            >
              <StageBadge index={i + 1} state={state} />
              <div className="flex flex-col gap-0.5">
                <span
                  className={`font-[family-name:var(--font-instrument)] text-[14px] font-semibold tracking-wide ${
                    state === "pending"
                      ? "text-[var(--foreground-muted)]"
                      : "text-[var(--foreground)]"
                  }`}
                >
                  {stage.title}
                </span>
                <span className="text-[12.5px] leading-relaxed text-[var(--foreground-muted)]">
                  {stage.detail}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      <p className="text-[12px] italic text-[var(--foreground-muted)]">
        Cold-cache runs can take up to a minute. Don't refresh — the audit
        runs entirely in this tab.
      </p>
    </section>
  );
}

function StageBadge({
  index,
  state,
}: {
  index: number;
  state: "pending" | "active" | "done";
}) {
  if (state === "done") {
    return (
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  }
  if (state === "active") {
    return (
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] font-[family-name:var(--font-dm-mono)] text-[12px] font-semibold text-[var(--accent-foreground)]"
      >
        <span className="absolute h-7 w-7 animate-ping rounded-full bg-[var(--accent)]/40" />
        <span className="relative">{index}</span>
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-muted)] font-[family-name:var(--font-dm-mono)] text-[12px] text-[var(--foreground-muted)]"
    >
      {index}
    </span>
  );
}

function PulsingDots() {
  return (
    <span aria-hidden="true" className="flex items-center gap-1">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent)]" />
    </span>
  );
}
