"use client";

import { useMemo, useRef } from "react";
import type { ClaimAudit } from "@/types";
import { VERDICT_STYLES } from "@/components/audit/verdict";
import {
  locateClaimSpans,
  type HighlightSpan,
} from "@/components/audit/highlightSpans";

export interface SourceViewerProps {
  filename: string;
  sourceText: string;
  claims: ClaimAudit[];
}

/**
 * Magazine-styled source viewer for a `DocumentAudit`.
 *
 * The previous /document layout rendered the source as plain
 * `whitespace-pre-wrap` body text. This component upgrades that surface:
 *   - Sticky filename + "claims located / not-located" status header
 *     so the context never scrolls away from the highlighted text.
 *   - Editorial typography (Instrument Serif for the document body) with
 *     a 70-char measure for comfortable reading at the bumped 17px root.
 *   - "Jump to next/prev claim" buttons that scroll the next highlight
 *     into view inside the scroll container, useful for long docs where
 *     highlighted sentences would otherwise be hard to find.
 *   - Numbered highlight markers so a reader can match a span in the
 *     prose with a row in the right-hand `ClaimList` (rows are also
 *     listed in claim-index order, so "claim 4" lines up).
 *
 * Highlight geometry comes from `locateClaimSpans` — same algorithm the
 * previous implementation used; only the rendering changes.
 */
export function SourceViewer({
  filename,
  sourceText,
  claims,
}: SourceViewerProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  const { spans, notLocated } = useMemo(
    () => locateClaimSpans(sourceText, claims),
    [sourceText, claims],
  );

  // Build a stable claim-index map (1-based) so the inline numbered markers
  // match the per-claim list ordering in the right column. Done as a Map
  // keyed by claim id rather than searching `claims` per render — O(1)
  // lookup keeps `HighlightedSource` allocation-free.
  const claimIndexById = useMemo(() => {
    const m = new Map<string, number>();
    claims.forEach((c, i) => m.set(c.claim.id, i + 1));
    return m;
  }, [claims]);

  function scrollToSpanIndex(idx: number) {
    const root = scrollerRef.current;
    if (!root) return;
    const target = root.querySelector<HTMLElement>(`[data-span-index="${idx}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("ring-2", "ring-[var(--accent)]/60");
    window.setTimeout(() => {
      target.classList.remove("ring-2", "ring-[var(--accent)]/60");
    }, 1200);
  }

  function jump(direction: 1 | -1) {
    if (spans.length === 0) return;
    // Track the "current" span in a data attr on the scroller so back-to-
    // back clicks step through the highlights instead of always landing on
    // the same one. Defaults to -1 so the first "next" jump lands on idx 0.
    const root = scrollerRef.current;
    const cursorRaw = root?.dataset.cursor ?? "-1";
    const current = Number.parseInt(cursorRaw, 10);
    const next = (current + direction + spans.length) % spans.length;
    if (root) root.dataset.cursor = String(next);
    scrollToSpanIndex(next);
  }

  return (
    <section className="flex h-full min-h-[480px] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)]/95 px-5 py-3 backdrop-blur">
        <div className="flex flex-col">
          <span className="font-[family-name:var(--font-instrument)] text-[10px] uppercase tracking-[0.2em] text-[var(--foreground-muted)]">
            Source
          </span>
          <span
            className="max-w-[44ch] truncate font-serif text-[18px] tracking-tight text-[var(--foreground)]"
            title={filename}
          >
            {filename}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden font-[family-name:var(--font-dm-mono)] text-[11px] tracking-wide text-[var(--foreground-muted)] sm:inline">
            {spans.length} highlighted
            {notLocated.size > 0 && ` · ${notLocated.size} not located`}
          </span>
          {spans.length > 0 && (
            <div className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-background p-0.5">
              <button
                type="button"
                onClick={() => jump(-1)}
                className="rounded-full px-2 py-1 text-[12px] text-[var(--foreground-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
                aria-label="Previous claim"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => jump(1)}
                className="rounded-full px-2 py-1 text-[12px] text-[var(--foreground-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
                aria-label="Next claim"
              >
                ↓
              </button>
            </div>
          )}
        </div>
      </header>

      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto px-6 py-6 sm:px-10 sm:py-8"
      >
        <article className="mx-auto max-w-[68ch] whitespace-pre-wrap break-words font-serif text-[17px] leading-[1.75] text-[var(--foreground)] sm:text-[18px]">
          <HighlightedSource
            text={sourceText}
            spans={spans}
            claimIndexById={claimIndexById}
          />
        </article>
      </div>
    </section>
  );
}

function HighlightedSource({
  text,
  spans,
  claimIndexById,
}: {
  text: string;
  spans: HighlightSpan[];
  claimIndexById: Map<string, number>;
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
    const style = VERDICT_STYLES[span.claim.consensus_verdict];
    const claimIdx = claimIndexById.get(span.claim.claim.id) ?? i + 1;
    segments.push(
      <mark
        key={`h-${span.claim.claim.id}`}
        data-span-index={i}
        className={`group relative rounded px-1 py-0.5 transition ${style.highlight}`}
        title={`${claimIdx}. ${span.claim.claim.text}`}
      >
        <sup className="mr-1 inline-block font-[family-name:var(--font-dm-mono)] text-[10px] font-semibold tabular-nums opacity-70">
          {claimIdx}
        </sup>
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
