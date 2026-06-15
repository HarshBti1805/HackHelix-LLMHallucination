import type { AgentRole, AuditSummary, Verdict } from "@/types";

export interface VerdictStyle {
  label: string;
  color: string;       // CSS var reference for the verdict color
  bgMix: string;       // color-mix background
  dotGlow: string;     // box-shadow for verdict dot
  highlight: string;   // prose highlight class (still Tailwind for /document)
  /** @deprecated use bgMix + color instead */
  pill: string;
  /** @deprecated use color instead */
  border: string;
  /** @deprecated use bgMix instead */
  bg: string;
}

export const VERDICT_STYLES: Record<Verdict, VerdictStyle> = {
  verified: {
    label: "Verified",
    color: "var(--v-verified)",
    bgMix: "color-mix(in srgb, var(--v-verified) 10%, transparent)",
    dotGlow: "0 0 7px var(--v-verified)",
    highlight: "bg-emerald-100 text-emerald-900 underline decoration-emerald-500/60 decoration-1 underline-offset-2 dark:bg-emerald-900/40 dark:text-emerald-100",
    pill: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
    border: "border-l-emerald-500",
    bg: "bg-emerald-50/70 dark:bg-emerald-950/30",
  },
  unverified_plausible: {
    label: "Unverified",
    color: "var(--v-unverified)",
    bgMix: "color-mix(in srgb, var(--v-unverified) 10%, transparent)",
    dotGlow: "0 0 7px var(--v-unverified)",
    highlight: "bg-amber-100 text-amber-900 underline decoration-amber-500/60 decoration-1 underline-offset-2 dark:bg-amber-900/40 dark:text-amber-100",
    pill: "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200",
    border: "border-l-amber-500",
    bg: "bg-amber-50/70 dark:bg-amber-950/30",
  },
  contradicted: {
    label: "Contradicted",
    color: "var(--v-contradicted)",
    bgMix: "color-mix(in srgb, var(--v-contradicted) 10%, transparent)",
    dotGlow: "0 0 7px var(--v-contradicted)",
    highlight: "bg-orange-100 text-orange-900 underline decoration-orange-500/70 decoration-2 underline-offset-2 dark:bg-orange-900/40 dark:text-orange-100",
    pill: "bg-orange-100 text-orange-900 dark:bg-orange-900/50 dark:text-orange-200",
    border: "border-l-orange-500",
    bg: "bg-orange-50/70 dark:bg-orange-950/30",
  },
  likely_hallucination: {
    label: "Hallucination",
    color: "var(--v-hallucination)",
    bgMix: "color-mix(in srgb, var(--v-hallucination) 10%, transparent)",
    dotGlow: "0 0 7px var(--v-hallucination)",
    highlight: "bg-rose-100 text-rose-900 underline decoration-rose-500/70 decoration-2 underline-offset-2 dark:bg-rose-900/40 dark:text-rose-100",
    pill: "bg-rose-100 text-rose-900 dark:bg-rose-900/50 dark:text-rose-200",
    border: "border-l-rose-500",
    bg: "bg-rose-50/70 dark:bg-rose-950/30",
  },
};

export function formatConfidence(c: number): string {
  const pct = Math.max(0, Math.min(1, c)) * 100;
  return `${pct.toFixed(1)}%`;
}

export function failedClaimCount(audit: { summary: AuditSummary }): number {
  return audit.summary.contradicted + audit.summary.likely_hallucination;
}

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

export const AGENT_ROLE_STANCE: Record<AgentRole, string> = {
  prosecutor: "Skeptical — assumes claims may be false",
  defender: "Charitable — steelmans the claim",
  literalist: "Literal — checks exact wording only",
};

export const AGENT_ROLE_COLOR: Record<AgentRole, string> = {
  prosecutor: "var(--v-contradicted)",
  defender: "var(--v-verified)",
  literalist: "var(--v-crosscheck)",
};
