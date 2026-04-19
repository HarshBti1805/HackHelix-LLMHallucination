"use client";

import { useMemo, useState } from "react";
import type {
  AuditDocumentRequestBody,
  DehallucinateDocumentRequestBody,
  DocumentAudit,
  DocumentRevisions,
} from "@/types";
import { ClaimList } from "@/components/audit/ClaimList";
import { locateClaimSpans } from "@/components/audit/highlightSpans";
import { failedClaimCount } from "@/components/audit/verdict";
import { DocumentHero } from "@/components/document/DocumentHero";
import { DocumentDropzone } from "@/components/document/DocumentDropzone";
import { TrustScoreCard } from "@/components/document/TrustScoreCard";
import { AuditStatGrid } from "@/components/document/AuditStatGrid";
import { VerdictDistribution } from "@/components/document/VerdictDistribution";
import { AuditingProgress } from "@/components/document/AuditingProgress";
import { SourceViewer } from "@/components/document/SourceViewer";
import { RevisionsModal } from "@/components/document/RevisionsModal";

/**
 * Dedicated document-audit report view (IMPROVEMENTS.md Phase A,
 * post-launch UI refresh).
 *
 * Page-level concerns kept here:
 *   - Source state (text, filename) and the audit response.
 *   - The fetch lifecycle to /api/audit-document.
 *   - JSON download serialization.
 *
 * Visual composition is delegated to dedicated components in
 * `components/document/*` so each piece is independently styled and
 * easier to evolve. The chat AuditPanel and the report below still
 * share `ClaimList` from `components/audit/*` — the per-claim
 * expandable row is the single source of truth for verdict detail.
 */
