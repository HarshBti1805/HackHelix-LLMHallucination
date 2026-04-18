"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type {
  AuditDocumentRequestBody,
  DocumentAudit,
} from "@/types";
import { ClaimList } from "@/components/audit/ClaimList";
import { SummaryBar } from "@/components/audit/SummaryBar";
import {
  locateClaimSpans,
  type HighlightSpan,
} from "@/components/audit/highlightSpans";
import { VERDICT_STYLES } from "@/components/audit/verdict";

/**
 * Dedicated document-audit report view (IMPROVEMENTS.md Phase A tasks
 * A.5–A.10).
 *
 * Independent route from the chat — a user navigates here from a top-
 * right link on `/`. Lifecycle is single-page-app:
 *
 *   1. Pick a `.txt`/`.md` file OR paste text into the textarea. Either
 *      input populates the same `text`/`filename` state.
 *   2. Click "Run audit" → POST `/api/audit-document` with
 *      `{ text, filename }`. Loading state shown while the auditor
 *      (extract + 3-subagent verify per claim, capped at 25 claims) runs;
 *      that's typically ~30s, can be 60s on a cold cache.
 *   3. On success: render the two-column report. Left column = the
 *      original `source_text` with each located claim sentence wrapped
 *      in a verdict-colored highlight. Right column = the shared
 *      `SummaryBar` + `ClaimList` (same expandable per-agent breakdown
 *      as the chat AuditPanel — A.7-prep factored those out so this page
 *      reuses them verbatim).
 *   4. "Download audit JSON" serializes the entire `DocumentAudit`
 *      (claims + summary + the source text it ran against, so the
 *      download is self-contained) and triggers a browser save.
 *
 * In-memory state only — no persistence, no audit history list, no
 * server-side session, per CLAUDE.md core rule 6.
 */
