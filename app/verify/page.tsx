"use client";

import { useState } from "react";
import Link from "next/link";
import type {
  AuditDocumentRequestBody,
  CheckCitationsRequestBody,
  CitationCandidate,
  CitationCheck,
  CitationReport,
  CitationStatus,
  DocumentAudit,
  FetchUrlRequestBody,
  FetchUrlResponseBody,
} from "@/types";
import { ClaimList } from "@/components/audit/ClaimList";
import { SummaryBar } from "@/components/audit/SummaryBar";
import { AuditHeadlineBar } from "@/components/audit/AuditHeadlineBar";

/**
 * Verify a source (MAJOR_CHANGES.md #5 + #8, combined).
 *
 * One page, two analyses, two ways in:
 *   - Input: paste text OR fetch a URL/webpage (server-side via /api/fetch-url).
 *   - Analysis:
 *       · "Audit claims"   → full multi-agent audit (/api/audit-document)
 *       · "Check citations" → bibliographic reference check (/api/check-citations)
 *
 * Replaces the old standalone /citations page; the citation checker now lives
 * here alongside webpage auditing.
 */

type Mode = "audit" | "citations";

const STATUS_STYLE: Record<
  CitationStatus,
  { label: string; pill: string; border: string; bg: string }
> = {
  verified: {
    label: "Verified",
    pill: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200",
    border: "border-l-emerald-500",
    bg: "bg-emerald-500/[0.04]",
  },
  uncertain: {
    label: "Uncertain",
    pill: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
    border: "border-l-amber-500",
    bg: "bg-amber-500/[0.04]",
  },
  not_found: {
    label: "Not found — likely fabricated",
    pill: "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-200",
    border: "border-l-rose-500",
    bg: "bg-rose-500/[0.04]",
  },
};

const SAMPLE = `Recent work has explored the metabolic effects of intermittent fasting. Johnson et al. (2021) found significant improvements in insulin sensitivity. See also Patterson & Sears (2017), "Metabolic Effects of Intermittent Fasting", Annual Review of Nutrition.`;

