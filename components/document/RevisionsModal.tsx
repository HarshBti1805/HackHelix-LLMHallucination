"use client";

import { useEffect, useMemo, useState } from "react";
import type { DocumentAudit, DocumentRevision, DocumentRevisions } from "@/types";
import { VERDICT_STYLES } from "@/components/audit/verdict";
import {
  applyRevisions,
  buildChangeMarkersMarkdown,
  locateRevisions,
} from "@/lib/document-revisions";

/**
 * Revisions Review modal.
 *
 * Opened from the `/document` page after `/api/dehallucinate-document`
 * returns a `DocumentRevisions` payload. Lets the user accept/reject each
 * proposed sentence-level fix and download two flavors of corrected
 * artifact:
 *
 *   1. "Revised document"  — plain .txt with accepted splices applied.
 *   2. "With change markers" — .md with strike-through originals →
 *      replacement, rationale embedded as an HTML comment.
 *
 * Accept/reject state is ephemeral. Closing the modal discards everything
 * — that's deliberate (CLAUDE.md: "Do not cache revisions across
 * sessions"). To get revisions back the user clicks "Dehallucinate
 * document" again, which re-fires the LLM call.
 *
 * Sentence matching uses `lib/document-revisions.locateRevisions`, which
 * mirrors `locateClaimSpans` so the on-page highlight and the downloaded
 * splice agree on which occurrence of a given sentence is "the" one.
 */
export interface RevisionsModalProps {
  audit: DocumentAudit;
  revisions: DocumentRevisions;
  onClose: () => void;
}

