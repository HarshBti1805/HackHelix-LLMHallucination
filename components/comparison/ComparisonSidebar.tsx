"use client";

import { useMemo } from "react";
import type { ChatMessage, MessageAudit } from "@/types";
import { ComparisonColumn } from "./ComparisonColumn";
import { ClaimDiffLedger } from "./ClaimDiffLedger";
import { diffClaims, type ClaimDiff } from "./diffClaims";

export interface ComparisonSidebarProps {
  open: boolean;
  beforeMessage: ChatMessage | undefined;
  afterMessage: ChatMessage | undefined;
  beforeAudit: MessageAudit | undefined;
  afterAudit: MessageAudit | undefined;
  beforePending: boolean;
  afterPending: boolean;
  beforeError: string | undefined;
  afterError: string | undefined;
  onClose: () => void;
}

/**
 * Side-by-side regeneration comparison panel.
 *
 * Auto-opens (driven by the parent) the moment a dehallucinate cycle
 * completes, and remains toggleable from the chat header afterwards.
 * On `lg+` viewports it occupies the right half of the screen as a
 * proper split view; the chat column shrinks to the left half but
 * keeps every existing affordance (composer, audit panels, demo
 * chips). Below `lg` the sidebar is hidden — the diff is too dense to
 * be useful at narrow widths, and the existing inline `BeforeAfterDiff`
 * pill row inside each chat message already handles that case.
 *
 * Internal layout:
 *   ┌─────────────────────────────────────────┐
 *   │ Header: title + summary + × close       │
 *   ├──────────────────┬──────────────────────┤
 *   │ Before column    │ After column         │  ← each scrollable
 *   │ (highlighted     │ (highlighted         │
 *   │  response text)  │  response text)      │
 *   ├──────────────────┴──────────────────────┤
 *   │ ClaimDiffLedger (changed / − / +)       │  ← own scroll, ~40%
 *   └─────────────────────────────────────────┘
 *
 * Both columns share the same per-claim tone map (computed once via
 * `diffClaims`) so a green stripe in After lights up the matching
 * before-side claim in Before too — visually anchoring "this got fixed".
 */
export function ComparisonSidebar({
  open,
  beforeMessage,
  afterMessage,
  beforeAudit,
  afterAudit,
  beforePending,
  afterPending,
  beforeError,
  afterError,
  onClose,
}: ComparisonSidebarProps) {
  const diff: ClaimDiff = useMemo(() => {
    return diffClaims(
      beforeAudit?.claims ?? [],
      afterAudit?.claims ?? [],
    );
  }, [beforeAudit, afterAudit]);

  if (!open) return null;

  const bothReady = Boolean(beforeAudit && afterAudit);
  const eitherFailed = Boolean(beforeError || afterError);

  return (
    <aside
      role="complementary"
      aria-label="Regeneration comparison"
      className="hidden h-full w-full min-w-0 shrink-0 border-l border-[var(--border)] bg-[var(--surface-muted)] lg:flex lg:w-1/2 lg:flex-col"
    >
      <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-background/85 px-5 py-3 backdrop-blur">
        <div className="flex flex-col leading-tight">
          <span className="font-[family-name:var(--font-dm-mono)] text-[10px] uppercase tracking-[0.28em] text-[var(--accent)]">
            Regeneration · Side-by-side
          </span>
          <span className="font-serif text-[20px] tracking-tight text-[var(--foreground)]">
            Before <span className="italic">vs.</span> After
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!bothReady && !eitherFailed && (
            <span className="hidden font-[family-name:var(--font-dm-mono)] text-[11px] uppercase tracking-wide text-[var(--foreground-muted)] sm:inline">
              auditing…
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close comparison"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground-muted)] transition hover:border-[var(--accent)]/40 hover:text-[var(--foreground)]"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-[3] grid-cols-1 divide-x divide-[var(--border)] xl:grid-cols-2">
        <ComparisonColumn
          label="Before"
          responseText={beforeMessage?.content ?? ""}
          audit={beforeAudit}
          pending={beforePending}
          errorMessage={beforeError}
          toneById={diff.toneById}
        />
        <ComparisonColumn
          label="After"
          responseText={afterMessage?.content ?? ""}
          audit={afterAudit}
          pending={afterPending}
          errorMessage={afterError}
          toneById={diff.toneById}
        />
      </div>

      <div className="min-h-0 flex-[2] overflow-y-auto">
        {bothReady ? (
          <ClaimDiffLedger diff={diff} />
        ) : (
          <div className="flex h-full items-center justify-center px-5 py-8 text-center">
            <p className="font-serif text-[18px] italic tracking-tight text-[var(--foreground-muted)]">
              {eitherFailed
                ? "One of the audits couldn't load — the diff will populate once both sides finish."
                : "Waiting on the second audit to finish…"}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
