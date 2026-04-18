import type { AgentReport } from "@/types";
import { AGENT_ROLE_LABEL, VERDICT_STYLES, formatConfidence } from "./verdict";

/**
 * Per-agent breakdown card rendered inside an expanded `ClaimRow`.
 *
 * Originally inline in `app/page.tsx` (PROJECT_PLAN.md task 3.6). Factored
 * out at IMPROVEMENTS.md Phase A task A.7-prep so the chat AuditPanel and
 * the new `/document` report share the same per-claim breakdown — same
 * pill, same reasoning paragraph, same source list.
 *
 * Each card surfaces the four pieces a reviewer needs to judge an
 * agent's verdict: who the agent is, what verdict they returned, how
 * confident, the reasoning paragraph, and the cited evidence sources
 * (with click-through links). The runner in `lib/agents.ts` validates
 * indices server-side, so any source rendered here was actually returned
 * by the Tavily search — never an LLM-fabricated URL (CLAUDE.md core
 * rule 5 anti-fabrication check).
 */
export function AgentSection({ report }: { report: AgentReport }) {
  const style = VERDICT_STYLES[report.verdict];
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)]/60 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--foreground)]">
          {AGENT_ROLE_LABEL[report.agent_role]}
        </span>
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.pill}`}
        >
          {style.label}
        </span>
        <span className="text-[11px] font-medium text-[var(--foreground-muted)]">
          {formatConfidence(report.confidence)} confidence
        </span>
      </div>
      <p className="whitespace-pre-wrap text-[12.5px] leading-snug text-[var(--foreground)]">
        {report.reasoning}
      </p>
      <div className="mt-1 flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">
          Sources
        </span>
        {report.sources.length === 0 ? (
          <span className="text-[11px] text-[var(--foreground-muted)] italic">
            No sources
          </span>
        ) : (
          <ul className="flex flex-col gap-1">
            {report.sources.map((src, i) => (
              <li key={`${src.url}-${i}`} className="flex flex-col">
                <a
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={src.title}
                  className="text-[12px] font-medium text-[var(--accent)] underline decoration-dotted underline-offset-2 hover:opacity-80"
                >
                  {src.domain || src.url}
                </a>
                {src.title && (
                  <span className="line-clamp-2 text-[11px] text-[var(--foreground-muted)]">
                    {src.title}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
