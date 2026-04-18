import type { ClaimAudit } from "@/types";
import { AgentSection } from "./AgentSection";
import { VERDICT_STYLES, formatConfidence } from "./verdict";

/**
 * Chevron used by the expand/collapse affordance on each claim row.
 * Inlined here (rather than imported from `app/page.tsx`) so this
 * component file has no upstream dependency on the chat shell.
 */
function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export interface ClaimRowProps {
  ca: ClaimAudit;
  isExpanded: boolean;
  onToggle: () => void;
  /**
   * Optional muted marker rendered under the original-sentence section
   * when the document highlighter could not locate the sentence verbatim
   * in the source text (IMPROVEMENTS.md Phase A task A.8 fallback). The
   * chat path leaves this undefined; the `/document` page passes a short
   * "Sentence not located in source" string when its
   * first-occurrence-not-yet-claimed match misses.
   */
  notLocatedNote?: string;
}

/**
 * One audit-result card. Header is a button that toggles expansion;
 * details panel renders below when open (PROJECT_PLAN.md task 3.6).
 *
 * Originally inline in `app/page.tsx`. Factored out at IMPROVEMENTS.md
 * Phase A task A.7-prep so the chat AuditPanel and the new `/document`
 * report render the same card — same border-stripe color, same agent
 * disagreement badge, same expand chevron, same per-agent breakdown.
 *
 * Expansion is intentionally controlled by the parent (via `isExpanded`
 * + `onToggle`) so a single shared expansion-state Set in the parent
 * can drive multiple rows opening at once. See `ClaimList` for the
 * standard pattern.
 */
export function ClaimRow({
  ca,
  isExpanded,
  onToggle,
  notLocatedNote,
}: ClaimRowProps) {
  const style = VERDICT_STYLES[ca.consensus_verdict];
  return (
    <div
      className={`flex flex-col rounded-lg border border-[var(--border)] border-l-4 ${style.border} ${style.bg}`}
    >
      {/* Clickable header — the entire visible card responds to click. We keep
          source links and other interactives OUT of this button to avoid
          nesting interactive elements inside <button>. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="flex w-full flex-col gap-2 px-3 py-2 text-left transition hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${style.pill}`}
          >
            {style.label}
          </span>
          <span className="text-[11px] font-medium text-[var(--foreground-muted)]">
            {formatConfidence(ca.consensus_confidence)} confidence
          </span>
          {ca.agents_disagreed && (
            <span
              title="Agents disagreed — click to see per-agent breakdown"
              className="inline-flex items-center gap-1 rounded-full border border-amber-500/60 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900 dark:border-amber-400/60 dark:bg-amber-900/40 dark:text-amber-200"
            >
              <span aria-hidden="true">⚠</span>
              <span>Agents disagreed</span>
            </span>
          )}
          <ChevronIcon
            className={`ml-auto h-4 w-4 shrink-0 text-[var(--foreground-muted)] transition-transform duration-150 ${
              isExpanded ? "rotate-180" : ""
            }`}
          />
        </div>
        <p
          className={`text-[13px] leading-snug text-[var(--foreground)] ${
            isExpanded ? "" : "line-clamp-3"
          }`}
        >
          {ca.claim.text}
        </p>
      </button>

      {isExpanded && (
        <div className="flex flex-col gap-2 border-t border-[var(--border)]/70 px-3 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">
              Original sentence
            </span>
            <p className="text-[12px] italic leading-snug text-[var(--foreground-muted)]">
              “{ca.claim.sentence}”
            </p>
            {notLocatedNote && (
              <span className="text-[10.5px] text-[var(--foreground-muted)] opacity-70">
                {notLocatedNote}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {ca.per_agent_reports.map((report) => (
              <AgentSection key={report.agent_role} report={report} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
