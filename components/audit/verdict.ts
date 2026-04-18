import type { AgentRole, AuditSummary, Verdict } from "@/types";

/**
 * Verdict presentation tokens shared between the chat AuditPanel and the
 * `/document` report view (IMPROVEMENTS.md Phase A task A.7).
 *
 * Originally lived inline inside `app/page.tsx`. Factored out at A.7-prep
 * so both surfaces render identical colors / labels / spacing without
 * duplicating the Tailwind class strings — any future palette change
 * happens here once, not in two files. See ARCHITECTURE.md §4 for the
 * verdict semantics; this module only maps verdicts → CSS, never decides
 * what a verdict means.
 *
 * No React imports on purpose — these are pure data so they can be
 * imported from server components (e.g. an SSR audit JSON renderer) as
 * well as the existing client components without dragging React into the
 * server bundle.
 */

export interface VerdictStyle {
  label: string;
  border: string;
  bg: string;
  pill: string;
  /**
   * Inline highlight class used by the `/document` source-text column to
   * wrap each claim's `sentence` (IMPROVEMENTS.md Phase A task A.8). The
   * style is intentionally lighter than `pill` (no uppercase, no rounded-
   * full, normal text size) so it sits cleanly inside body prose. Kept
   * here rather than inside the document page so the four verdict colors
   * stay defined in exactly one place.
   */
  highlight: string;
}

export const VERDICT_STYLES: Record<Verdict, VerdictStyle> = {
  verified: {
    label: "Verified",
    border: "border-l-emerald-500",
    bg: "bg-emerald-50/70 dark:bg-emerald-950/30",
    pill: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
    highlight:
      "bg-emerald-100 text-emerald-900 underline decoration-emerald-500/60 decoration-1 underline-offset-2 dark:bg-emerald-900/40 dark:text-emerald-100",
  },
  unverified_plausible: {
    label: "Unverified, plausible",
    border: "border-l-amber-500",
    bg: "bg-amber-50/70 dark:bg-amber-950/30",
    pill: "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200",
    highlight:
      "bg-amber-100 text-amber-900 underline decoration-amber-500/60 decoration-1 underline-offset-2 dark:bg-amber-900/40 dark:text-amber-100",
  },
  contradicted: {
    label: "Contradicted",
    border: "border-l-orange-500",
    bg: "bg-orange-50/70 dark:bg-orange-950/30",
    pill: "bg-orange-100 text-orange-900 dark:bg-orange-900/50 dark:text-orange-200",
    highlight:
      "bg-orange-100 text-orange-900 underline decoration-orange-500/70 decoration-2 underline-offset-2 dark:bg-orange-900/40 dark:text-orange-100",
  },
  likely_hallucination: {
    label: "Likely hallucination",
    border: "border-l-rose-500",
    bg: "bg-rose-50/70 dark:bg-rose-950/30",
    pill: "bg-rose-100 text-rose-900 dark:bg-rose-900/50 dark:text-rose-200",
    highlight:
      "bg-rose-100 text-rose-900 underline decoration-rose-500/70 decoration-2 underline-offset-2 dark:bg-rose-900/40 dark:text-rose-100",
  },
};

/**
 * 0..1 → "0.0%" .. "100.0%", capped at one decimal place. Defensive
 * `Math.max/min` so an out-of-range upstream confidence (e.g. an LLM that
 * returns 1.2) never renders a nonsense percentage.
 */
export function formatConfidence(c: number): string {
  const pct = Math.max(0, Math.min(1, c)) * 100;
  return `${pct.toFixed(1)}%`;
}

/**
 * Number of failed claims (contradicted + likely_hallucination) in any
 * audit-shaped object (chat `MessageAudit` or document `DocumentAudit`).
 *
 * Drives the visibility of the chat "Regenerate without hallucinations"
 * button (PROJECT_PLAN.md task 4.4) and may be used for similar UI
 * affordances on the document report. Kept as a pure summary lookup so
 * callers don't need to import the OpenAI-bundled `lib/dehallucinate.ts`
 * just to count failures.
 */
export function failedClaimCount(audit: { summary: AuditSummary }): number {
  return audit.summary.contradicted + audit.summary.likely_hallucination;
}

/**
 * Display labels for the four summary-bar categories (PROJECT_PLAN.md
 * task 3.7). Order is the spec-canonical "verified · unverified · …" so
 * a row always appears in the same position regardless of which counts
 * happen to be non-zero in a given audit.
 */
export const SUMMARY_CATEGORIES: {
  verdict: Verdict;
  field: keyof AuditSummary;
  singular: string;
  plural: string;
}[] = [
  { verdict: "verified", field: "verified", singular: "verified", plural: "verified" },
  { verdict: "unverified_plausible", field: "unverified_plausible", singular: "unverified", plural: "unverified" },
  { verdict: "contradicted", field: "contradicted", singular: "contradicted", plural: "contradicted" },
  { verdict: "likely_hallucination", field: "likely_hallucination", singular: "likely hallucination", plural: "likely hallucinations" },
];

export const AGENT_ROLE_LABEL: Record<AgentRole, string> = {
  prosecutor: "Prosecutor",
  defender: "Defender",
  literalist: "Literalist",
};
