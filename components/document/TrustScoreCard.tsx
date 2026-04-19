import type { AuditSummary } from "@/types";

export interface TrustScoreCardProps {
  summary: AuditSummary;
}

/**
 * Big circular gauge that turns the audit summary into a single
 * at-a-glance "trust score".
 *
 * Score formula:
 *   raw = (verified - 0.5*unverified - contradicted - likely_hallucination) / total
 *   score = clamp(0, 100, round((raw + 1) * 50))
 *
 * Which yields:
 *   - 100 = every claim verified
 *   -  50 = neutral (all claims unverified-but-plausible)
 *   -   0 = every claim contradicted or hallucinated
 *
 * The score is intentionally NOT meant to be statistically rigorous —
 * it's a UI affordance. Real interpretation lives in the per-claim
 * breakdown below. The gauge exists to give the page a center of gravity
 * and to make swapping documents feel like swapping in a different
 * "report card", which is the design intent.
 *
 * Renders as an inline SVG ring + serif numeral so it slots into either
 * a light or dark theme without raster assets.
 */
export function TrustScoreCard({ summary }: TrustScoreCardProps) {
  const score = computeTrustScore(summary);
  const tone = scoreTone(score);
  const label = scoreLabel(score, summary);

  // Geometry — chosen so the ring renders crisply at the default
  // 200px container width without needing a viewport unit.
  const size = 168;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (score / 100) * circumference;

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <header className="flex items-center justify-between">
        <span className="font-[family-name:var(--font-instrument)] text-[11px] uppercase tracking-[0.2em] text-[var(--foreground-muted)]">
          Trust score
        </span>
        <span className="font-[family-name:var(--font-dm-mono)] text-[11px] uppercase tracking-wide text-[var(--foreground-muted)]">
          / 100
        </span>
      </header>

      <div className="flex items-center gap-5">
        <div className="relative" style={{ width: size, height: size }}>
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            className="-rotate-90"
            aria-hidden="true"
          >
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke="var(--border)"
              strokeWidth={stroke}
              fill="none"
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={tone.stroke}
              strokeWidth={stroke}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${dash} ${circumference - dash}`}
              style={{ transition: "stroke-dasharray 600ms ease-out" }}
            />
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span
              className={`font-serif text-[58px] leading-none tracking-tight ${tone.text}`}
            >
              {score}
            </span>
            <span className="mt-1 font-[family-name:var(--font-dm-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--foreground-muted)]">
              of 100
            </span>
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <p className="font-serif text-[22px] leading-tight tracking-tight text-[var(--foreground)]">
            {label.headline}
          </p>
          <p className="text-[13px] leading-relaxed text-[var(--foreground-muted)]">
            {label.copy}
          </p>
        </div>
      </div>
    </section>
  );
}

function computeTrustScore(summary: AuditSummary): number {
  const total = summary.total_claims;
  if (total <= 0) return 50;
  const raw =
    (summary.verified -
      0.5 * summary.unverified_plausible -
      summary.contradicted -
      summary.likely_hallucination) /
    total;
  return Math.max(0, Math.min(100, Math.round((raw + 1) * 50)));
}

function scoreTone(score: number): { stroke: string; text: string } {
  if (score >= 80) {
    return { stroke: "#10b981", text: "text-emerald-600 dark:text-emerald-400" };
  }
  if (score >= 60) {
    return { stroke: "#f59e0b", text: "text-amber-600 dark:text-amber-400" };
  }
  if (score >= 40) {
    return { stroke: "#f97316", text: "text-orange-600 dark:text-orange-400" };
  }
  return { stroke: "#e11d48", text: "text-rose-600 dark:text-rose-400" };
}

function scoreLabel(
  score: number,
  summary: AuditSummary,
): { headline: string; copy: string } {
  if (summary.total_claims === 0) {
    return {
      headline: "No verifiable claims",
      copy: "The extractor didn't find any atomic factual claims in this text — it may be opinion, definition, or commentary.",
    };
  }
  if (score >= 80) {
    return {
      headline: "Reads well-grounded.",
      copy: "Most claims were verified against external sources. Inspect the breakdown to spot any remaining ambiguities.",
    };
  }
  if (score >= 60) {
    return {
      headline: "Mostly plausible.",
      copy: "A solid backbone of verified claims, but several are unverifiable or contested. Worth a careful read.",
    };
  }
  if (score >= 40) {
    return {
      headline: "Treat with caution.",
      copy: "Several claims couldn't be confirmed and at least one is contradicted by evidence. Don't redistribute as-is.",
    };
  }
  return {
    headline: "Heavy hallucination risk.",
    copy: "The verifiers flagged a meaningful share of claims as hallucinated or contradicted. Likely fabrication.",
  };
}
