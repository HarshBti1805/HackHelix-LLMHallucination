"use client";

import { useRef, useState } from "react";

export interface DocumentDropzoneProps {
  text: string;
  filename: string;
  onSourceChange: (text: string, filename: string) => void;
  onClearFile: () => void;
  onRunAudit: () => void;
  onDownloadJson: () => void;
  pending: boolean;
  errorMessage: string | null;
  hasAudit: boolean;
}

/**
 * Combined drop-target + paste-textarea + run-audit control.
 *
 * Behaves like a single composable input surface:
 *   - The big dashed panel is both a click target (opens the file picker)
 *     and a drag-and-drop sink for `.txt`/`.md` files. While a drag is
 *     hovering, the panel lights up with the brand accent so users get
 *     instant feedback that the drop will land.
 *   - Below it, the textarea owns the paste-text path. The two inputs
 *     are mutually exclusive in semantics — picking a file replaces the
 *     textarea's contents, and editing the textarea clears the filename.
 *     Both go through the same `onSourceChange` callback so the parent
 *     stays the single source of truth.
 *   - A footer strip tracks word/char counts in real time and exposes
 *     the primary "Run audit" action plus the secondary
 *     "Download audit JSON" once a report exists.
 *
 * Doesn't render the resulting report — that's `SourceViewer` plus the
 * audit cards. Keeps this component focused on input only.
 */
export function DocumentDropzone({
  text,
  filename,
  onSourceChange,
  onClearFile,
  onRunAudit,
  onDownloadJson,
  pending,
  errorMessage,
  hasAudit,
}: DocumentDropzoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  const charCount = text.length;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const visibleError = errorMessage ?? readError;

  async function ingestFile(file: File) {
    try {
      const contents = await file.text();
      onSourceChange(contents, file.name);
      setReadError(null);
    } catch (err) {
      setReadError(
        `Couldn't read file: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await ingestFile(file);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) await ingestFile(file);
  }

  return (
    <section className="flex flex-col gap-5">
      {/* Drop zone */}
      <div
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        className={`group relative flex cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
          isDragging
            ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,var(--surface))]"
            : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]/60 hover:bg-[var(--surface-muted)]"
        }`}
      >
        {/* Decorative corner ticks — pure ornament */}
        <CornerTick className="left-3 top-3" />
        <CornerTick className="right-3 top-3 rotate-90" />
        <CornerTick className="left-3 bottom-3 -rotate-90" />
        <CornerTick className="right-3 bottom-3 rotate-180" />

        <div
          className={`flex h-14 w-14 items-center justify-center rounded-2xl transition ${
            isDragging
              ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
              : "bg-[var(--surface-muted)] text-[var(--foreground-muted)] group-hover:bg-[var(--accent)]/10 group-hover:text-[var(--accent)]"
          }`}
        >
          <DocumentIcon className="h-7 w-7" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-serif text-2xl tracking-tight text-[var(--foreground)] sm:text-[28px]">
            {isDragging ? (
              <>
                Drop it <span className="italic">here</span>
              </>
            ) : filename ? (
              <>
                Loaded <span className="italic">{filename}</span>
              </>
            ) : (
              <>
                Drop a document, or <span className="italic">browse</span>
              </>
            )}
          </p>
          <p className="text-[13px] text-[var(--foreground-muted)]">
            Supports <code className="font-[family-name:var(--font-dm-mono)] text-[12px]">.txt</code>{" "}
            and <code className="font-[family-name:var(--font-dm-mono)] text-[12px]">.md</code>{" "}
            · or paste text below
          </p>
        </div>
        {filename && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClearFile();
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
            className="rounded-full border border-[var(--border)] bg-background px-3 py-1 text-[11px] font-[family-name:var(--font-instrument)] uppercase tracking-[0.12em] text-[var(--foreground-muted)] transition hover:border-[var(--accent)]/40 hover:text-[var(--foreground)]"
          >
            Clear file
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,text/plain,text/markdown"
          onChange={handleFileChange}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
        />
      </div>

      {/* Paste textarea */}
      <div className="flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor="document-paste"
            className="font-[family-name:var(--font-instrument)] text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-muted)]"
          >
            Or paste text
          </label>
          <span className="font-[family-name:var(--font-dm-mono)] text-[11px] tracking-wide text-[var(--foreground-muted)]">
            {wordCount.toLocaleString()} words ·{" "}
            {charCount.toLocaleString()} chars
          </span>
        </div>
        <textarea
          id="document-paste"
          value={text}
          onChange={(e) => {
            // Editing the textarea decouples from any previously loaded file
            // — the filename should follow the new content, not linger as
            // stale metadata.
            onSourceChange(e.target.value, "");
          }}
          placeholder="Paste a passage, an article, an essay…"
          spellCheck={false}
          className="min-h-[200px] w-full resize-y rounded-xl border border-[var(--border)] bg-background px-4 py-3 font-[family-name:var(--font-dm-mono)] text-[13px] leading-[1.65] text-[var(--foreground)] outline-none transition placeholder:text-[var(--foreground-muted)]/70 focus:border-[var(--accent)]"
        />
      </div>

      {/* Action strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-md text-[12.5px] leading-relaxed text-[var(--foreground-muted)]">
          The auditor extracts up to 25 atomic claims, then runs three
          adversarial subagents per claim in parallel. Cold-cache audits
          can take ~60s.
        </p>
        <div className="flex items-center gap-2">
          {hasAudit && (
            <button
              type="button"
              onClick={onDownloadJson}
              className="rounded-full border border-[var(--border)] bg-background px-4 py-2 text-[13px] font-[family-name:var(--font-instrument)] tracking-wide text-[var(--foreground)] transition hover:bg-[var(--surface-muted)]"
            >
              Download JSON
            </button>
          )}
          <button
            type="button"
            onClick={onRunAudit}
            disabled={pending || !text.trim()}
            className="rounded-full bg-[var(--accent)] px-6 py-2.5 font-[family-name:var(--font-instrument)] text-[14px] font-semibold tracking-wide text-[var(--accent-foreground)] shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Auditing…" : hasAudit ? "Re-run audit" : "Run audit"}
          </button>
        </div>
      </div>

      {visibleError && (
        <div
          role="alert"
          className="rounded-xl border border-rose-300/60 bg-rose-50 px-4 py-3 text-[13px] text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
        >
          {visibleError}
        </div>
      )}
    </section>
  );
}

function CornerTick({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute h-3 w-3 border-l border-t border-[var(--foreground-muted)]/30 ${className}`}
    />
  );
}

function DocumentIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="1.6"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </svg>
  );
}
