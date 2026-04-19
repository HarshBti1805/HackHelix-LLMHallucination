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
    <header className="border-b border-[var(--border)] bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pt-7 pb-8 sm:px-6 sm:pt-10 sm:pb-10">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/"
            className="group flex items-center gap-2 text-[12px] font-[family-name:var(--font-instrument)] uppercase tracking-[0.16em] text-[var(--foreground-muted)] transition hover:text-[var(--foreground)]"
          >
            <span
              aria-hidden="true"
              className="inline-block transition-transform group-hover:-translate-x-0.5"
            >
              ←
            </span>
            <span>Back to Groundtruth</span>
          </Link>

          <div className="hidden items-center gap-3 text-[11px] font-[family-name:var(--font-dm-mono)] uppercase tracking-[0.14em] text-[var(--foreground-muted)] sm:flex">
            <span>OpenAI · gpt-4o-mini</span>
            <span aria-hidden="true" className="opacity-40">
              ◆
            </span>
            <span>3 subagents / claim</span>
            <span aria-hidden="true" className="opacity-40">
              ◆
            </span>
            <span>cap 25</span>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <span className="font-[family-name:var(--font-dm-mono)] text-[11px] uppercase tracking-[0.32em] text-[var(--accent)]">
            01 — Document Audit
          </span>
          <h1 className="font-serif text-[44px] leading-[1.02] tracking-tight text-[var(--foreground)] sm:text-[64px]">
            Find the <span className="italic">truth</span> hiding inside
            <br className="hidden sm:block" /> any text you trust.
          </h1>
          <p className="max-w-2xl text-[16px] leading-relaxed text-[var(--foreground-muted)] sm:text-[17px]">
            Drop in a document and three independent verifier agents will
            comb every factual claim against live evidence — surfacing
            citations that look real, but aren't.
          </p>
        </div>
      </div>
    </header>
  );
}
