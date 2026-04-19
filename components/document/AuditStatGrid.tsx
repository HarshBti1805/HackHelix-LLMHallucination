import type { AuditSummary } from "@/types";

export interface AuditStatGridProps {
  summary: AuditSummary;
  notLocatedCount: number;
}

/**
 * Three large stat tiles surfacing the headline numbers from a
 * `DocumentAudit`. Renders below the trust gauge and above the per-claim
 * list so the page reads top-down: gauge → quantitative summary → detail.
 *
 * The stats are deliberately redundant with the per-claim list — the goal
 * is to give skim-readers a defensible takeaway in <2 seconds without
 * having to expand any rows. Mixed type voices (Instrument Serif numerals,
 * DM Mono labels) make the tiles feel editorial rather than dashboardy.
 */
export function AuditStatGrid({ summary, notLocatedCount }: AuditStatGridProps) {
  const failed = summary.contradicted + summary.likely_hallucination;
  const verifiedPct =
    summary.total_claims > 0
      ? Math.round((summary.verified / summary.total_claims) * 100)
      : 0;

  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StatTile
        label="Total claims"
        value={summary.total_claims}
        caption="Atomic factual claims extracted from this document."
        accent="text-[var(--foreground)]"
      />
      <StatTile
        label="Verified"
        value={summary.verified}
        suffix={summary.total_claims > 0 ? `${verifiedPct}%` : undefined}
        caption="Backed by at least one credible external source."
        accent="text-emerald-600 dark:text-emerald-400"
      />
      <StatTile
        label="At risk"
        value={failed}
        caption={
          failed > 0
            ? `${summary.contradicted} contradicted · ${summary.likely_hallucination} hallucinated`
            : "No claims flagged as contradicted or hallucinated."
        }
        accent={
          failed > 0
            ? "text-rose-600 dark:text-rose-400"
            : "text-[var(--foreground-muted)]"
        }
      />
      {notLocatedCount > 0 && (
        <p className="sm:col-span-3 -mt-1 text-[12px] italic text-[var(--foreground-muted)]">
          {notLocatedCount} claim{notLocatedCount === 1 ? "" : "s"} couldn't be
          located verbatim in the source — the extractor likely paraphrased.
        </p>
      )}
    </section>
  );
}

interface StatTileProps {
  label: string;
  value: number;
  suffix?: string;
  caption: string;
  accent: string;
}

function StatTile({ label, value, suffix, caption, accent }: StatTileProps) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <span className="font-[family-name:var(--font-instrument)] text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-muted)]">
        {label}
      </span>
      <div className="flex items-baseline gap-2">
        <span className={`font-serif text-[44px] leading-none tracking-tight ${accent}`}>
          {value}
        </span>
        {suffix && (
          <span className="font-[family-name:var(--font-dm-mono)] text-[12px] tracking-wide text-[var(--foreground-muted)]">
            {suffix}
          </span>
        )}
      </div>
      <p className="text-[12.5px] leading-relaxed text-[var(--foreground-muted)]">
        {caption}
      </p>
    </div>
  );
}
