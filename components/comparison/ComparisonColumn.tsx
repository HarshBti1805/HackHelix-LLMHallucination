import type { MessageAudit } from "@/types";
import { SummaryBar } from "@/components/audit/SummaryBar";
import {
  locateClaimSpans,
  type HighlightSpan,
} from "@/components/audit/highlightSpans";
import type { DiffTone } from "./diffClaims";

export interface ComparisonColumnProps {
  label: "Before" | "After";
  responseText: string;
  audit: MessageAudit | undefined;
  pending: boolean;
  errorMessage: string | undefined;
  toneById: Map<string, DiffTone>;
}

/**
 * One side ("Before" or "After") of the regeneration `ComparisonSidebar`.
 *
 * The column is a self-contained, independently scrollable panel:
 *   - A sticky header with a side label, the column's total claim count,
 *     and the existing `SummaryBar` so the at-a-glance verdict mix
 *     matches the inline `BeforeAfterDiff` already shown in the chat.
 *   - The full assistant response rendered as a quoted block, with each
 *     extracted claim's sentence wrapped in a tone-coloured `<mark>`:
 *       improved → green inset border + green tint
 *       worsened → rose inset border + rose tint
 *       none     → plain prose, no highlight
 *
 * The colours come from the per-claim-id tone map computed by
 * `diffClaims`. Both columns share the same tone for a matched pair,
 * which is why the same green/rose stripe lights up symmetrically on
 * both sides when a regeneration improves or fails to improve a claim.
 *
 * Sentence locations are produced by the same `locateClaimSpans` rule
 * used on the /document page — verbatim, first-occurrence-not-yet-claimed.
 * Claims whose sentence can't be located in the response simply don't
 * get a highlight; they still appear in the diff ledger below.
 */
export function ComparisonColumn({
  label,
  responseText,
  audit,
  pending,
  errorMessage,
  toneById,
}: ComparisonColumnProps) {
  const claims = audit?.claims ?? [];
  const { spans } = locateClaimSpans(responseText, claims);

  const sideTone = label === "Before" ? "rose" : "emerald";

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--surface)]">
      <header className="sticky top-0 z-10 flex flex-col gap-2 border-b border-[var(--border)] bg-[var(--surface)]/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${
                sideTone === "rose"
                  ? "bg-rose-400"
                  : "bg-emerald-400"
              }`}
            />
            <span className="font-[family-name:var(--font-instrument)] text-[10px] uppercase tracking-[0.22em] text-[var(--foreground-muted)]">
              {label}
            </span>
          </div>
          <span className="font-[family-name:var(--font-dm-mono)] text-[10.5px] tracking-wide text-[var(--foreground-muted)]">
            {audit ? `${audit.summary.total_claims} claims` : "—"}
          </span>
        </div>
        {audit && audit.summary.total_claims > 0 ? (
          <SummaryBar summary={audit.summary} />
        ) : (
          <span className="text-[11px] italic text-[var(--foreground-muted)]">
            {pending
              ? "auditing…"
              : errorMessage
                ? "audit unavailable"
                : "no verifiable claims"}
          </span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <article className="font-serif text-[15px] leading-[1.75] text-[var(--foreground)]">
          <HighlightedResponse
            text={responseText}
            spans={spans}
            toneById={toneById}
          />
        </article>
      </div>
    </section>
  );
}

/**
 * Per-tone class strings. Inline box-shadow puts a 3px coloured stripe
 * on the LEFT edge of the highlight (the spec's "subtle left-border
 * accent") without breaking inline flow when the highlight wraps
 * across multiple lines — `<mark>` is inline, so a real `border-left`
 * would only render on the first line fragment. Using `box-shadow:
 * inset` keeps the accent stripe glued to the start of every wrapped
 * fragment.
 */
const TONE_CLASS: Record<DiffTone, string> = {
  improved:
    "rounded-sm bg-emerald-100/80 px-1 py-0.5 text-emerald-950 [box-shadow:inset_3px_0_0_#10b981] dark:bg-emerald-500/20 dark:text-emerald-50 dark:[box-shadow:inset_3px_0_0_#34d399]",
  worsened:
    "rounded-sm bg-rose-100/80 px-1 py-0.5 text-rose-950 [box-shadow:inset_3px_0_0_#e11d48] dark:bg-rose-500/20 dark:text-rose-50 dark:[box-shadow:inset_3px_0_0_#fb7185]",
  none: "",
};

function HighlightedResponse({
  text,
  spans,
  toneById,
}: {
  text: string;
  spans: HighlightSpan[];
  toneById: Map<string, DiffTone>;
}) {
  if (spans.length === 0) return <>{text}</>;

  const segments: React.ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if (span.start > cursor) {
      segments.push(
        <span key={`t-${cursor}`}>{text.slice(cursor, span.start)}</span>,
      );
    }
    const tone = toneById.get(span.claim.claim.id) ?? "none";
    const slice = text.slice(span.start, span.end);
    if (tone === "none") {
      // Unchanged claims render as plain prose per spec — they're
      // intentionally not highlighted so the changed/at-risk claims
      // stand out visually.
      segments.push(<span key={`u-${span.claim.claim.id}`}>{slice}</span>);
    } else {
      segments.push(
        <mark
          key={`h-${span.claim.claim.id}`}
          className={TONE_CLASS[tone]}
          title={`${tone === "improved" ? "Improved" : "Still at risk"} — ${span.claim.claim.text}`}
        >
          {slice}
        </mark>,
      );
    }
    cursor = span.end;
  }
  if (cursor < text.length) {
    segments.push(<span key={`t-${cursor}-tail`}>{text.slice(cursor)}</span>);
  }
  return <>{segments}</>;
}