export default function DocumentAuditPage() {
  const [text, setText] = useState<string>("");
  const [filename, setFilename] = useState<string>("");
  const [audit, setAudit] = useState<DocumentAudit | null>(null);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Dropping a fresh source resets any prior audit so the report and
  // the input stay coherent. Otherwise a user could swap in a new
  // document but still see the previous audit's highlighted spans
  // (which would all show as "not located" but only after a confusing
  // visual flash). Better to clear immediately on input.
  function setSource(nextText: string, nextFilename: string) {
    setText(nextText);
    setFilename(nextFilename);
    setAudit(null);
    setErrorMessage(null);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const contents = await file.text();
      setSource(contents, file.name);
    } catch (err) {
      setErrorMessage(
        `Couldn't read file: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }
  }

  function handleClearFile() {
    setSource("", "");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleRunAudit() {
    if (!text.trim()) {
      setErrorMessage("Add some text or upload a file first.");
      return;
    }
    setPending(true);
    setErrorMessage(null);
    setAudit(null);
    try {
      const body: AuditDocumentRequestBody = {
        text,
        // The endpoint requires a non-empty filename; the textarea path
        // doesn't have one naturally, so we synthesize a sentinel that's
        // self-evidently from the pasted-text flow when it shows up in
        // the JSON download filename later.
        filename: filename.trim() || "(pasted)",
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
        throw new Error(
          payload.error ?? `audit-document responded ${res.status}`,
        );
      }
      const data = (await res.json()) as DocumentAudit;
      setAudit(data);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Unknown error running audit.",
      );
    } finally {
      setPending(false);
    }
  }

  function handleDownloadJson() {
    if (!audit) return;
    // Self-contained: the JSON includes `source_text` so re-opening this
    // file later (e.g. in another tool, or by pasting back into the
    // textarea) carries the original document along with its audit.
    const blob = new Blob([JSON.stringify(audit, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = downloadFilename(audit.filename);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-foreground">
      <DocumentHeader />

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
        <DocumentInputCard
          text={text}
          filename={filename}
          onTextChange={(v) => setSource(v, filename)}
          onFilePick={() => fileInputRef.current?.click()}
          onClearFile={handleClearFile}
          onRunAudit={handleRunAudit}
          onDownloadJson={handleDownloadJson}
          pending={pending}
          errorMessage={errorMessage}
          hasAudit={Boolean(audit)}
        />

        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,text/plain,text/markdown"
          onChange={handleFileChange}
          className="hidden"
          aria-hidden="true"
        />

        {pending && <DocumentLoadingState />}

        {audit && !pending && <DocumentReport audit={audit} />}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponents (kept colocated — none of this is reused elsewhere)
// ─────────────────────────────────────────────────────────────────────────────

function DocumentHeader() {
  return (
    <header className="flex items-center justify-between border-b border-[var(--border)] bg-background/80 px-4 py-3 backdrop-blur sm:px-6">
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="text-[12px] text-[var(--foreground-muted)] transition hover:text-[var(--foreground)]"
        >
          ← Back to chat
        </Link>
        <span className="text-[var(--foreground-muted)]">·</span>
        <span className="text-sm font-semibold tracking-tight">
          Document audit
        </span>
      </div>
      <span className="hidden text-[11px] text-[var(--foreground-muted)] sm:inline">
        Auditor: OpenAI gpt-4o-mini · 3 subagents per claim · cap 25 claims
      </span>
    </header>
  );
}

interface DocumentInputCardProps {
  text: string;
  filename: string;
  onTextChange: (v: string) => void;
  onFilePick: () => void;
  onClearFile: () => void;
  onRunAudit: () => void;
  onDownloadJson: () => void;
  pending: boolean;
  errorMessage: string | null;
  hasAudit: boolean;
}

function DocumentInputCard({
  text,
  filename,
  onTextChange,
  onFilePick,
  onClearFile,
  onRunAudit,
  onDownloadJson,
  pending,
  errorMessage,
  hasAudit,
}: DocumentInputCardProps) {
  const charCount = text.length;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <h1 className="text-base font-semibold tracking-tight">
            Audit a document
          </h1>
          <p className="text-[12px] text-[var(--foreground-muted)]">
            Upload a <code>.txt</code> or <code>.md</code> file, or paste
            text. The auditor runs the same extract → multi-agent verify
            pipeline as the chat, capped at 25 claims per document.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onFilePick}
            className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1 text-[12px] font-medium transition hover:bg-[var(--surface)]"
          >
            Choose file…
          </button>
          {filename && (
            <span className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-background px-2 py-1 text-[11px] text-[var(--foreground-muted)]">
              <span className="max-w-[16ch] truncate" title={filename}>
                {filename}
              </span>
              <button
                type="button"
                onClick={onClearFile}
                className="text-[var(--foreground-muted)] transition hover:text-[var(--foreground)]"
                aria-label="Clear file"
              >
                ×
              </button>
            </span>
          )}
        </div>
      </div>

      <textarea
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder="…or paste document text here."
        spellCheck={false}
        className="min-h-[180px] w-full resize-y rounded-md border border-[var(--border)] bg-background px-3 py-2 font-mono text-[12.5px] leading-snug text-[var(--foreground)] outline-none transition focus:border-[var(--accent)]"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-[var(--foreground-muted)]">
          {wordCount} words · {charCount.toLocaleString()} chars
        </span>
        <div className="flex items-center gap-2">
          {hasAudit && (
            <button
              type="button"
              onClick={onDownloadJson}
              className="rounded-full border border-[var(--border)] bg-background px-3 py-1 text-[12px] font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-muted)]"
            >
              Download audit JSON
            </button>
          )}
          <button
            type="button"
            onClick={onRunAudit}
            disabled={pending || !text.trim()}
            className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-[12.5px] font-semibold text-[var(--accent-foreground)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Auditing…" : hasAudit ? "Re-run audit" : "Run audit"}
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-md border border-rose-300/60 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
          {errorMessage}
        </div>
      )}
    </section>
  );
}

function DocumentLoadingState() {
  return (
    <section className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-10 text-center">
      <div className="flex items-center gap-1">
        <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--foreground-muted)] [animation-delay:-0.3s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--foreground-muted)] [animation-delay:-0.15s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--foreground-muted)]" />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-medium">Auditing document…</span>
        <span className="text-[11px] text-[var(--foreground-muted)]">
          Extracting claims, then running 3 subagents per claim in parallel.
          May take up to a minute on a cold cache for full-length documents.
        </span>
      </div>
    </section>
  );
}

function DocumentReport({ audit }: { audit: DocumentAudit }) {
  // Locate each claim's `sentence` in the source text using the
  // first-occurrence-not-yet-claimed rule. Memoize so re-renders triggered
  // by ClaimList expansion don't re-scan the document on every click.
  const { spans, notLocated } = useMemo(
    () => locateClaimSpans(audit.source_text, audit.claims),
    [audit.source_text, audit.claims],
  );

  // Build the muted "sentence not located" markers passed down to ClaimList.
  // Done as a Record keyed by claim.id so ClaimRow can look up by id without
  // needing to know about the highlighter's data shape.
  const notLocatedNotes = useMemo(() => {
    const out: Record<string, string> = {};
    for (const id of notLocated) {
      out[id] = "Sentence not located in source — extractor may have paraphrased.";
    }
    return out;
  }, [notLocated]);

  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">
            Source · {audit.filename}
          </h2>
          <span className="text-[11px] text-[var(--foreground-muted)]">
            {spans.length} highlighted ·{" "}
            {notLocated.size > 0
              ? `${notLocated.size} not located`
              : "all claims located"}
          </span>
        </div>
        <article className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-[var(--foreground)]">
          <HighlightedSource text={audit.source_text} spans={spans} />
        </article>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">
            Audit · {audit.summary.total_claims} claims
          </h2>
          {audit.summary.total_claims > 0 ? (
            <SummaryBar summary={audit.summary} />
          ) : (
            <span className="text-[12px] italic text-[var(--foreground-muted)]">
              No verifiable claims extracted from this document.
            </span>
          )}
        </div>
        {audit.summary.total_claims > 0 && (
          <ClaimList
            claims={audit.claims}
            notLocatedNotes={notLocatedNotes}
          />
        )}
      </div>
    </section>
  );
}

/**
 * Render `text` with each `HighlightSpan` wrapped in a verdict-colored
 * inline `<mark>`. Spans must already be sorted by `start` ascending and
 * non-overlapping (both invariants guaranteed by `locateClaimSpans`).
 */
function HighlightedSource({
  text,
  spans,
}: {
  text: string;
  spans: HighlightSpan[];
}) {
  if (spans.length === 0) {
    return <>{text}</>;
  }

  const segments: React.ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if (span.start > cursor) {
      segments.push(
        <span key={`t-${cursor}`}>{text.slice(cursor, span.start)}</span>,
      );
    }
    const style = VERDICT_STYLES[span.claim.consensus_verdict];
    segments.push(
      <mark
        key={`h-${span.claim.claim.id}`}
        className={`rounded px-0.5 ${style.highlight}`}
        title={`${style.label} — ${span.claim.claim.text}`}
      >
        {text.slice(span.start, span.end)}
      </mark>,
    );
    cursor = span.end;
  }
  if (cursor < text.length) {
    segments.push(<span key={`t-${cursor}-tail`}>{text.slice(cursor)}</span>);
  }
  return <>{segments}</>;
}

/**
 * `audit_<basename>_<YYYYMMDD-HHMMSS>.json` with sane fallbacks for
 * inputs from the textarea path (where filename is `(pasted)`). Strips
 * the original extension so we don't end up with `audit_foo.txt_….json`.
 */
function downloadFilename(originalName: string): string {
  const stem = originalName
    .replace(/\.(md|markdown|txt)$/i, "")
    .replace(/[()]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .replace(/^-+|-+$/g, "")
    || "document";

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  return `audit_${stem}_${stamp}.json`;
}
