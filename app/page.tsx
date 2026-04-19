"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type {
  AuditRequestBody,
  ChatMessage,
  ChatModel,
  ChatRequestBody,
  ChatResponseBody,
  DehallucinateRequestBody,
  DehallucinateResponseBody,
  MessageAudit,
  Provider,
} from "@/types";
import { ClaimList } from "@/components/audit/ClaimList";
import { SummaryBar } from "@/components/audit/SummaryBar";
import { failedClaimCount } from "@/components/audit/verdict";

/**
 * Chat UI inspired by claude.ai's minimal aesthetic.
 * Frontend-only theme toggle (light/dark) persists to localStorage.
 */

/**
 * Providers wired into the chat switcher.
 *
 * All three entries in the `Provider` union are runtime-supported as of
 * IMPROVEMENTS.md Phase B (B.1–B.4 added the Anthropic SDK adapter, the
 * chat-route case, and finally this UI option). The earlier `Provider`
 * narrowing alias was removed once Anthropic landed — the maps below are now
 * exhaustive against the public `Provider` union, so the compiler will fail
 * loudly if a future provider is added to `types.ts` without a switcher entry.
 *
 * Single-model providers (Gemini, Anthropic) collapse the model `<select>`
 * to a static label downstream — no purposeless one-item dropdown.
 */
const PROVIDER_MODELS: Record<Provider, ChatModel[]> = {
  openai: ["gpt-4o", "gpt-4o-mini"],
  gemini: ["gemini-2.5-flash"],
  anthropic: ["claude-haiku-4-5"],
};

const PROVIDER_LABEL: Record<Provider, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  anthropic: "Anthropic",
};

// ─────────────────────────────────────────────────────────────────────────────
// Demo prompts (PROJECT_PLAN.md task 5.1)
//
// Three canonical prompts that exercise the three "interesting" audit
// outcomes. These are surfaced as compact chips above the composer; clicking
// a chip pastes the prompt into the input but does NOT auto-send, so the
// presenter can pause on the talking point before pressing Enter.
//
// Prompts are chosen empirically from earlier shot-2/shot-3 testing:
//   - Citation hallucination: Johnson et al. 2021 — gpt-4o reliably
//     fabricates the study + author list, surfaces as
//     `likely_hallucination` with low evidence.
//   - Contested claim:        Tesla milestones — gpt-4o gets some details
//     right and some wrong, producing per-claim `agents_disagreed` flags
//     across all three subagents (cleaner than Great Wall length, which
//     tends to either fully verify or fully contradict).
//   - Benign truth:           Eiffel Tower height — single numerical
//     claim, verifies cleanly with no Regenerate button.
// ─────────────────────────────────────────────────────────────────────────────
interface DemoPrompt {
  label: string;
  prompt: string;
}
const DEMO_PROMPTS: DemoPrompt[] = [
  {
    label: "Citation hallucination",
    prompt:
      "Summarize the findings of Johnson et al. 2021 on intermittent fasting.",
  },
  {
    label: "Contested claim",
    prompt:
      "Tell me three specific, dated milestones in the history of Tesla, Inc., including the names of the people involved and the cities where the events took place.",
  },
  {
    label: "Benign truth",
    prompt: "How tall is the Eiffel Tower in metres, including its antenna?",
  },
];

/**
 * Short, locale-aware HH:MM for the message-meta line; the full timestamp
 * goes into the `title` attribute as a hover tooltip so power-users can
 * still see exact ms without the chat surface getting cluttered.
 */
