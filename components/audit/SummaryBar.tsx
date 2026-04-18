import type { AuditSummary } from "@/types";
import { SUMMARY_CATEGORIES, VERDICT_STYLES } from "./verdict";

/**
 * One-line strip of verdict-count pills above an audit's claim list
 * (PROJECT_PLAN.md task 3.7).
 *
 * Originally inline in `app/page.tsx`. Factored out at IMPROVEMENTS.md
 * Phase A task A.7-prep so the chat AuditPanel and the new `/document`
 * report share the same widget — same colors, same singular/plural
 * pluralization, same separator dots. Accepts the shared `AuditSummary`
 * shape (now common to both `MessageAudit` and `DocumentAudit`).
 *
 * Renders nothing when every count is zero; the chat path uses an
 * "AuditEmpty" placeholder elsewhere instead.
 */
export function SummaryBar({ summary }: { summary: AuditSummary }) {
  // Build the visible list once so we know whether to render at all and so
  // the separator dots only appear *between* items.
  const items = SUMMARY_CATEGORIES.flatMap((cat) => {
    const count = summary[cat.field];
    if (count <= 0) return [];
    const noun = count === 1 ? cat.singular : cat.plural;
    return [{ verdict: cat.verdict, text: `${count} ${noun}` }];
  });

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--foreground-muted)]">
      {items.map((item, i) => {
        const style = VERDICT_STYLES[item.verdict];
        return (
          <span key={item.verdict} className="flex items-center gap-2">
            {i > 0 && (
              <span aria-hidden="true" className="text-[var(--foreground-muted)] opacity-50">
                ·
              </span>
            )}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.pill}`}
            >
              {item.text}
            </span>
          </span>
        );
      })}
    </div>
  );
}