export function RevisionsModal({
  audit,
  revisions,
  onClose,
}: RevisionsModalProps) {
  // Default to Accept on every revision (spec: "defaulting to Accept").
  const [accepted, setAccepted] = useState<Set<string>>(() => {
    const init = new Set<string>();
    for (const r of revisions.revisions) init.add(r.claim_id);
    return init;
  });

  // Locate every revision against the source text once, so each card can
  // surface whether its original_sentence was even found. Shared between
  // the card UI and both download routines.
  const locateResult = useMemo(
    () =>
      locateRevisions(audit.source_text, revisions.revisions),
    [audit.source_text, revisions.revisions],
  );
  const unmatchedClaimIds = locateResult.unmatched;

  // Esc-to-close, mirroring the chat dehallucinate modal pattern.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Body-scroll lock while modal is open. `overflow-hidden` on <html> is
  // safer cross-browser than on <body>, especially on iOS.
  useEffect(() => {
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, []);

  function toggleAccept(claimId: string) {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(claimId)) next.delete(claimId);
      else next.add(claimId);
      return next;
    });
  }

  function handleDownloadRevised() {
    const result = applyRevisions(
      audit.source_text,
      revisions.revisions,
      accepted,
    );
    triggerDownload(
      result.text,
      revisedFilename(audit.filename, "txt"),
      "text/plain",
    );
  }

  function handleDownloadWithMarkers() {
    const md = buildChangeMarkersMarkdown(
      audit.source_text,
      revisions.revisions,
      accepted,
      { filename: audit.filename, generatedAt: new Date() },
    );
    triggerDownload(
      md,
      revisedFilename(audit.filename, "md"),
      "text/markdown",
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="revisions-modal-title"
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full flex-col bg-[var(--surface)] shadow-2xl sm:h-auto sm:max-h-[88vh] sm:w-full sm:max-w-[900px] sm:rounded-2xl sm:border sm:border-[var(--border)]"
      >
        <ModalHeader
          revisions={revisions}
          unmatchedCount={unmatchedClaimIds.size}
          onClose={onClose}
        />

        <div className="flex-1 overflow-y-auto px-4 pb-4 pt-2 sm:px-6">
          {revisions.revisions.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="flex flex-col gap-3">
              {revisions.revisions.map((r) => (
                <RevisionCard
                  key={r.claim_id}
                  revision={r}
                  isAccepted={accepted.has(r.claim_id)}
                  isUnmatched={unmatchedClaimIds.has(r.claim_id)}
                  onToggle={() => toggleAccept(r.claim_id)}
                />
              ))}
            </ul>
          )}

          {revisions.unrevisable_claims.length > 0 && (
            <UnrevisableSection
              items={revisions.unrevisable_claims}
              audit={audit}
            />
          )}
        </div>

        <ModalFooter
          onCancel={onClose}
          onDownloadRevised={handleDownloadRevised}
          onDownloadWithMarkers={handleDownloadWithMarkers}
          downloadDisabled={revisions.revisions.length === 0}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function ModalHeader({
  revisions,
  unmatchedCount,
  onClose,
}: {
  revisions: DocumentRevisions;
  unmatchedCount: number;
  onClose: () => void;
}) {
  const total = revisions.revisions.length;
  const unrev = revisions.unrevisable_claims.length;
  return (
    <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-4 py-4 sm:px-6">
      <div className="flex flex-col gap-1">
        <h2
          id="revisions-modal-title"
          className="font-serif text-2xl tracking-tight text-[var(--foreground)]"
        >
          Review revisions
        </h2>
        <p className="text-[12.5px] text-[var(--foreground-muted)]">
          {total} revision{total === 1 ? "" : "s"} suggested,{" "}
          {unrev} claim{unrev === 1 ? "" : "s"} could not be grounded
          {unmatchedCount > 0 ? (
            <>
              {" "}
              ·{" "}
              <span className="text-amber-700 dark:text-amber-300">
                {unmatchedCount} unmatched in source
              </span>
            </>
          ) : null}
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close revisions"
        className="rounded-full border border-[var(--border)] bg-background px-3 py-1.5 text-[12px] font-[family-name:var(--font-instrument)] uppercase tracking-[0.12em] text-[var(--foreground-muted)] transition hover:border-[var(--accent)]/40 hover:text-[var(--foreground)]"
      >
        Close
      </button>
    </header>
  );
}

function ModalFooter({
  onCancel,
  onDownloadRevised,
  onDownloadWithMarkers,
  downloadDisabled,
}: {
  onCancel: () => void;
  onDownloadRevised: () => void;
  onDownloadWithMarkers: () => void;
  downloadDisabled: boolean;
}) {
  return (
    <footer className="flex flex-col gap-2 border-t border-[var(--border)] bg-[var(--surface-muted)]/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-end sm:gap-3 sm:px-6">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-full border border-[var(--border)] bg-background px-4 py-2 text-[13px] font-[family-name:var(--font-instrument)] tracking-wide text-[var(--foreground)] transition hover:bg-[var(--surface-muted)]"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onDownloadWithMarkers}
        disabled={downloadDisabled}
        className="rounded-full border border-[var(--border)] bg-background px-4 py-2 text-[13px] font-[family-name:var(--font-instrument)] tracking-wide text-[var(--foreground)] transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-50"
        title="Markdown file with strike-through originals → replacements inline"
      >
        Download with change markers
      </button>
      <button
        type="button"
        onClick={onDownloadRevised}
        disabled={downloadDisabled}
        className="rounded-full bg-[var(--accent)] px-5 py-2 text-[13px] font-[family-name:var(--font-instrument)] font-semibold tracking-wide text-[var(--accent-foreground)] shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Download revised document
      </button>
    </footer>
  );
}

function RevisionCard({
  revision,
  isAccepted,
  isUnmatched,
  onToggle,
}: {
  revision: DocumentRevision;
  isAccepted: boolean;
  isUnmatched: boolean;
  onToggle: () => void;
}) {
  const verdict = VERDICT_STYLES[revision.verdict];
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-background p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${verdict.pill}`}
          >
            {verdict.label}
          </span>
          {isUnmatched && (
            <span
              title="Original sentence could not be located verbatim in the source — the auditor may have paraphrased it. This revision will be excluded from the downloaded document."
              className="rounded-full border border-amber-300/60 bg-amber-50 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
            >
              Unmatched in source
            </span>
          )}
        </div>
        <AcceptToggle isAccepted={isAccepted} onToggle={onToggle} />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-1">
        <SentenceBlock
          label="Original"
          tone="negative"
          text={revision.original_sentence}
          strike
        />
        <SentenceBlock
          label="Replacement"
          tone="positive"
          text={revision.replacement_sentence}
        />
      </div>

      <p className="text-[12px] italic text-[var(--foreground-muted)]">
        Rationale: {revision.rationale}
      </p>
    </li>
  );
}

function SentenceBlock({
  label,
  tone,
  text,
  strike = false,
}: {
  label: string;
  tone: "positive" | "negative";
  text: string;
  strike?: boolean;
}) {
  const toneCls =
    tone === "positive"
      ? "border-emerald-300/60 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100"
      : "border-rose-300/60 bg-rose-50 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-100";
  const labelTone =
    tone === "positive"
      ? "text-emerald-800 dark:text-emerald-300"
      : "text-rose-800 dark:text-rose-300";
  return (
    <div className={`rounded-lg border px-3 py-2 ${toneCls}`}>
      <div
        className={`mb-1 font-[family-name:var(--font-instrument)] text-[10.5px] uppercase tracking-[0.16em] ${labelTone}`}
      >
        {label}
      </div>
      <p
        className={`text-[13.5px] leading-snug ${
          strike ? "line-through decoration-rose-600/60" : ""
        }`}
      >
        {text}
      </p>
    </div>
  );
}

function AcceptToggle({
  isAccepted,
  onToggle,
}: {
  isAccepted: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      role="group"
      aria-label="Accept or reject this revision"
      className="inline-flex overflow-hidden rounded-full border border-[var(--border)] bg-background text-[12px] font-[family-name:var(--font-instrument)] tracking-wide"
    >
      <button
        type="button"
        onClick={() => {
          if (!isAccepted) onToggle();
        }}
        aria-pressed={isAccepted}
        className={`px-3 py-1 transition ${
          isAccepted
            ? "bg-emerald-600 text-white"
            : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
        }`}
      >
        Accept
      </button>
      <button
        type="button"
        onClick={() => {
          if (isAccepted) onToggle();
        }}
        aria-pressed={!isAccepted}
        className={`border-l border-[var(--border)] px-3 py-1 transition ${
          !isAccepted
            ? "bg-rose-600 text-white"
            : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
        }`}
      >
        Reject
      </button>
    </div>
  );
}

function UnrevisableSection({
  items,
  audit,
}: {
  items: { claim_id: string; reason: string }[];
  audit: DocumentAudit;
}) {
  const [open, setOpen] = useState(false);
  // Build a quick claim_id -> sentence map so the list is informative
  // (just showing claim_id strings would be useless to the reader).
  const sentenceById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of audit.claims) m.set(c.claim.id, c.claim.sentence);
    return m;
  }, [audit.claims]);

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]/40"
    >
      <summary className="cursor-pointer list-none px-4 py-3 text-[13px] font-[family-name:var(--font-instrument)] uppercase tracking-[0.16em] text-[var(--foreground-muted)] transition hover:text-[var(--foreground)]">
        <span className="mr-2 inline-block transition-transform" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        Unrevisable claims ({items.length})
        <p className="mt-1 normal-case tracking-normal text-[11.5px] text-[var(--foreground-muted)]">
          Failed claims the model honestly couldn't ground a replacement for.
          Surfaced here rather than dropped silently.
        </p>
      </summary>
      <ul className="flex flex-col gap-2 px-4 pb-4 pt-1">
        {items.map((u) => (
          <li
            key={u.claim_id}
            className="rounded-lg border border-[var(--border)] bg-background px-3 py-2"
          >
            <div className="mb-1 font-[family-name:var(--font-dm-mono)] text-[11px] uppercase tracking-wide text-[var(--foreground-muted)]">
              {u.claim_id}
            </div>
            {sentenceById.get(u.claim_id) && (
              <p className="mb-1 text-[12.5px] italic text-[var(--foreground)]">
                "{truncateForList(sentenceById.get(u.claim_id) ?? "", 220)}"
              </p>
            )}
            <p className="text-[12px] text-[var(--foreground-muted)]">
              Reason: {u.reason}
            </p>
          </li>
        ))}
      </ul>
    </details>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] bg-background p-8 text-center">
      <p className="font-serif text-xl italic tracking-tight text-[var(--foreground)]">
        No revisions to apply.
      </p>
      <p className="mt-2 text-[12.5px] text-[var(--foreground-muted)]">
        The dehallucinator could not produce grounded fixes for any failed
        claim. See the unrevisable list below for the model's reasoning.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function truncateForList(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

/**
 * `revised_<basename>_<YYYYMMDD-HHMMSS>.<ext>`.
 *
 * Mirrors the existing `audit_` filename helper in `app/document/page.tsx`
 * for consistency, but lives next to the modal because it's used by both
 * the txt and the md downloads.
 */
function revisedFilename(originalName: string, ext: "txt" | "md"): string {
  const stem =
    originalName
      .replace(/\.(md|markdown|txt)$/i, "")
      .replace(/[()]/g, "")
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9._-]/g, "")
      .replace(/^-+|-+$/g, "") || "document";

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  return `revised_${stem}_${stamp}.${ext}`;
}

function triggerDownload(contents: string, filename: string, mime: string) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
