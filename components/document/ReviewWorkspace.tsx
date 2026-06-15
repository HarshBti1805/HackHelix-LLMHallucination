"use client";

import { useMemo, useState } from "react";
import type { DocumentAudit } from "@/types";
import { VERDICT_STYLES } from "@/components/audit/verdict";

/**
 * Compliance / fact-checking review workspace (MAJOR_CHANGES.md #9).
 *
 * Turns the read-only document report into a team review surface for
 * newsroom / legal / finance / healthcare workflows:
 *   - assign each claim to a reviewer,
 *   - record a human decision (accepted / rejected / needs review),
 *   - leave a note,
 *   - export a timestamped audit trail (JSON or CSV).
 *
 * State is IN-MEMORY only, per CLAUDE.md (no persistence layer). A page
 * refresh clears review state — the export IS the durable artifact. Reviewers
 * download the trail to attach to their own record-keeping.
 */

type HumanStatus = "pending" | "accepted" | "rejected" | "needs_review";

interface ReviewRecord {
  status: HumanStatus;
  assignee: string;
  note: string;
  updated_at: string | null;
}

const STATUS_META: Record<
  HumanStatus,
  { label: string; active: string }
> = {
  pending: {
    label: "Pending",
    active:
      "bg-[var(--foreground)] text-[var(--background)] border-[var(--foreground)]",
  },
  accepted: {
    label: "Verified",
    active:
      "bg-emerald-500 text-white border-emerald-500 dark:bg-emerald-600 dark:border-emerald-600",
  },
  rejected: {
    label: "Rejected",
    active: "bg-rose-500 text-white border-rose-500 dark:bg-rose-600 dark:border-rose-600",
  },
  needs_review: {
    label: "Needs review",
    active:
      "bg-amber-500 text-white border-amber-500 dark:bg-amber-600 dark:border-amber-600",
  },
};

const STATUS_ORDER: HumanStatus[] = [
  "accepted",
  "rejected",
  "needs_review",
  "pending",
];

function emptyRecord(): ReviewRecord {
  return { status: "pending", assignee: "", note: "", updated_at: null };
}

export function ReviewWorkspace({ audit }: { audit: DocumentAudit }) {
  const [records, setRecords] = useState<Record<string, ReviewRecord>>({});

  const get = (id: string): ReviewRecord => records[id] ?? emptyRecord();

  function update(id: string, patch: Partial<ReviewRecord>) {
    setRecords((prev) => {
      const curr = prev[id] ?? emptyRecord();
      return {
        ...prev,
        [id]: { ...curr, ...patch, updated_at: new Date().toISOString() },
      };
    });
  }

  const reviewedCount = useMemo(
    () =>
      audit.claims.filter((c) => get(c.claim.id).status !== "pending").length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records, audit.claims],
  );

  function buildTrail() {
    return {
      document_id: audit.document_id,
      filename: audit.filename,
      generated_at: new Date().toISOString(),
      machine_summary: audit.summary,
      reviews: audit.claims.map((c) => {
        const r = get(c.claim.id);
        return {
          claim_id: c.claim.id,
          claim_text: c.claim.text,
          original_sentence: c.claim.sentence,
          machine_verdict: c.consensus_verdict,
          machine_confidence: c.consensus_confidence,
          human_status: r.status,
          assignee: r.assignee,
          note: r.note,
          reviewed_at: r.updated_at,
        };
      }),
    };
  }

  function download(filename: string, content: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportJson() {
    download(
      "audit-trail.json",
      JSON.stringify(buildTrail(), null, 2),
      "application/json",
    );
  }

  function exportCsv() {
    const trail = buildTrail();
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = [
      "claim_id",
      "claim_text",
      "machine_verdict",
      "machine_confidence",
      "human_status",
      "assignee",
      "note",
      "reviewed_at",
    ].join(",");
    const rows = trail.reviews.map((r) =>
      [
        esc(r.claim_id),
        esc(r.claim_text),
        esc(r.machine_verdict),
        esc(r.machine_confidence.toFixed(3)),
        esc(r.human_status),
        esc(r.assignee),
        esc(r.note),
        esc(r.reviewed_at ?? ""),
      ].join(","),
    );
    download(
      "audit-trail.csv",
      [header, ...rows].join("\n"),
      "text/csv",
    );
  }

  if (audit.claims.length === 0) return null;

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-[family-name:var(--font-dm-mono)] text-[11px] uppercase tracking-[0.32em] text-[var(--accent)]">
            03 — Review workspace
          </span>
          <h3 className="font-serif text-[24px] leading-tight tracking-tight text-[var(--foreground)]">
            Sign off, claim by claim.
          </h3>
          <p className="text-[12.5px] text-[var(--foreground-muted)]">
            Assign reviewers, record human decisions, and export a timestamped
            audit trail. {reviewedCount} of {audit.claims.length} reviewed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            className="rounded-full border border-[var(--border)] bg-background px-3.5 py-1.5 text-[12px] font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={exportJson}
            className="rounded-full border border-[var(--border)] bg-background px-3.5 py-1.5 text-[12px] font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50"
          >
            Export JSON
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-3">
        {audit.claims.map((c) => {
          const r = get(c.claim.id);
          const vStyle = VERDICT_STYLES[c.consensus_verdict];
          return (
            <div
              key={c.claim.id}
              className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-background p-3"
            >
              <div className="flex items-start gap-2">
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${vStyle.pill}`}
                >
                  {vStyle.label}
                </span>
                <p className="text-[13px] leading-snug text-[var(--foreground)]">
                  {c.claim.text}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {STATUS_ORDER.map((s) => {
                  const meta = STATUS_META[s];
                  const isActive = r.status === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => update(c.claim.id, { status: s })}
                      aria-pressed={isActive}
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
                        isActive
                          ? meta.active
                          : "border-[var(--border)] text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      {meta.label}
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[160px_1fr]">
                <input
                  type="text"
                  value={r.assignee}
                  onChange={(e) =>
                    update(c.claim.id, { assignee: e.target.value })
                  }
                  placeholder="Assignee"
                  className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[12px] text-[var(--foreground)] outline-none transition focus:border-[var(--accent)]/50"
                />
                <input
                  type="text"
                  value={r.note}
                  onChange={(e) => update(c.claim.id, { note: e.target.value })}
                  placeholder="Reviewer note (e.g. source confirmed via primary doc)"
                  className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[12px] text-[var(--foreground)] outline-none transition focus:border-[var(--accent)]/50"
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
