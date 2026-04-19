import type { ClaimAudit, Verdict } from "@/types";
import { VERDICT_STYLES } from "@/components/audit/verdict";
import {
  toneFor,
  type ClaimDiff,
  type DiffTone,
  type MatchedPair,
} from "./diffClaims";

export interface ClaimDiffLedgerProps {
  diff: ClaimDiff;
}

/**
 * Claim-by-claim diff ledger that sits below the two response columns
 * inside the `ComparisonSidebar`.
 *
 * Three row archetypes (per the spec):
 *
 *   - Changed   : both sides have the claim, but the verdict differs.
 *                 Renders the verdict pill from each side with a
 *                 directional arrow between them — green for an
 *                 improvement, rose for a regression, muted for a
 *                 lateral move.
 *   - Eliminated: claim only present in Before. Strikethrough text and a
 *                 rose `−` gutter marker. Likely a hallucinated claim
 *                 the dehallucinator successfully removed.
 *   - Introduced: claim only present in After. Green `+` gutter marker.
 *                 Could be a brand-new fact the regeneration added with
 *                 fresh evidence, or (less happily) a brand-new
 *                 hallucination — the per-claim verdict on the right
 *                 disambiguates.
 *
 * Matched pairs whose verdict is unchanged are intentionally omitted —
 * the ledger is a *diff*, not a full audit listing. Users who want the
 * full per-claim breakdown still have the existing `ClaimList` inside
 * `AuditPanel` for each side.
 */
export function ClaimDiffLedger({ diff }: ClaimDiffLedgerProps) {
  const changed = diff.matched.filter(
    (p) => p.before.consensus_verdict !== p.after.consensus_verdict,
  );
  const totalRows =
    changed.length + diff.eliminated.length + diff.introduced.length;

  if (totalRows === 0) {
    return (
      <div className="border-t border-[var(--border)] bg-[var(--surface-muted)] px-5 py-6 text-center">
        <p className="font-serif text-[18px] italic tracking-tight text-[var(--foreground-muted)]">
          No claim-level changes detected.
        </p>
        <p className="mt-1 text-[12px] text-[var(--foreground-muted)]">
          The regeneration touched the prose but every audited claim
          landed on the same verdict.
        </p>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-4 border-t border-[var(--border)] bg-[var(--surface-muted)] px-5 py-5">
      <header className="flex items-center justify-between">
        <span className="font-[family-name:var(--font-instrument)] text-[10px] uppercase tracking-[0.22em] text-[var(--foreground-muted)]">
          Claim diff
        </span>
        <span className="font-[family-name:var(--font-dm-mono)] text-[10.5px] tracking-wide text-[var(--foreground-muted)]">
          {changed.length} changed · {diff.eliminated.length} removed ·{" "}
          {diff.introduced.length} added
        </span>
      </header>

      <ul className="flex flex-col gap-2">
        {changed.map((pair) => (
          <ChangedRow key={`c-${pair.before.claim.id}`} pair={pair} />
        ))}
        {diff.eliminated.map((c) => (
          <EliminatedRow key={`e-${c.claim.id}`} claim={c} />
        ))}
        {diff.introduced.map((c) => (
          <IntroducedRow key={`i-${c.claim.id}`} claim={c} />
        ))}
      </ul>
    </section>
  );
}

function ChangedRow({ pair }: { pair: MatchedPair }) {
  const tone: DiffTone = toneFor(
    pair.before.consensus_verdict,
    pair.after.consensus_verdict,
  );
  const arrow = ARROW_TONE[tone];

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex items-start gap-3">
        <Gutter symbol="·" tone="muted" />
        <p className="flex-1 font-serif text-[14px] leading-snug text-[var(--foreground)]">
          {pair.after.claim.text || pair.before.claim.text}
        </p>
      </div>
      <div className="ml-7 flex flex-wrap items-center gap-2 text-[11px]">
        <VerdictPill verdict={pair.before.consensus_verdict} />
        <span
          aria-hidden="true"
          className={`inline-flex h-5 w-6 items-center justify-center rounded-full ${arrow.bg} ${arrow.text}`}
          title={arrow.title}
        >
          →
        </span>
        <VerdictPill verdict={pair.after.consensus_verdict} />
      </div>
    </li>
  );
}

function EliminatedRow({ claim }: { claim: ClaimAudit }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-rose-200/60 bg-rose-50/60 p-3 dark:border-rose-900/50 dark:bg-rose-950/25">
      <Gutter symbol="−" tone="rose" />
      <div className="flex flex-1 flex-col gap-1">
        <p className="font-serif text-[14px] leading-snug text-[var(--foreground-muted)] line-through decoration-rose-400/70 decoration-1">
          {claim.claim.text}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="font-[family-name:var(--font-instrument)] text-[10px] uppercase tracking-[0.18em] text-[var(--foreground-muted)]">
            Removed · was
          </span>
          <VerdictPill verdict={claim.consensus_verdict} />
        </div>
      </div>
    </li>
  );
}

function IntroducedRow({ claim }: { claim: ClaimAudit }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-emerald-200/60 bg-emerald-50/60 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/25">
      <Gutter symbol="+" tone="emerald" />
      <div className="flex flex-1 flex-col gap-1">
        <p className="font-serif text-[14px] leading-snug text-[var(--foreground)]">
          {claim.claim.text}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="font-[family-name:var(--font-instrument)] text-[10px] uppercase tracking-[0.18em] text-[var(--foreground-muted)]">
            New · now
          </span>
          <VerdictPill verdict={claim.consensus_verdict} />
        </div>
      </div>
    </li>
  );
}

function VerdictPill({ verdict }: { verdict: Verdict }) {
  const style = VERDICT_STYLES[verdict];
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.pill}`}
    >
      {style.label}
    </span>
  );
}

function Gutter({
  symbol,
  tone,
}: {
  symbol: string;
  tone: "rose" | "emerald" | "muted";
}) {
  const cls =
    tone === "rose"
      ? "bg-rose-500 text-white"
      : tone === "emerald"
        ? "bg-emerald-500 text-white"
        : "bg-[var(--surface-muted)] text-[var(--foreground-muted)] border border-[var(--border)]";
  return (
    <span
      aria-hidden="true"
      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md font-[family-name:var(--font-dm-mono)] text-[12px] font-bold leading-none ${cls}`}
    >
      {symbol}
    </span>
  );
}

const ARROW_TONE: Record<
  DiffTone,
  { bg: string; text: string; title: string }
> = {
  improved: {
    bg: "bg-emerald-100 dark:bg-emerald-900/50",
    text: "text-emerald-700 dark:text-emerald-300",
    title: "Improved",
  },
  worsened: {
    bg: "bg-rose-100 dark:bg-rose-900/50",
    text: "text-rose-700 dark:text-rose-300",
    title: "Regressed",
  },
  none: {
    bg: "bg-[var(--surface-muted)]",
    text: "text-[var(--foreground-muted)]",
    title: "Lateral change",
  },
};
