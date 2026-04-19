import type { AuditSummary, Verdict } from "@/types";
import { SUMMARY_CATEGORIES } from "@/components/audit/verdict";

export interface VerdictDistributionProps {
  summary: AuditSummary;
}

interface SegmentTone {
  bar: string;
  dot: string;
  label: string;
}

/**
 * Verdict tones tuned for both light and dark themes. Inline hex values
 * because the bar segments are sized with `flex-grow` and rely on solid
 * backgrounds — Tailwind class strings can't be interpolated into a
 * `style` prop, and we want one source of truth for the four colors.
 */
const TONES: Record<Verdict, SegmentTone> = {
  verified: {
    bar: "bg-emerald-500",
    dot: "bg-emerald-500",
    label: "Verified",
  },
  unverified_plausible: {
    bar: "bg-amber-400",
    dot: "bg-amber-400",
    label: "Unverified",
  },
  contradicted: {
    bar: "bg-orange-500",
    dot: "bg-orange-500",
    label: "Contradicted",
  },
  likely_hallucination: {
    bar: "bg-rose-500",
    dot: "bg-rose-500",
    label: "Hallucinated",
  },
};

/**
 * Proportional segmented bar showing how a document's claims split
 * across the four verdict categories. Replaces the existing
 * `SummaryBar` pill row on the /document surface — pills are great for
 * the chat AuditPanel where vertical space is scarce, but the document
 * report has room for a richer treatment that conveys *proportion* at
 * a glance, not just counts.
 *
 * Empty state: when `total_claims === 0` the component renders nothing,
 * matching `SummaryBar`'s contract. The page already shows a "no
 * verifiable claims" copy in that branch.
 */
export function VerdictDistribution({ summary }: VerdictDistributionProps) {
  const total = summary.total_claims;
  if (total <= 0) return null;

  const segments = SUMMARY_CATEGORIES.map((cat) => ({
    verdict: cat.verdict,
    count: summary[cat.field],
    pct: (summary[cat.field] / total) * 100,
  })).filter((s) => s.count > 0);

  return (
    <section
      className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5"
      aria-label="Verdict distribution"
    >
      <div className="flex items-center justify-between">
        <span className="font-[family-name:var(--font-instrument)] text-[11px] uppercase tracking-[0.2em] text-[var(--foreground-muted)]">
          Verdict mix
        </span>
        <span className="font-[family-name:var(--font-dm-mono)] text-[11px] tracking-wide text-[var(--foreground-muted)]">
          {total} claims
        </span>
      </div>

      <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]">
        {segments.map((seg, i) => {
          const tone = TONES[seg.verdict];
          return (
            <div
              key={seg.verdict}
              className={`${tone.bar} transition-all`}
              style={{
                width: `${seg.pct}%`,
                marginLeft: i === 0 ? 0 : 1,
              }}
              title={`${tone.label}: ${seg.count} (${seg.pct.toFixed(0)}%)`}
              role="img"
              aria-label={`${tone.label}: ${seg.count} of ${total}`}
            />
          );
        })}
      </div>

      <ul className="flex flex-wrap gap-x-5 gap-y-2">
        {segments.map((seg) => {
          const tone = TONES[seg.verdict];
          return (
            <li
              key={seg.verdict}
              className="flex items-center gap-2 text-[12.5px] text-[var(--foreground)]"
            >
              <span
                aria-hidden="true"
                className={`h-2.5 w-2.5 rounded-full ${tone.dot}`}
              />
              <span className="font-[family-name:var(--font-instrument)] tracking-wide">
                {tone.label}
              </span>
              <span className="font-[family-name:var(--font-dm-mono)] text-[12px] text-[var(--foreground-muted)]">
                {seg.count} · {seg.pct.toFixed(0)}%
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
