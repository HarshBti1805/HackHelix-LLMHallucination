import Link from "next/link";

/**
 * Editorial header for the /document route.
 *
 * Distinct from the chat header in two ways:
 *   1. Visually heavier — Instrument Serif italic display title with a
 *      decorative section number ("01 / Document Audit") so the page
 *      reads like a magazine spread rather than a tool surface.
 *   2. Carries the auditor-config strip (model, parallelism, claim cap)
 *      inline. The chat header hides that detail; the document workflow
 *      is laptop-targeted and benefits from the explicit guarantees so
 *      the report doesn't feel opaque.
 */
export function DocumentHero() {
  return (
    <header style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-base)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 48, gap: 12 }}>
        <Link
          href="/"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontFamily: "var(--font-geist-mono, monospace)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", textDecoration: "none" }}
        >
          ← Back to Groundtruth
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontFamily: "var(--font-geist-mono, monospace)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)" }}>
          <span>OpenAI · gpt-4o-mini</span>
          <span style={{ opacity: 0.4 }}>◆</span>
          <span>3 subagents / claim</span>
          <span style={{ opacity: 0.4 }}>◆</span>
          <span>cap 25</span>
        </div>
      </div>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px 36px", display: "flex", flexDirection: "column", gap: 12 }}>
        <span style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: 10, letterSpacing: "0.28em", textTransform: "uppercase", color: "var(--accent)" }}>
          01 — Document Audit
        </span>
        <h1 style={{ fontFamily: "var(--font-space-grotesk, sans-serif)", fontWeight: 600, fontSize: "clamp(32px, 5vw, 56px)", lineHeight: 1.05, letterSpacing: "-0.02em", color: "var(--text-primary)", margin: 0 }}>
          Find the <em style={{ fontStyle: "italic", fontWeight: 500 }}>truth</em> hiding inside any text you trust.
        </h1>
        <p style={{ maxWidth: 640, fontSize: 15, lineHeight: 1.65, color: "var(--text-secondary)", margin: 0 }}>
          Drop in a document and three independent verifier agents will comb every factual claim against live evidence — surfacing citations that look real, but aren't.
        </p>
      </div>
    </header>
  );
}
