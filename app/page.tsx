"use client";

import { useEffect, useRef, useState } from "react";
import type {
  AgentReport,
  AgentRole,
  AuditRequestBody,
  ChatMessage,
  ChatModel,
  ChatRequestBody,
  ChatResponseBody,
  ClaimAudit,
  DehallucinateRequestBody,
  DehallucinateResponseBody,
  MessageAudit,
  Provider,
  Verdict,
} from "@/types";

/**
 * Chat UI inspired by claude.ai's minimal aesthetic.
 * Frontend-only theme toggle (light/dark) persists to localStorage.
 */

const PROVIDER_MODELS: Record<Provider, ChatModel[]> = {
  openai: ["gpt-4o", "gpt-4o-mini"],
  gemini: ["gemini-1.5-pro", "gemini-1.5-flash"],
};

const PROVIDER_LABEL: Record<Provider, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
};

type Theme = "light" | "dark";

function makeUserMessage(content: string): ChatMessage {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role: "user",
    content,
    timestamp: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Verdict presentation
//
// Color coding for the audit panel (PROJECT_PLAN.md task 3.4). Each verdict
// gets:
//   - a left border stripe (the eye-catching color)
//   - a tinted background (muted; legible in both themes)
//   - a label color used inside the verdict pill
//   - a short human label
// We deliberately use Tailwind palette utilities rather than the brand CSS
// variables, because the brand accent is already orange and would collide
// with the "contradicted" verdict.
// ─────────────────────────────────────────────────────────────────────────────

interface VerdictStyle {
  label: string;
  border: string;
  bg: string;
  pill: string;
}

const VERDICT_STYLES: Record<Verdict, VerdictStyle> = {
  verified: {
    label: "Verified",
    border: "border-l-emerald-500",
    bg: "bg-emerald-50/70 dark:bg-emerald-950/30",
    pill: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
  },
  unverified_plausible: {
    label: "Unverified, plausible",
    border: "border-l-amber-500",
    bg: "bg-amber-50/70 dark:bg-amber-950/30",
    pill: "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200",
  },
  contradicted: {
    label: "Contradicted",
    border: "border-l-orange-500",
    bg: "bg-orange-50/70 dark:bg-orange-950/30",
    pill: "bg-orange-100 text-orange-900 dark:bg-orange-900/50 dark:text-orange-200",
  },
  likely_hallucination: {
    label: "Likely hallucination",
    border: "border-l-rose-500",
    bg: "bg-rose-50/70 dark:bg-rose-950/30",
    pill: "bg-rose-100 text-rose-900 dark:bg-rose-900/50 dark:text-rose-200",
  },
};

function formatConfidence(c: number): string {
  // 0..1 → "0.0%" .. "100.0%", capped to one decimal place.
  const pct = Math.max(0, Math.min(1, c)) * 100;
  return `${pct.toFixed(1)}%`;
}

/**
 * Number of failed claims (contradicted + likely_hallucination) in an audit.
 *
 * Drives the visibility of the "Regenerate without hallucinations" button
 * (PROJECT_PLAN.md task 4.4). We deliberately re-derive this in the client
 * instead of importing from `lib/dehallucinate.ts` — that lib pulls in the
 * OpenAI SDK and would be wrong to bundle into a client component.
 */
function failedClaimCount(audit: MessageAudit): number {
  return audit.summary.contradicted + audit.summary.likely_hallucination;
}

// Display labels for the four summary-bar categories (PROJECT_PLAN.md task
// 3.7). Order matches the spec example "verified · unverified · …" — we
// iterate this array so a row always appears in the same position regardless
// of which counts happen to be non-zero in a given audit.
const SUMMARY_CATEGORIES: {
  verdict: Verdict;
  field: keyof MessageAudit["summary"];
  singular: string;
  plural: string;
}[] = [
  { verdict: "verified", field: "verified", singular: "verified", plural: "verified" },
  { verdict: "unverified_plausible", field: "unverified_plausible", singular: "unverified", plural: "unverified" },
  { verdict: "contradicted", field: "contradicted", singular: "contradicted", plural: "contradicted" },
  { verdict: "likely_hallucination", field: "likely_hallucination", singular: "likely hallucination", plural: "likely hallucinations" },
];

const AGENT_ROLE_LABEL: Record<AgentRole, string> = {
  prosecutor: "Prosecutor",
  defender: "Defender",
  literalist: "Literalist",
};

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

// ─────────────────────────────────────────────────────────────────────────────
// Audit panel components (PROJECT_PLAN.md tasks 3.3–3.7)
//
// Layered rendering:
//   AuditPanel   – per-message container; resolves the loading/error/data
//                  state and owns the local "expanded claim ids" set (3.6).
//   SummaryBar   – one-line count of verdict categories above the rows (3.7).
//   ClaimRow     – one card per claim. Header is a button that toggles
//                  expansion; details panel renders below when open (3.6).
//   AgentSection – per-agent breakdown inside an expanded row (3.6).
//
// Expansion state is intentionally local to AuditPanel: it does not persist
// across audit refetches or live in the App-level state map. If a future
// re-audit replaces the MessageAudit with new claim ids, stale ids in the set
// simply stop matching anything and become inert.
// ─────────────────────────────────────────────────────────────────────────────

function AuditSkeleton() {
  return (
    <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px] text-[var(--foreground-muted)]">
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--foreground-muted)] [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--foreground-muted)] [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--foreground-muted)]" />
      </span>
      <span>Auditing claims…</span>
    </div>
  );
}