function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function makeUserMessage(content: string): ChatMessage {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role: "user",
    content,
    timestamp: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Verdict presentation tokens (VERDICT_STYLES, formatConfidence, etc.) and
// the SummaryBar / ClaimRow / AgentSection / ClaimList components were
// factored out into `components/audit/` at IMPROVEMENTS.md Phase A task
// A.7-prep so the chat AuditPanel below and the new `/document` report
// view render the same audit affordances. Imports at the top of this file.
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Before/after diff (PROJECT_PLAN.md task 4.7)
//
// Rendered above the regenerated assistant message body, only when that
// message has a `regenerates_message_id` link. Reuses the SummaryBar so the
// pills, colors, and spacing match exactly — the diff is just two summaries
// side by side with an arrow between them. Each side independently handles
// its own pending / errored / empty / populated state, because the "after"
// audit will almost always still be in flight when the diff first mounts.
// ─────────────────────────────────────────────────────────────────────────────

interface SideAuditState {
  audit: MessageAudit | undefined;
  pending: boolean;
  error: string | undefined;
}

function BeforeAfterSide({
  label,
  state,
}: {
  label: string;
  state: SideAuditState;
}) {
  let body: React.ReactNode;
  if (state.pending) {
    body = (
      <span className="italic text-[var(--foreground-muted)]">auditing…</span>
    );
  } else if (state.error) {
    body = (
      <span className="italic text-[var(--foreground-muted)]">
        audit unavailable
      </span>
    );
  } else if (!state.audit) {
    body = (
      <span className="italic text-[var(--foreground-muted)]">
        no audit yet
      </span>
    );
  } else if (state.audit.summary.total_claims === 0) {
    body = (
      <span className="italic text-[var(--foreground-muted)]">
        no verifiable claims
      </span>
    );
  } else {
    body = (
      <>
        <span className="text-[10px] text-[var(--foreground-muted)]">
          {state.audit.summary.total_claims} total
        </span>
        <SummaryBar summary={state.audit.summary} />
      </>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px]">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">
        {label}:
      </span>
      {body}
    </div>
  );
}

interface BeforeAfterDiffProps {
  before: SideAuditState;
  after: SideAuditState;
}

function BeforeAfterDiff({ before, after }: BeforeAfterDiffProps) {
  return (
    <div className="mb-3 flex flex-col gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">
        Regeneration audit
      </span>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <BeforeAfterSide label="Before" state={before} />
        <span
          className="text-[var(--foreground-muted)]"
          aria-hidden="true"
        >
          →
        </span>
        <BeforeAfterSide label="After" state={after} />
      </div>
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
      {/* Expansion state lives inside ClaimList — multiple rows can be open
          at once. Re-mounting AuditPanel (e.g. on a fresh audit) resets the
          set, so stale claim ids never leak across audits. */}
      <ClaimList claims={audit.claims} />
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

function CopyIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon({ className = "" }: { className?: string }) {
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
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ArrowDownIcon({ className = "" }: { className?: string }) {
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
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MarkdownLite
//
// Some chat models (notably gpt-4o on the "Tesla milestones" demo prompt)
// emit markdown — `**bold**`, `### headings`, `- ` bullets — while others
// return plain prose. Rendering raw text with `whitespace-pre-wrap` leaks the
// asterisks/hashes into the UI. This is a deliberately small renderer (no
// dependency) that handles the few constructs the chat models actually use:
//   inline:  **bold**, *italic* / _italic_, `code`
//   block:   ATX headings (#..######), unordered (-, *, •) and ordered lists,
//            paragraphs separated by blank lines
// Anything else falls through as text. We do NOT render raw HTML, so this
// is safe to feed arbitrary model output.
// ─────────────────────────────────────────────────────────────────────────────
function renderInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Order matters: code first (so backticked content is opaque to other
  // rules), then bold (greedy on `**`), then italic. The lookarounds keep
  // single-`*` italic from eating one star of a `**bold**` pair.
  const re =
    /(`+)([^`]+?)\1|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|(?<!\*)\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)|(?<!_)_(?!\s)([^_\n]+?)(?<!\s)_(?!_)/g;
  let lastIndex = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) out.push(text.slice(lastIndex, m.index));
    if (m[2] !== undefined) {
      out.push(
        <code
          key={key++}
          className="rounded bg-[var(--surface-muted)] px-1 py-0.5 font-mono text-[0.9em]"
        >
          {m[2]}
        </code>
      );
    } else if (m[3] !== undefined || m[4] !== undefined) {
      out.push(
        <strong key={key++} className="font-semibold">
          {m[3] ?? m[4]}
        </strong>
      );
    } else if (m[5] !== undefined || m[6] !== undefined) {
      out.push(<em key={key++}>{m[5] ?? m[6]}</em>);
    }
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out;
}

function MarkdownLite({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  const listRe = /^\s*([-*•]|\d+\.)\s+(.*)$/;
  const headingRe = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }

    const heading = headingRe.exec(line);
    if (heading) {
      const level = heading[1].length;
      const cls =
        level <= 2
          ? "mt-4 mb-2 text-base font-semibold first:mt-0"
          : level === 3
            ? "mt-3 mb-1.5 text-[15px] font-semibold first:mt-0"
            : "mt-2 mb-1 text-sm font-semibold first:mt-0";
      blocks.push(
        <div key={key++} className={cls}>
          {renderInline(heading[2])}
        </div>
      );
      i++;
      continue;
    }

    if (listRe.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && listRe.test(lines[i])) {
        const lm = listRe.exec(lines[i])!;
        items.push(lm[2]);
        i++;
      }
      const liNodes = items.map((it, idx) => (
        <li key={idx}>{renderInline(it)}</li>
      ));
      blocks.push(
        ordered ? (
          <ol
            key={key++}
            className="my-2 ml-5 list-decimal space-y-1 first:mt-0 last:mb-0"
          >
            {liNodes}
          </ol>
        ) : (
          <ul
            key={key++}
            className="my-2 ml-5 list-disc space-y-1 first:mt-0 last:mb-0"
          >
            {liNodes}
          </ul>
        )
      );
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !headingRe.test(lines[i]) &&
      !listRe.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(
      <p
        key={key++}
        className="my-2 whitespace-pre-wrap break-words first:mt-0 last:mb-0"
      >
        {renderInline(paraLines.join("\n"))}
      </p>
    );
  }

  return <>{blocks}</>;
}

export default function Home() {
  // Theme is owned by `next-themes` (see components/ThemeProvider.tsx) so the
  // <html class="dark"> bootstrapping happens without an inline <script>,
  // which is what tripped Next 16 / React 19's renderer warning. We track a
  // local `themeMounted` flag to suppress the toggle's icon during SSR — the
  // server can't know the user's OS preference, and rendering a sun/moon
  // before hydration would either flash the wrong icon or warn about a
  // mismatch.
  const { resolvedTheme, setTheme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);
  useEffect(() => {
    setThemeMounted(true);
  }, []);
  const isDark = themeMounted && resolvedTheme === "dark";

  const [provider, setProvider] = useState<Provider>("openai");
  const [model, setModel] = useState<ChatModel>("gpt-4o");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

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
  const stickyBottomRef = useRef(true);

  function toggleTheme() {
    setTheme(isDark ? "light" : "dark");
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

  // Track whether user is near the bottom; used to avoid yanking scroll.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const nearBottom = distance < 140;
      stickyBottomRef.current = nearBottom;
      setIsAtBottom(nearBottom);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  function scrollToBottom(behavior: ScrollBehavior = "smooth") {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }

  // Auto-scroll only when user is already near the bottom.
  useEffect(() => {
    if (stickyBottomRef.current) {
      scrollToBottom("smooth");
    }
  }, [messages, pending]);

  // Global keyboard shortcuts:
  //   Cmd/Ctrl+K  → focus the composer from anywhere
  //   Esc         → if composer is focused, clear input and blur
  // We intentionally scope Esc to only fire when the textarea has focus so
  // it doesn't fight with native dialog/menu close behavior elsewhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        textareaRef.current?.focus();
        return;
      }
      if (e.key === "Escape") {
        const ta = textareaRef.current;
        if (ta && document.activeElement === ta) {
          if (ta.value.length > 0) {
            e.preventDefault();
            setInput("");
          } else {
            ta.blur();
          }
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function copyAssistantMessage(id: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(id);
      window.setTimeout(() => {
        setCopiedMessageId((curr) => (curr === id ? null : curr));
      }, 1600);
    } catch {
      setError("Clipboard unavailable in this browser context.");
    }
  }

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

  /**
   * Closes the dehallucinate modal and immediately re-issues the edited
   * prompt as a normal chat turn (PROJECT_PLAN.md task 4.6).
   *
   * Two design choices worth flagging:
   *   1. We close the modal *before* the network round-trip so the user
   *      gets instant feedback. The chat-level pending spinner takes over
   *      from there.
   *   2. We do NOT introduce a special /api/regenerate endpoint. The
   *      regenerated turn is just a normal user → assistant turn with one
   *      extra piece of metadata (`regenerates_message_id`) so the
   *      before/after diff can find the original. Both `sendMessage` and
   *      this handler funnel through `sendUserMessage`.
   */
  function sendDehallucPrompt() {
    const text = dehallucinateModal.editedPrompt;
    const targetId = dehallucinateModal.messageId;
    closeDehallucModal();
    if (!text.trim() || !targetId) return;
    void sendUserMessage(text, { regeneratesMessageId: targetId });
  }

  /**
   * Core chat-turn pipeline shared by the composer and the dehallucinate
   * modal. Appends a user message → calls /api/chat → appends the
   * assistant reply → fires /api/audit (non-blocking).
   *
   * `opts.regeneratesMessageId`, when set, is stamped on BOTH the new user
   * message and the assistant reply so either side can render the
   * before/after diff via the same pointer (task 4.7).
   */
  async function sendUserMessage(
    text: string,
    opts?: { regeneratesMessageId?: string },
  ) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    const userMsg: ChatMessage = {
      ...makeUserMessage(trimmed),
      regenerates_message_id: opts?.regeneratesMessageId,
    };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setPending(true);
    setError(null);

    try {
      const body: ChatRequestBody = {
        messages: nextMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        provider,
        model,
      };
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errBody.error ?? `Request failed: ${res.status}`);
      }
      const data = (await res.json()) as ChatResponseBody;
      const assistantMsg: ChatMessage = {
        ...data.message,
        regenerates_message_id: opts?.regeneratesMessageId,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      // Kick off the audit but DO NOT await it — chat must stay unblocked.
      requestAudit(assistantMsg.id, assistantMsg.content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
    } finally {
      setPending(false);
    }
  }

  async function sendMessage(text: string) {
    setInput("");
    await sendUserMessage(text);
  }

  /**
   * Demo-chip handler (PROJECT_PLAN.md task 5.1). Pastes the prompt into
   * the composer and focuses the textarea so the presenter can review or
   * edit before pressing Enter — explicitly does NOT auto-send.
   */
  function loadDemoPrompt(prompt: string) {
    setInput(prompt);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
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
  const shouldReduceMotion = useReducedMotion();
  const messageEnter = shouldReduceMotion
    ? { opacity: 1, y: 0 }
    : { opacity: 1, y: 0 };
  const messageInitial = shouldReduceMotion
    ? { opacity: 1, y: 0 }
    : { opacity: 0, y: 16 };

  return (
    <div className="flex h-screen w-full flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-[var(--border)] bg-background/85 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--accent)] text-[var(--accent-foreground)]">
            <SparkIcon className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-serif text-[20px] tracking-tight">
              <span className="italic">Groundtruth</span>
            </span>
            <span className="font-[family-name:var(--font-instrument)] text-[12px] tracking-[0.08em] uppercase text-[var(--foreground-muted)]">
              Multi-agent verifier
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/*
            Cross-link to the dedicated /document audit view (IMPROVEMENTS.md
            Phase A task A.10). Sits next to the provider switcher so it's
            findable but visually subordinate to the chat composer — the
            chat is still the primary surface; document audit is a
            separate workflow a user opts into deliberately.
          */}
          <Link
            href="/document"
            className="hidden items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-1.5 font-serif text-[18px] italic text-[var(--foreground-muted)] transition hover:border-[var(--accent)]/40 hover:text-[var(--foreground)] sm:inline-flex"
            aria-label="Audit a document"
            title="Open the document audit view"
          >
            Audit a document
          </Link>
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
            {PROVIDER_MODELS[provider].length > 1 ? (
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
            ) : (
              <span
                className="rounded-full px-2 py-1 text-xs text-[var(--foreground-muted)]"
                aria-label="Model"
              >
                {PROVIDER_MODELS[provider][0]}
              </span>
            )}
          </div>

          <motion.button
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
            title={`Switch to ${isDark ? "light" : "dark"} mode`}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
            whileHover={shouldReduceMotion ? undefined : { scale: 1.04 }}
            whileTap={shouldReduceMotion ? undefined : { scale: 0.96 }}
          >
            {/*
              Hold the icon back until next-themes hydrates so we don't render
              the wrong glyph (or trigger a hydration warning) for users on
              the non-default OS preference. The wrapper keeps the button
              size stable so layout doesn't jitter on mount.
            */}
            <span className="flex h-4 w-4 items-center justify-center">
              {themeMounted ? (
                isDark ? (
                  <SunIcon className="h-4 w-4" />
                ) : (
                  <MoonIcon className="h-4 w-4" />
                )
              ) : null}
            </span>
          </motion.button>
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
        {PROVIDER_MODELS[provider].length > 1 ? (
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
        ) : (
          <span
            className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs text-[var(--foreground-muted)]"
            aria-label="Model"
          >
            {PROVIDER_MODELS[provider][0]}
          </span>
        )}
      </div>

      {/* Conversation / welcome */}
      <main
        ref={scrollRef}
        className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(201,100,66,0.06),transparent_42%)] dark:bg-[radial-gradient(circle_at_top,rgba(217,119,87,0.07),transparent_45%)]"
      >
        <AnimatePresence mode="wait" initial={false}>
          {!hasMessages ? (
            <motion.div
              key="welcome"
              initial={shouldReduceMotion ? undefined : { opacity: 0, y: 18 }}
              animate={messageEnter}
              exit={shouldReduceMotion ? undefined : { opacity: 0, y: -14 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
              className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-6 text-center"
            >
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm">
                <SparkIcon className="h-6 w-6" />
              </div>
              <h2 className="mb-3 font-serif text-4xl tracking-tight text-[var(--foreground)] sm:text-5xl">
                How can I <span className="italic">help</span> you today?
              </h2>
              <p className="mb-8 max-w-md text-[16px] leading-relaxed text-[var(--foreground-muted)]">
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
                  <motion.button
                    key={suggestion}
                    type="button"
                    onClick={() => sendMessage(suggestion)}
                    className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left text-sm text-[var(--foreground)] shadow-[0_1px_0_rgba(0,0,0,0.03)] transition hover:border-[var(--accent)]/40 hover:bg-[var(--surface-muted)]"
                    whileHover={shouldReduceMotion ? undefined : { y: -1.5 }}
                    whileTap={shouldReduceMotion ? undefined : { scale: 0.995 }}
                  >
                    {suggestion}
                  </motion.button>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="thread"
              initial={shouldReduceMotion ? undefined : { opacity: 0, y: 12 }}
              animate={messageEnter}
              exit={shouldReduceMotion ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6"
            >
            {messages.map((m) =>
              m.role === "user" ? (
                <motion.div
                  key={m.id}
                  initial={messageInitial}
                  animate={messageEnter}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="flex justify-end"
                >
                  <div
                    className="group max-w-[85%] rounded-2xl bg-[var(--user-bubble)] px-4 py-3 text-[15px] leading-relaxed text-[var(--foreground)]"
                    title={new Date(m.timestamp).toLocaleString()}
                  >
                    <div className="whitespace-pre-wrap break-words">
                      {m.content}
                    </div>
                    <div className="mt-1 text-right text-[10px] text-[var(--foreground-muted)] opacity-0 transition-opacity group-hover:opacity-100">
                      {formatTime(m.timestamp)}
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key={m.id}
                  initial={messageInitial}
                  animate={messageEnter}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                  className="flex gap-3"
                >
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--accent)] text-[var(--accent-foreground)]">
                    <SparkIcon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      {m.provider ? (
                        <div
                          className="text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]"
                          title={new Date(m.timestamp).toLocaleString()}
                        >
                          {m.provider} · {m.model}
                          <span className="ml-1.5 normal-case opacity-70">
                            · {formatTime(m.timestamp)}
                          </span>
                        </div>
                      ) : (
                        <span />
                      )}
                      <motion.button
                        type="button"
                        onClick={() => copyAssistantMessage(m.id, m.content)}
                        className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--foreground-muted)] transition hover:border-[var(--accent)]/35 hover:text-[var(--foreground)]"
                        whileHover={shouldReduceMotion ? undefined : { y: -1 }}
                        whileTap={shouldReduceMotion ? undefined : { scale: 0.97 }}
                        aria-label="Copy assistant response"
                        title="Copy response"
                      >
                        {copiedMessageId === m.id ? (
                          <>
                            <CheckIcon className="h-3.5 w-3.5" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <CopyIcon className="h-3.5 w-3.5" />
                            <span>Copy</span>
                          </>
                        )}
                      </motion.button>
                    </div>
                    {m.regenerates_message_id && (
                      <BeforeAfterDiff
                        before={{
                          audit: audits[m.regenerates_message_id],
                          pending: pendingAudits.has(m.regenerates_message_id),
                          error: auditErrors[m.regenerates_message_id],
                        }}
                        after={{
                          audit: audits[m.id],
                          pending: pendingAudits.has(m.id),
                          error: auditErrors[m.id],
                        }}
                      />
                    )}
                    <div className="text-[15px] leading-relaxed text-[var(--foreground)]">
                      <MarkdownLite text={m.content} />
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
                </motion.div>
              )
            )}

            <AnimatePresence>
              {pending && (
                <motion.div
                  initial={messageInitial}
                  animate={messageEnter}
                  exit={shouldReduceMotion ? undefined : { opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="flex gap-3"
                >
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--accent)] text-[var(--accent-foreground)]">
                  <SparkIcon className="h-3.5 w-3.5" />
                </div>
                <div className="flex items-center gap-1.5 pt-2">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--foreground-muted)] [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--foreground-muted)] [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--foreground-muted)]" />
                </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={shouldReduceMotion ? undefined : { opacity: 0, y: 8 }}
                  animate={messageEnter}
                  exit={shouldReduceMotion ? undefined : { opacity: 0, y: -8 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="rounded-xl border border-red-300/60 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Composer */}
      <div className="border-t border-[var(--border)] bg-background/90 px-4 pb-4 pt-3 backdrop-blur sm:px-6">
        <form
          onSubmit={handleSubmit}
          className="mx-auto w-full max-w-3xl"
        >
          {/*
            Demo-prompt chips (PROJECT_PLAN.md task 5.1).
            Paste into the input but DO NOT auto-send — the user presses
            Send themselves so the demo flow looks natural and they have
            a beat to set up the talking point. Visually secondary by
            design: small, muted, sits above the composer, never the
            dominant element.
          */}
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">
              Demo:
            </span>
            {DEMO_PROMPTS.map((demo) => (
              <motion.button
                key={demo.label}
                type="button"
                onClick={() => loadDemoPrompt(demo.prompt)}
                disabled={pending}
                title={demo.prompt}
                className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--foreground-muted)] transition hover:border-[var(--accent)]/40 hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                whileHover={shouldReduceMotion ? undefined : { y: -1 }}
                whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
              >
                {demo.label}
              </motion.button>
            ))}
          </div>
          <div className="group relative flex items-end gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 shadow-[0_1px_0_rgba(0,0,0,0.04)] transition focus-within:border-[var(--accent)]/50 focus-within:shadow-lg">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                hasMessages
                  ? "Reply to Groundtruth…"
                  : "Ask anything — ⌘/Ctrl+K to jump here anytime"
              }
              rows={1}
              disabled={pending}
              aria-label="Message composer"
              className="max-h-60 flex-1 resize-none bg-transparent px-1 py-2 text-[15px] leading-[1.6] text-[var(--foreground)] placeholder:text-[var(--foreground-muted)] focus:outline-none disabled:opacity-60"
            />
            <motion.button
              type="submit"
              disabled={pending || !input.trim()}
              aria-label="Send message"
              className="mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-foreground)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              whileHover={shouldReduceMotion ? undefined : { scale: 1.04 }}
              whileTap={shouldReduceMotion ? undefined : { scale: 0.96 }}
            >
              <SendIcon className="h-4 w-4" />
            </motion.button>
          </div>
          <p className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-[11px] text-[var(--foreground-muted)]">
            <span>Audited by three verifier agents.</span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-[var(--border)] bg-[var(--surface)] px-1 font-mono text-[10px]">
                Enter
              </kbd>
              send
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-[var(--border)] bg-[var(--surface)] px-1 font-mono text-[10px]">
                Shift+Enter
              </kbd>
              newline
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-[var(--border)] bg-[var(--surface)] px-1 font-mono text-[10px]">
                ⌘/Ctrl+K
              </kbd>
              focus
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-[var(--border)] bg-[var(--surface)] px-1 font-mono text-[10px]">
                Esc
              </kbd>
              clear
            </span>
          </p>
        </form>
      </div>

      <AnimatePresence>
        {!isAtBottom && hasMessages && (
          <motion.button
            type="button"
            initial={shouldReduceMotion ? undefined : { opacity: 0, y: 18 }}
            animate={shouldReduceMotion ? undefined : { opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, y: 18 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={() => {
              stickyBottomRef.current = true;
              setIsAtBottom(true);
              scrollToBottom("smooth");
            }}
            className="fixed bottom-28 right-4 z-30 inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--foreground)] shadow-lg sm:right-6"
            aria-label="Jump to latest message"
          >
            <ArrowDownIcon className="h-3.5 w-3.5" />
            <span>Latest</span>
          </motion.button>
        )}
      </AnimatePresence>

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
