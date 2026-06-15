import type { AuditSummary } from "@/types";
import { auditHeadline } from "./verdict";

/**
 * One-line TL;DR shown at the top of an audit (MAJOR_CHANGES.md #1).
 *
 * Inline-styled (not Tailwind) so the same component drops cleanly into both
 * the chat audit panel — which uses the inline-style design system — and the
 * Tailwind-based /document and /verify report views. All colors come from the
 * global `--v-*` / `--text-*` CSS vars, so it tracks the active theme.
 */
export function AuditHeadlineBar({ summary }: { summary: AuditSummary }) {
  const { text, color } = auditHeadline(summary);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "11px 16px",
        borderBottom: "1px solid var(--border)",
        background: `color-mix(in srgb, ${color} 7%, transparent)`,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 7,
          height: 7,
          flexShrink: 0,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 7px ${color}`,
        }}
      />
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          lineHeight: 1.35,
          color: "var(--text-primary)",
          letterSpacing: "0.005em",
        }}
      >
        <span
          style={{
            fontFamily: "'Geist Mono', monospace",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
            marginRight: 8,
          }}
        >
          TL;DR
        </span>
        {text}
      </span>
    </div>
  );
}