function AuditError({ message }: { message: string }) {
  return (
    <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px] text-[var(--foreground-muted)]">
      <span aria-hidden="true">⚠</span>
      <span>
        Audit unavailable
        <span className="ml-1 text-[var(--foreground-muted)] opacity-70">
          ({message})
        </span>
      </span>
    </div>
  );
}

function AuditEmpty() {
  return (
    <div className="mt-3 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px] text-[var(--foreground-muted)]">
      No verifiable claims found in this response.
    </div>
  );
}

function SummaryBar({ summary }: { summary: MessageAudit["summary"] }) {
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

function AgentSection({ report }: { report: AgentReport }) {
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

interface ClaimRowProps {
  ca: ClaimAudit;
  isExpanded: boolean;
  onToggle: () => void;
}

function ClaimRow({ ca, isExpanded, onToggle }: ClaimRowProps) {
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

interface AuditPanelProps {
  messageId: string;
  isPending: boolean;
  audit: MessageAudit | undefined;
  errorMessage: string | undefined;
  // Dehallucinate plumbing (PROJECT_PLAN.md tasks 4.4–4.5). Optional so this
  // component stays usable without a regenerate flow wired up.
  onDehallucinate?: () => void;
  isDehallucPending?: boolean;
  dehallucError?: string;
}

function AuditPanel({
  isPending,
  audit,
  errorMessage,
  onDehallucinate,
  isDehallucPending,
  dehallucError,
}: AuditPanelProps) {
  // Local expansion state — see header comment block above. A Set keyed by
  // claim id lets multiple rows be open simultaneously (per spec test 3).
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  function toggleExpanded(claimId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(claimId)) next.delete(claimId);
      else next.add(claimId);
      return next;
    });
  }

  // Render priority: pending → error → audit (which may be empty).
  // We prefer "still loading" over "failed" so a stale error from a prior
  // attempt never appears alongside a fresh in-flight audit.
  if (isPending) return <AuditSkeleton />;
  if (errorMessage) return <AuditError message={errorMessage} />;
  if (!audit) return null;
  if (audit.claims.length === 0) return <AuditEmpty />;

  // The "Regenerate without hallucinations" button is intentionally hidden
  // when there's nothing to dehallucinate. Showing it on a fully-verified
  // message would be a no-op and would dilute the signal that something is
  // actually wrong.
  const failed = failedClaimCount(audit);
  const showRegenerate = failed > 0 && Boolean(onDehallucinate);

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SummaryBar summary={audit.summary} />
        {showRegenerate && (
          <DehallucinateButton
            onClick={onDehallucinate!}
            pending={Boolean(isDehallucPending)}
            failedCount={failed}
          />
        )}
      </div>
      {dehallucError && (
        <div className="rounded-md border border-rose-300/60 bg-rose-50 px-2 py-1 text-[11px] text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
          Couldn&apos;t build a regeneration prompt: {dehallucError}
        </div>
      )}
      {audit.claims.map((ca) => (
        <ClaimRow
          key={ca.claim.id}
          ca={ca}
          isExpanded={expanded.has(ca.claim.id)}
          onToggle={() => toggleExpanded(ca.claim.id)}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dehallucinate button + modal (PROJECT_PLAN.md tasks 4.4–4.5)
//
// The button is a message-level action, not a claim-level action — it lives
// next to the SummaryBar inside AuditPanel, never inside a ClaimRow.
// Clicking it kicks off a POST to /api/dehallucinate. The modal opens only
// after that response lands; while the request is in flight the button shows
// its own loading state so the user gets instant feedback.
// ─────────────────────────────────────────────────────────────────────────────

interface DehallucinateButtonProps {
  onClick: () => void;
  pending: boolean;
  failedCount: number;
}

function DehallucinateButton({
  onClick,
  pending,
  failedCount,
}: DehallucinateButtonProps) {
  const label = pending
    ? "Building prompt…"
    : `Regenerate without hallucinations (${failedCount})`;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title="Build a grounded prompt that quotes the failed claims and inlines the audit evidence"
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)]/50 bg-[var(--accent)]/10 px-2.5 py-1 text-[11px] font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)]/15 disabled:cursor-wait disabled:opacity-60"
    >
      {pending && (
        <span aria-hidden="true" className="flex items-center gap-0.5">
          <span className="h-1 w-1 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:-0.3s]" />
          <span className="h-1 w-1 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:-0.15s]" />
          <span className="h-1 w-1 animate-bounce rounded-full bg-[var(--accent)]" />
        </span>
      )}
      <span>{label}</span>
    </button>
  );
}