export default function DocumentAuditPage() {
  const [text, setText] = useState<string>("");
  const [filename, setFilename] = useState<string>("");
  const [audit, setAudit] = useState<DocumentAudit | null>(null);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Document-dehallucinate state (additive — see RevisionsModal). Three
  // pieces of state because the LLM call has three distinct lifecycle
  // points the UI cares about:
  //   - `dehallucPending`: button shows "Drafting revisions…" and is
  //     disabled. The rest of the page stays interactive (per spec).
  //   - `revisions`: when non-null, the modal is open. Clearing it back
  //     to null both closes the modal and discards all accept/reject
  //     state — that's intentional (CLAUDE.md: "Do not cache revisions
  //     across sessions"). Re-opening requires a fresh API call.
  //   - `dehallucError`: surfaced in the same error envelope as the
  //     audit error, so failures from either path render identically
  //     in the dropzone footer.
  const [dehallucPending, setDehallucPending] = useState(false);
  const [revisions, setRevisions] = useState<DocumentRevisions | null>(null);
  const [dehallucError, setDehallucError] = useState<string | null>(null);

  // Dropping a fresh source resets any prior audit so the report and
  // the input stay coherent. Otherwise a user could swap in a new
  // document but still see the previous audit's highlighted spans.
  function setSource(nextText: string, nextFilename: string) {
    setText(nextText);
    setFilename(nextFilename);
    setAudit(null);
    setErrorMessage(null);
    // Same reasoning for dehallucinate state: a new source invalidates
    // any in-progress / completed revision review.
    setRevisions(null);
    setDehallucError(null);
  }

  function handleClearFile() {
    setSource("", "");
  }

  // Show the dehallucinate button only when the audit found at least one
  // contradicted / likely_hallucination claim. Computed from the summary
  // (client-safe; the server-side `hasFailedClaims` in
  // `lib/dehallucinate-document.ts` exists for the API route's use, but
  // we can't import it from a client component because it transitively
  // pulls in the OpenAI SDK and node:fs cache).
  const canDehallucinate = audit ? failedClaimCount(audit) > 0 : false;

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

  async function handleDehallucinate() {
    if (!audit) return;
    setDehallucPending(true);
    setDehallucError(null);
    try {
      const body: DehallucinateDocumentRequestBody = {
        sourceText: audit.source_text,
        filename: audit.filename,
        audit,
      };
      const res = await fetch("/api/dehallucinate-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          payload.error ??
            `dehallucinate-document responded ${res.status}`,
        );
      }
      const data = (await res.json()) as DocumentRevisions;
      setRevisions(data);
    } catch (err) {
      setDehallucError(
        err instanceof Error
          ? err.message
          : "Unknown error drafting revisions.",
      );
    } finally {
      setDehallucPending(false);
    }
  }

  function handleDownloadJson() {
    if (!audit) return;
    // Self-contained: the JSON includes `source_text` so re-opening this
    // file later carries the original document along with its audit.
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
      <DocumentHero />

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
        <DocumentDropzone
          text={text}
          filename={filename}
          onSourceChange={setSource}
          onClearFile={handleClearFile}
          onRunAudit={handleRunAudit}
          onDownloadJson={handleDownloadJson}
          pending={pending}
          // Surface either error in the dropzone footer — same envelope
          // for both paths so the user has one place to look.
          errorMessage={errorMessage ?? dehallucError}
          hasAudit={Boolean(audit)}
          canDehallucinate={canDehallucinate}
          dehallucinatePending={dehallucPending}
          onDehallucinate={canDehallucinate ? handleDehallucinate : undefined}
        />

        {pending && <AuditingProgress />}

        {audit && !pending && <DocumentReport audit={audit} />}
      </main>

      {revisions && audit && (
        <RevisionsModal
          audit={audit}
          revisions={revisions}
          onClose={() => setRevisions(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function DocumentReport({ audit }: { audit: DocumentAudit }) {
  // Pre-locate spans here too (in addition to inside `SourceViewer`) so we
  // can pass `notLocatedNotes` to ClaimList and the not-located count to
  // `AuditStatGrid` without forcing those children to know about the
  // highlighting algorithm. Both calls memoize on the same inputs so the
  // duplication is essentially free at runtime.
  const { notLocated } = useMemo(
    () => locateClaimSpans(audit.source_text, audit.claims),
    [audit.source_text, audit.claims],
  );

  const notLocatedNotes = useMemo(() => {
    const out: Record<string, string> = {};
    for (const id of notLocated) {
      out[id] =
        "Sentence not located in source — extractor may have paraphrased.";
    }
    return out;
  }, [notLocated]);

  const hasClaims = audit.summary.total_claims > 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <span className="font-[family-name:var(--font-dm-mono)] text-[11px] uppercase tracking-[0.32em] text-[var(--accent)]">
          02 — The Report
        </span>
        <h2 className="font-serif text-[34px] leading-[1.05] tracking-tight text-[var(--foreground)] sm:text-[44px]">
          Here's what the agents{" "}
          <span className="italic">found</span>.
        </h2>
      </div>

      {hasClaims ? (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <TrustScoreCard summary={audit.summary} />
            <VerdictDistribution summary={audit.summary} />
          </div>

          <AuditStatGrid
            summary={audit.summary}
            notLocatedCount={notLocated.size}
          />
        </>
      ) : (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
          <p className="font-serif text-2xl italic tracking-tight text-[var(--foreground)]">
            No verifiable claims found.
          </p>
          <p className="mt-2 text-[14px] text-[var(--foreground-muted)]">
            The extractor didn't find any atomic factual claims — this text
            may be opinion, definition, or commentary.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <SourceViewer
          filename={audit.filename}
          sourceText={audit.source_text}
          claims={audit.claims}
        />

        <section className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <header className="flex items-center justify-between">
            <span className="font-[family-name:var(--font-instrument)] text-[11px] uppercase tracking-[0.2em] text-[var(--foreground-muted)]">
              Per-claim breakdown
            </span>
            <span className="font-[family-name:var(--font-dm-mono)] text-[11px] tracking-wide text-[var(--foreground-muted)]">
              {audit.summary.total_claims} claim
              {audit.summary.total_claims === 1 ? "" : "s"}
            </span>
          </header>
          {hasClaims ? (
            <ClaimList claims={audit.claims} notLocatedNotes={notLocatedNotes} />
          ) : (
            <p className="text-[13px] italic text-[var(--foreground-muted)]">
              Nothing to show.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * `audit_<basename>_<YYYYMMDD-HHMMSS>.json` with sane fallbacks for
 * inputs from the textarea path (where filename is `(pasted)`). Strips
 * the original extension so we don't end up with `audit_foo.txt_….json`.
 */
function downloadFilename(originalName: string): string {
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

  return `audit_${stem}_${stamp}.json`;
}