export default function VerifyPage() {
  const [mode, setMode] = useState<Mode>("audit");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [fetching, setFetching] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [audit, setAudit] = useState<DocumentAudit | null>(null);
  const [report, setReport] = useState<CitationReport | null>(null);

  function resetResults() {
    setAudit(null);
    setReport(null);
    setError(null);
  }

  async function fetchUrl() {
    if (!url.trim()) {
      setError("Enter a URL to fetch.");
      return;
    }
    setFetching(true);
    setError(null);
    try {
      const body: FetchUrlRequestBody = { url };
      const res = await fetch("/api/fetch-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? `fetch-url responded ${res.status}`);
      }
      const data = (await res.json()) as FetchUrlResponseBody;
      setText(data.text);
      setSourceLabel(data.title || data.url);
      resetResults();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't fetch the page.");
    } finally {
      setFetching(false);
    }
  }

  async function run() {
    if (!text.trim()) {
      setError("Paste text or fetch a URL first.");
      return;
    }
    setPending(true);
    resetResults();
    try {
      if (mode === "audit") {
        const body: AuditDocumentRequestBody = {
          text,
          filename: sourceLabel || "(pasted)",
        };
        const res = await fetch("/api/audit-document", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(payload.error ?? `audit responded ${res.status}`);
        }
        setAudit((await res.json()) as DocumentAudit);
      } else {
        const body: CheckCitationsRequestBody = { text };
        const res = await fetch("/api/check-citations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(payload.error ?? `citations responded ${res.status}`);
        }
        setReport((await res.json()) as CitationReport);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-foreground">
      <header className="border-b border-[var(--border)] bg-background">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pt-7 pb-8 sm:px-6 sm:pt-10 sm:pb-10">
          <div className="flex items-center justify-between gap-3">
            <Link
              href="/"
              className="group flex items-center gap-2 text-[12px] font-[family-name:var(--font-instrument)] uppercase tracking-[0.16em] text-[var(--foreground-muted)] transition hover:text-[var(--foreground)]"
            >
              <span
                aria-hidden="true"
                className="inline-block transition-transform group-hover:-translate-x-0.5"
              >
                ←
              </span>
              <span>Back to Groundtruth</span>
            </Link>
            <span className="hidden text-[11px] font-[family-name:var(--font-dm-mono)] uppercase tracking-[0.14em] text-[var(--foreground-muted)] sm:inline">
              Web audit · Crossref · Semantic Scholar
            </span>
          </div>
          <div className="flex flex-col gap-3">
            <span className="font-[family-name:var(--font-dm-mono)] text-[11px] uppercase tracking-[0.32em] text-[var(--accent)]">
              Verify a source
            </span>
            <h1 className="font-serif text-[40px] leading-[1.02] tracking-tight text-[var(--foreground)] sm:text-[58px]">
              Fact-check any page
              <br className="hidden sm:block" />{" "}
              <span className="italic">or its references.</span>
            </h1>
            <p className="max-w-2xl text-[16px] leading-relaxed text-[var(--foreground-muted)] sm:text-[17px]">
              Paste text or drop in a link. Run a full multi-agent claim audit,
              or check that every cited reference actually exists — fabricated
              papers, wrong authors, and invented years get flagged.
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
        {/* URL fetch bar */}
        <div className="flex flex-col gap-2">
          <span className="font-[family-name:var(--font-instrument)] text-[12px] uppercase tracking-[0.16em] text-[var(--foreground)]">
            Fetch a webpage
          </span>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void fetchUrl();
              }}
              placeholder="https://example.com/article"
              className="flex-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-[13.5px] text-[var(--foreground)] outline-none transition focus:border-[var(--accent)]/50"
            />
            <button
              type="button"
              onClick={fetchUrl}
              disabled={fetching}
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-2.5 text-[13px] font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {fetching ? "Fetching…" : "Fetch page"}
            </button>
          </div>
        </div>

        {/* Content textarea */}
        <label className="flex flex-col gap-2">
          <span className="flex items-center justify-between">
            <span className="font-[family-name:var(--font-instrument)] text-[12px] uppercase tracking-[0.16em] text-[var(--foreground)]">
              Content to verify
              {sourceLabel && (
                <span className="ml-2 normal-case tracking-normal text-[var(--foreground-muted)]">
                  · {sourceLabel}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => {
                setText(SAMPLE);
                setSourceLabel("");
                resetResults();
              }}
              className="text-[11px] text-[var(--foreground-muted)] underline-offset-2 transition hover:text-[var(--foreground)] hover:underline"
            >
              load sample
            </button>
          </span>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSourceLabel("");
            }}
            placeholder="Paste text here, or fetch a page above…"
            rows={12}
            className="min-h-[220px] w-full resize-y rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-[13.5px] leading-relaxed text-[var(--foreground)] outline-none transition focus:border-[var(--accent)]/50"
          />
        </label>

        {/* Mode toggle + run */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="inline-flex rounded-full border border-[var(--border)] bg-[var(--surface)] p-1">
            <ModeButton
              active={mode === "audit"}
              onClick={() => {
                setMode("audit");
                resetResults();
              }}
            >
              Audit claims
            </ModeButton>
            <ModeButton
              active={mode === "citations"}
              onClick={() => {
                setMode("citations");
                resetResults();
              }}
            >
              Check citations
            </ModeButton>
          </div>
          <button
            type="button"
            onClick={run}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-6 py-2.5 text-[13px] font-semibold text-[var(--background)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending
              ? mode === "audit"
                ? "Auditing…"
                : "Checking references…"
              : mode === "audit"
                ? "Run audit"
                : "Check citations"}
          </button>
          {error && (
            <span className="text-[13px] text-rose-600 dark:text-rose-400">
              {error}
            </span>
          )}
        </div>

        {audit && mode === "audit" && <AuditResult audit={audit} />}
        {report && mode === "citations" && (
          <CitationReportView report={report} />
        )}
      </main>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-4 py-1.5 text-[12.5px] font-medium transition ${
        active
          ? "bg-[var(--accent)] text-[var(--background)]"
          : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
      }`}
    >
      {children}
    </button>
  );
}

function AuditResult({ audit }: { audit: DocumentAudit }) {
  if (audit.summary.total_claims === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
        <p className="font-serif text-2xl italic tracking-tight text-[var(--foreground)]">
          No verifiable claims found.
        </p>
        <p className="mt-2 text-[14px] text-[var(--foreground-muted)]">
          This text may be opinion or commentary rather than checkable fact.
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-raised)]">
      <AuditHeadlineBar summary={audit.summary} />
      <SummaryBar summary={audit.summary} />
      <div className="flex flex-col gap-2 p-2">
        <ClaimList claims={audit.claims} />
      </div>
    </div>
  );
}

function CitationReportView({ report }: { report: CitationReport }) {
  if (report.summary.total === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
        <p className="font-serif text-2xl italic tracking-tight text-[var(--foreground)]">
          No scholarly references found.
        </p>
        <p className="mt-2 text-[14px] text-[var(--foreground-muted)]">
          The text didn&apos;t contain citations the checker could recognise.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="References" value={String(report.summary.total)} />
        <Stat
          label="Verified"
          value={String(report.summary.verified)}
          tone="text-emerald-600 dark:text-emerald-400"
        />
        <Stat
          label="Uncertain"
          value={String(report.summary.uncertain)}
          tone="text-amber-600 dark:text-amber-400"
        />
        <Stat
          label="Not found"
          value={String(report.summary.not_found)}
          tone="text-rose-600 dark:text-rose-400"
        />
      </div>
      <div className="flex flex-col gap-3">
        {report.claims.map((c, i) => (
          <CitationCard key={c.claim.id || i} c={c} />
        ))}
      </div>
    </div>
  );
}

function CitationCard({ c }: { c: CitationCheck }) {
  const [open, setOpen] = useState(false);
  const style = STATUS_STYLE[c.status];
  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border border-[var(--border)] border-l-4 ${style.border} ${style.bg} px-4 py-3`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${style.pill}`}
        >
          {style.label}
        </span>
        <span className="text-[11px] font-medium text-[var(--foreground-muted)]">
          {Math.round(c.confidence * 100)}% confidence
        </span>
      </div>
      <p className="text-[13.5px] leading-snug text-[var(--foreground)]">
        {c.cited_reference}
      </p>
      <p className="text-[12px] leading-snug text-[var(--foreground-muted)]">
        {c.rationale}
      </p>

      {c.best_match && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">
            Best match
          </span>
          <CandidateLine cand={c.best_match} />
        </div>
      )}

      {c.candidates.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-[11px] text-[var(--foreground-muted)] underline-offset-2 transition hover:text-[var(--foreground)] hover:underline"
          >
            {open ? "Hide" : "Show"} {c.candidates.length} candidate
            {c.candidates.length === 1 ? "" : "s"} from indices
          </button>
          {open && (
            <div className="mt-2 flex flex-col gap-2">
              {c.candidates.map((cand, i) => (
                <div
                  key={i}
                  className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                >
                  <CandidateLine cand={cand} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CandidateLine({ cand }: { cand: CitationCandidate }) {
  const meta = [cand.authors, cand.year, cand.venue].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[12.5px] font-medium text-[var(--foreground)]">
        {cand.url ? (
          <a
            href={cand.url}
            target="_blank"
            rel="noreferrer"
            className="underline-offset-2 hover:underline"
          >
            {cand.title}
          </a>
        ) : (
          cand.title
        )}
      </span>
      {meta && (
        <span className="text-[11px] text-[var(--foreground-muted)]">
          {meta} <span className="opacity-60">· {cand.source}</span>
        </span>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "text-[var(--foreground)]",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <span className="text-[11px] font-[family-name:var(--font-dm-mono)] uppercase tracking-[0.14em] text-[var(--foreground-muted)]">
        {label}
      </span>
      <span className={`font-serif text-[32px] leading-none ${tone}`}>
        {value}
      </span>
    </div>
  );
}