interface DehallucinateModalProps {
  open: boolean;
  suggestedPrompt: string | null;
  editedPrompt: string;
  onEdit: (next: string) => void;
  onCancel: () => void;
  onSend: () => void;
}

function DehallucinateModal({
  open,
  suggestedPrompt,
  editedPrompt,
  onEdit,
  onCancel,
  onSend,
}: DehallucinateModalProps) {
  // Body-scroll lock + Escape-to-close are mounted in a single effect so
  // they stay symmetric: both attach when the modal opens, both detach on
  // unmount or close. Using `document.body.style.overflow` directly is the
  // pragmatic choice — no library, easy to reason about — but we restore
  // the *previous* value rather than hardcoding "" so we don't clobber any
  // page-level overflow setting.
  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    }
    window.addEventListener("keydown", handleKey);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", handleKey);
    };
  }, [open, onCancel]);

  if (!open || suggestedPrompt === null) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dehalluc-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6 backdrop-blur-sm"
      onClick={onCancel}
    >
      {/* Stop propagation on the inner card so click-on-backdrop closes but
          click-inside-card never does. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col">
            <h2
              id="dehalluc-modal-title"
              className="text-base font-semibold text-[var(--foreground)]"
            >
              Review the regeneration prompt
            </h2>
            <p className="mt-1 text-[12px] text-[var(--foreground-muted)]">
              The auditor built this prompt from the failed claims and their
              gathered evidence. Edit anything you like — your final version
              will be sent as your next chat message.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-md p-1 text-[var(--foreground-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>

        <textarea
          value={editedPrompt}
          onChange={(e) => onEdit(e.target.value)}
          className="min-h-[280px] flex-1 resize-y rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-[12.5px] leading-relaxed text-[var(--foreground)] shadow-inner focus:border-[var(--accent)]/60 focus:outline-none"
          spellCheck={false}
        />

        <p className="text-[11px] text-[var(--foreground-muted)]">
          On <span className="font-semibold">Send</span>, this exact text
          (with your edits) will be sent as your next message and the new
          response will be re-audited. On{" "}
          <span className="font-semibold">Cancel</span> nothing happens —
          your conversation stays as it is.
        </p>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12px] font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-muted)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSend}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[12px] font-semibold text-[var(--accent-foreground)] transition hover:opacity-90"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function SunIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SparkIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2l1.8 5.5L19 9.3l-5.2 1.8L12 16l-1.8-5L5 9.3l5.2-1.8L12 2z" />
      <path d="M19 14l.9 2.6L22 17.5l-2.1.9L19 21l-.9-2.6L16 17.5l2.1-.9L19 14z" />
    </svg>
  );
}

function SendIcon({ className = "" }: { className?: string }) {
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
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  );
}

export default function Home() {
  const [theme, setTheme] = useState<Theme>("light");
  const [provider, setProvider] = useState<Provider>("openai");
  const [model, setModel] = useState<ChatModel>("gpt-4o");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Audit state per ARCHITECTURE.md §7.
  // Three mutually-exclusive states per assistant message id:
  //   - id ∈ pendingAudits  → fetch in flight
  //   - id ∈ audits         → audit complete (claims may be empty)
  //   - id ∈ auditErrors    → fetch failed; show "audit unavailable"
  // We track them as separate maps rather than a tagged union so that React's
  // shallow comparison can update each independently without re-creating the
  // whole audit panel state on every transition.
  const [audits, setAudits] = useState<Record<string, MessageAudit>>({});
  const [pendingAudits, setPendingAudits] = useState<Set<string>>(
    () => new Set(),
  );
  const [auditErrors, setAuditErrors] = useState<Record<string, string>>({});

  // Dehallucinate state per ARCHITECTURE.md §7. The modal is a single
  // top-level slot — only one regenerate review can be open at a time
  // (matches the spec shape and keeps focus management simple).
  // `dehallucPending` and `dehallucErrors` are message-id-keyed so the
  // button on each audited message can show its own loading/error state
  // independently of any other in-flight dehallucinate request.
  const [dehallucinateModal, setDehallucinateModal] = useState<{
    open: boolean;
    messageId: string | null;
    suggestedPrompt: string | null;
    editedPrompt: string;
  }>({
    open: false,
    messageId: null,
    suggestedPrompt: null,
    editedPrompt: "",
  });
  const [dehallucPending, setDehallucPending] = useState<Set<string>>(
    () => new Set(),
  );
  const [dehallucErrors, setDehallucErrors] = useState<Record<string, string>>(
    {},
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Sync theme state with what the no-flash script set on <html>
  useEffect(() => {
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "dark" : "light");
  }, []);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.style.colorScheme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* ignore storage errors */
    }
  }

  function changeProvider(next: Provider) {
    setProvider(next);
    setModel(PROVIDER_MODELS[next][0]);
  }

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 240)}px`;
  }, [input]);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  // Fire-and-forget audit kickoff. Returns void on purpose: sendMessage must
  // not await this. The audit may take 10-30s and the user must be free to
  // send another chat turn while the previous one is still being audited.
  function requestAudit(messageId: string, content: string) {
    setPendingAudits((prev) => {
      const next = new Set(prev);
      next.add(messageId);
      return next;
    });
    // Clear any prior error/success so a re-audit (future feature) starts clean.
    setAuditErrors((prev) => {
      if (!(messageId in prev)) return prev;
      const next = { ...prev };
      delete next[messageId];
      return next;
    });

    const body: AuditRequestBody = { message_id: messageId, content };

    fetch("/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(errBody.error ?? `Audit request failed: ${res.status}`);
        }
        return (await res.json()) as MessageAudit;
      })
      .then((audit) => {
        setAudits((prev) => ({ ...prev, [messageId]: audit }));
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Audit unavailable";
        console.error("[audit] failed for", messageId, err);
        setAuditErrors((prev) => ({ ...prev, [messageId]: msg }));
      })
      .finally(() => {
        setPendingAudits((prev) => {
          if (!prev.has(messageId)) return prev;
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
      });
  }

  /**
   * Find the user message that produced the given assistant message — i.e.
   * the most recent user turn at or before the assistant message's index.
   * The dehallucinator needs this to preserve the user's original intent
   * in the rewrite.
   */
  function findOriginalUserMessage(assistantId: string): ChatMessage | null {
    const idx = messages.findIndex((m) => m.id === assistantId);
    if (idx < 0) return null;
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === "user") return messages[i];
    }
    return null;
  }

  /**
   * Kick off a dehallucinate request for an audited assistant message.
   * On success, opens the review modal pre-filled with the suggested prompt.
   * On failure, surfaces the error inline next to the button instead of
   * blocking the chat (mirrors the audit-error UX).
   */
  function requestDehallucinate(messageId: string) {
    const assistantMsg = messages.find((m) => m.id === messageId);
    const audit = audits[messageId];
    const originalUser = findOriginalUserMessage(messageId);

    if (!assistantMsg || !audit || !originalUser) {
      setDehallucErrors((prev) => ({
        ...prev,
        [messageId]: "Missing message, audit, or original user prompt.",
      }));
      return;
    }

    setDehallucPending((prev) => {
      const next = new Set(prev);
      next.add(messageId);
      return next;
    });
    setDehallucErrors((prev) => {
      if (!(messageId in prev)) return prev;
      const next = { ...prev };
      delete next[messageId];
      return next;
    });

    const body: DehallucinateRequestBody = {
      originalUserMessage: originalUser.content,
      flawedResponse: assistantMsg.content,
      audit,
    };

    fetch("/api/dehallucinate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            errBody.error ?? `Dehallucinate request failed: ${res.status}`,
          );
        }
        return (await res.json()) as DehallucinateResponseBody;
      })
      .then(({ suggested_prompt }) => {
        setDehallucinateModal({
          open: true,
          messageId,
          suggestedPrompt: suggested_prompt,
          editedPrompt: suggested_prompt,
        });
      })
      .catch((err: unknown) => {
        const msg =
          err instanceof Error ? err.message : "Dehallucinate failed";
        console.error("[dehallucinate] failed for", messageId, err);
        setDehallucErrors((prev) => ({ ...prev, [messageId]: msg }));
      })
      .finally(() => {
        setDehallucPending((prev) => {
          if (!prev.has(messageId)) return prev;
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
      });
  }

  function closeDehallucModal() {
    setDehallucinateModal({
      open: false,
      messageId: null,
      suggestedPrompt: null,
      editedPrompt: "",
    });
  }

  // Placeholder Send handler (PROJECT_PLAN.md task 4.5). Real /api/chat
  // re-issue + re-audit is wired in task 4.6 — for now we only confirm
  // the edited text round-tripped correctly.
  function sendDehallucPrompt() {
    console.log(
      "[dehallucinate] Send pressed (placeholder). Edited prompt:\n",
      dehallucinateModal.editedPrompt,
    );
    closeDehallucModal();
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    const userMsg = makeUserMessage(trimmed);
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setPending(true);
    setError(null);

    try {
      const body: ChatRequestBody = {
        messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        provider,
        model,
      };
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `Request failed: ${res.status}`);
      }
      const data = (await res.json()) as ChatResponseBody;
      setMessages((prev) => [...prev, data.message]);
      // Kick off the audit but DO NOT await it — chat must stay unblocked.
      requestAudit(data.message.id, data.message.content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
    } finally {
      setPending(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void sendMessage(input);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  }

  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-screen w-full flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-[var(--border)] bg-background/80 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--accent)] text-[var(--accent-foreground)]">
            <SparkIcon className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight">
              Hallucination Audit Trail
            </span>
            <span className="text-[11px] text-[var(--foreground-muted)]">
              Multi-agent verifier
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-1 py-1 text-xs sm:flex">
            <select
              value={provider}
              onChange={(e) => changeProvider(e.target.value as Provider)}
              className="cursor-pointer rounded-full bg-transparent px-2 py-1 text-xs text-[var(--foreground)] outline-none hover:bg-[var(--surface-muted)]"
              aria-label="Provider"
            >
              {(Object.keys(PROVIDER_MODELS) as Provider[]).map((p) => (
                <option key={p} value={p} className="bg-[var(--surface)]">
                  {PROVIDER_LABEL[p]}
                </option>
              ))}
            </select>
            <span className="text-[var(--foreground-muted)]">/</span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value as ChatModel)}
              className="cursor-pointer rounded-full bg-transparent px-2 py-1 text-xs text-[var(--foreground)] outline-none hover:bg-[var(--surface-muted)]"
              aria-label="Model"
            >
              {PROVIDER_MODELS[provider].map((m) => (
                <option key={m} value={m} className="bg-[var(--surface)]">
                  {m}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
          >
            {theme === "dark" ? (
              <SunIcon className="h-4 w-4" />
            ) : (
              <MoonIcon className="h-4 w-4" />
            )}
          </button>
        </div>
      </header>

      {/* Mobile provider/model row */}
      <div className="flex items-center justify-center gap-1 border-b border-[var(--border)] bg-background px-4 py-2 sm:hidden">
        <select
          value={provider}
          onChange={(e) => changeProvider(e.target.value as Provider)}
          className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs"
          aria-label="Provider"
        >
          {(Object.keys(PROVIDER_MODELS) as Provider[]).map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABEL[p]}
            </option>
          ))}
        </select>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value as ChatModel)}
          className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs"
          aria-label="Model"
        >
          {PROVIDER_MODELS[provider].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {/* Conversation / welcome */}
      <main
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
      >
        {!hasMessages ? (
          <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-6 text-center">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm">
              <SparkIcon className="h-6 w-6" />
            </div>
            <h2 className="mb-2 text-3xl font-serif tracking-tight text-[var(--foreground)] sm:text-4xl">
              How can I help you today?
            </h2>
            <p className="mb-8 max-w-md text-sm text-[var(--foreground-muted)]">
              Ask anything. Every assistant reply is fact-checked by three
              independent verifier agents.
            </p>

            <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                "Summarize the findings of Johnson et al. 2021 on intermittent fasting",
                "Who won the 2023 Nobel Prize in Physics, and for what?",
                "What is the population of Lisbon as of 2024?",
                "Explain the Riemann hypothesis in plain English",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => sendMessage(suggestion)}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left text-sm text-[var(--foreground)] transition hover:border-[var(--accent)]/40 hover:bg-[var(--surface-muted)]"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl bg-[var(--user-bubble)] px-4 py-3 text-[15px] leading-relaxed text-[var(--foreground)]">
                    <div className="whitespace-pre-wrap break-words">
                      {m.content}
                    </div>
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--accent)] text-[var(--accent-foreground)]">
                    <SparkIcon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    {m.provider && (
                      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
                        {m.provider} · {m.model}
                      </div>
                    )}
                    <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-[var(--foreground)]">
                      {m.content}
                    </div>
                    <AuditPanel
                      messageId={m.id}
                      isPending={pendingAudits.has(m.id)}
                      audit={audits[m.id]}
                      errorMessage={auditErrors[m.id]}
                      onDehallucinate={() => requestDehallucinate(m.id)}
                      isDehallucPending={dehallucPending.has(m.id)}
                      dehallucError={dehallucErrors[m.id]}
                    />
                  </div>
                </div>
              )
            )}

            {pending && (
              <div className="flex gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--accent)] text-[var(--accent-foreground)]">
                  <SparkIcon className="h-3.5 w-3.5" />
                </div>
                <div className="flex items-center gap-1.5 pt-2">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--foreground-muted)] [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--foreground-muted)] [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--foreground-muted)]" />
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-300/60 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Composer */}
      <div className="border-t border-[var(--border)] bg-background px-4 pb-4 pt-3 sm:px-6">
        <form
          onSubmit={handleSubmit}
          className="mx-auto w-full max-w-3xl"
        >
          <div className="group relative flex items-end gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 shadow-sm transition focus-within:border-[var(--accent)]/50 focus-within:shadow-md">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Reply to Hallucination Audit…"
              rows={1}
              disabled={pending}
              className="max-h-60 flex-1 resize-none bg-transparent px-1 py-2 text-[15px] leading-6 text-[var(--foreground)] placeholder:text-[var(--foreground-muted)] focus:outline-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={pending || !input.trim()}
              aria-label="Send message"
              className="mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-foreground)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <SendIcon className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-[var(--foreground-muted)]">
            Responses are audited by three independent verifier agents. Press{" "}
            <kbd className="rounded border border-[var(--border)] bg-[var(--surface)] px-1 font-mono text-[10px]">
              Enter
            </kbd>{" "}
            to send,{" "}
            <kbd className="rounded border border-[var(--border)] bg-[var(--surface)] px-1 font-mono text-[10px]">
              Shift+Enter
            </kbd>{" "}
            for newline.
          </p>
        </form>
      </div>

      <DehallucinateModal
        open={dehallucinateModal.open}
        suggestedPrompt={dehallucinateModal.suggestedPrompt}
        editedPrompt={dehallucinateModal.editedPrompt}
        onEdit={(next) =>
          setDehallucinateModal((prev) => ({ ...prev, editedPrompt: next }))
        }
        onCancel={closeDehallucModal}
        onSend={sendDehallucPrompt}
      />
    </div>
  );
}
