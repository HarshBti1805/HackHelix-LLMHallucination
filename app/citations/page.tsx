"use client";

import { useState } from "react";
import Link from "next/link";
import type {
  CheckCitationsRequestBody,
  CitationCandidate,
  CitationCheck,
  CitationReport,
  CitationStatus,
} from "@/types";

const STATUS_STYLE: Record<CitationStatus, { label: string; color: string }> = {
  verified:  { label: "Found",               color: "var(--v-verified)"    },
  uncertain: { label: "Uncertain",            color: "var(--v-unverified)"  },
  not_found: { label: "Not found — fabricated",color: "var(--v-hallucination)"},
};

const SAMPLE = `Recent work has explored the metabolic effects of intermittent fasting. Johnson et al. (2021) found significant improvements in insulin sensitivity. See also Patterson & Sears (2017), "Metabolic Effects of Intermittent Fasting", Annual Review of Nutrition.`;

export default function CitationsPage() {
  const [text,    setText]   = useState("");
  const [report,  setReport] = useState<CitationReport | null>(null);
  const [pending, setPending] = useState(false);
  const [error,   setError]  = useState<string | null>(null);

  async function run() {
    if (!text.trim()) { setError("Paste a draft or bibliography to check."); return; }
    setPending(true); setError(null); setReport(null);
    try {
      const body: CheckCitationsRequestBody = { text };
      const res = await fetch("/api/check-citations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `responded ${res.status}`);
      }
      setReport((await res.json()) as CitationReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)", color: "var(--text-primary)", display: "flex", flexDirection: "column" }}>

      {/* ── slim nav bar ── */}
      <header style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-base)" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 48, gap: 12 }}>
          <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontFamily: "var(--font-geist-mono, monospace)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", textDecoration: "none" }}>
            ← Back to Groundtruth
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, background: "var(--bg-card)", border: "1px solid var(--border)", fontFamily: "var(--font-geist-mono, monospace)", fontSize: 10.5, color: "var(--text-secondary)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", display: "inline-block" }} />
              Crossref
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, background: "var(--bg-card)", border: "1px solid var(--border)", fontFamily: "var(--font-geist-mono, monospace)", fontSize: 10.5, color: "var(--text-secondary)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--v-crosscheck, #2dd4bf)", display: "inline-block" }} />
              Semantic Scholar
            </span>
          </div>
        </div>

        {/* ── editorial hero ── */}
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px 36px", display: "flex", flexDirection: "column", gap: 12 }}>
          <span style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: 10, letterSpacing: "0.28em", textTransform: "uppercase", color: "var(--accent)" }}>
            Reference Linter
          </span>
          <h1 style={{ fontFamily: "var(--font-space-grotesk, sans-serif)", fontWeight: 600, fontSize: "clamp(28px, 4vw, 48px)", lineHeight: 1.05, letterSpacing: "-0.02em", color: "var(--text-primary)", margin: 0 }}>
            Do these references <em style={{ fontStyle: "italic", fontWeight: 500 }}>actually exist?</em>
          </h1>
          <p style={{ maxWidth: 640, fontSize: 15, lineHeight: 1.65, color: "var(--text-secondary)", margin: 0 }}>
            Paste a draft with citations or a bibliography. Every reference is cross-checked against Crossref and Semantic Scholar — fabricated papers, wrong authors, and invented years are flagged.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 25, padding: "0 11px", borderRadius: 999, background: `color-mix(in srgb, var(--v-verified) 14%, transparent)`, fontSize: 11.5, color: "var(--text-primary)" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--v-verified)", display: "inline-block" }} />
              Verified citation
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 25, padding: "0 11px", borderRadius: 999, background: `color-mix(in srgb, var(--v-unverified) 14%, transparent)`, fontSize: 11.5, color: "var(--text-primary)" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--v-unverified)", display: "inline-block" }} />
              Uncertain — needs review
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 25, padding: "0 11px", borderRadius: 999, background: `color-mix(in srgb, var(--v-hallucination) 14%, transparent)`, fontSize: 11.5, color: "var(--text-primary)" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--v-hallucination)", display: "inline-block" }} />
              Not found — likely fabricated
            </span>
          </div>
        </div>
      </header>

      {/* ── main ── */}
      <main style={{ maxWidth: 1100, margin: "0 auto", width: "100%", flex: 1, padding: "36px 24px 80px", display: "flex", flexDirection: "column", gap: 24 }}>

        {/* textarea card */}
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-card)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg-inset)" }}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ color: "var(--text-muted)" }}>
              <path d="M3 2H8.5L11 4.5V12H3Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              <path d="M8.3 2V4.6H11" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)" }}>Text containing citations or a bibliography</span>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={() => setText(SAMPLE)}
              style={{ fontSize: 11, fontFamily: "var(--font-geist-mono, monospace)", letterSpacing: "0.06em", color: "var(--accent-bright)", background: "none", border: "none", cursor: "pointer" }}
            >
              Load sample
            </button>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste a paper draft, an essay, or a bibliography…"
            rows={8}
            style={{ width: "100%", minHeight: 160, resize: "vertical", border: "none", outline: "none", background: "transparent", color: "var(--text-primary)", fontFamily: "var(--font-geist-mono, monospace)", fontSize: 12.5, lineHeight: 1.65, padding: 14 }}
          />
        </div>

        {/* action row */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={run}
            disabled={pending}
            style={{ display: "inline-flex", alignItems: "center", gap: 9, height: 42, padding: "0 22px", borderRadius: 11, border: "none", background: pending ? "var(--bg-inset)" : "var(--accent)", color: pending ? "var(--text-faint)" : "#fff", cursor: pending ? "not-allowed" : "pointer", fontSize: 13.5, fontWeight: 600 }}
          >
            {pending ? (
              <svg width="15" height="15" viewBox="0 0 15 15" style={{ animation: "gt-spin 1s linear infinite" }}>
                <circle cx="7.5" cy="7.5" r="5.5" stroke="rgba(255,255,255,.3)" strokeWidth="1.8" fill="none"/>
                <path d="M7.5 2 A5.5 5.5 0 0 1 13 7.5" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.6"/>
                <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
            )}
            {pending ? "Checking references…" : "Check citations"}
          </button>

          {report && !pending && (
            <div style={{ display: "flex", alignItems: "center", gap: 14, fontFamily: "var(--font-geist-mono, monospace)", fontSize: 11.5 }}>
              <span style={{ color: "var(--v-verified)" }}>{report.summary.verified} found</span>
              <span style={{ color: "var(--v-unverified)" }}>{report.summary.uncertain} uncertain</span>
              <span style={{ color: "var(--v-hallucination)" }}>{report.summary.not_found} not found</span>
            </div>
          )}

          {error && (
            <span style={{ fontSize: 13, color: "var(--v-hallucination)", display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 1.5 1.5 12.5H12.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M7 5.5V8.5M7 10.3V10.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              {error}
            </span>
          )}
        </div>

        {report && <CitationReportView report={report} />}
      </main>
    </div>
  );
}

function CitationReportView({ report }: { report: CitationReport }) {
  if (report.summary.total === 0) {
    return (
      <div style={{ borderRadius: 13, border: "1px dashed var(--border-strong)", background: "var(--bg-card)", padding: 40, textAlign: "center" }}>
        <p style={{ fontSize: 18, fontStyle: "italic", color: "var(--text-muted)" }}>No scholarly references found.</p>
        <p style={{ marginTop: 8, fontSize: 13, color: "var(--text-faint)" }}>The text didn't contain citations the checker could recognise.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      {report.claims.map((c, i) => <CitationCard key={c.claim.id || i} c={c} />)}
    </div>
  );
}

function CitationCard({ c }: { c: CitationCheck }) {
  const [open, setOpen] = useState(false);
  const vs = STATUS_STYLE[c.status];
  const stripe = `4px solid ${vs.color}`;

  return (
    <div style={{ display: "flex", gap: 14, border: "1px solid var(--border)", borderLeft: stripe, borderRadius: 11, background: "var(--bg-card)", padding: "15px 16px" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* badge row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 23, padding: "0 10px", borderRadius: 999, background: `color-mix(in srgb, ${vs.color} 14%, transparent)`, fontFamily: "var(--font-geist-mono, monospace)", fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", color: vs.color }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: vs.color, display: "inline-block" }} />
            {vs.label}
          </span>
          <span style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: 9.5, color: "var(--text-faint)" }}>
            {Math.round(c.confidence * 100)}% confidence
          </span>
        </div>

        {/* raw citation text */}
        <div style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: 13, color: "var(--text-primary)", marginBottom: 10 }}>
          {c.cited_reference}
        </div>

        {/* best match */}
        {c.best_match && (
          <div style={{ display: "flex", gap: 12, padding: "11px 13px", borderRadius: 9, background: "var(--bg-inset)", border: "1px solid var(--border-faint)", marginBottom: 8 }}>
            <span style={{ display: "grid", placeItems: "center", width: 30, height: 38, borderRadius: 5, background: `color-mix(in srgb, ${vs.color} 14%, transparent)`, color: vs.color, flexShrink: 0 }}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <path d="M3 2.5H11L13 4.5V13.5H3Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
                <path d="M5 6H10M5 8.2H10M5 10.4H8" stroke="currentColor" strokeWidth="1"/>
              </svg>
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.35, marginBottom: 3 }}>
                {c.best_match.url
                  ? <a href={c.best_match.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "none" }}>{c.best_match.title}</a>
                  : c.best_match.title}
              </div>
              {c.best_match.authors && (
                <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 2 }}>{c.best_match.authors}</div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontFamily: "var(--font-geist-mono, monospace)", fontSize: 10.5, color: "var(--text-muted)" }}>
                {c.best_match.venue && <span>{c.best_match.venue}</span>}
                {c.best_match.year  && <><span style={{ color: "var(--text-faint)" }}>·</span><span>{c.best_match.year}</span></>}
                <span style={{ color: "var(--text-faint)" }}>·</span>
                <span style={{ color: "var(--text-faint)", fontSize: 10, textTransform: "uppercase" }}>{c.best_match.source}</span>
              </div>
            </div>
          </div>
        )}

        {/* not-found / uncertain callout */}
        {c.status === "not_found" && (
          <div style={{ display: "flex", gap: 9, padding: "10px 13px", borderRadius: 9, background: `color-mix(in srgb, var(--v-hallucination) 9%, transparent)`, border: `1px dashed color-mix(in srgb, var(--v-hallucination) 40%, transparent)` }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: 1, color: "var(--v-hallucination)" }}>
              <path d="M7 1.5 1.5 12.5H12.5Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
              <path d="M7 5.5V8.5M7 10.3V10.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            <span style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--text-secondary)" }}>
              No matching record in any database. This reference appears to be <b style={{ color: "var(--v-hallucination)", fontWeight: 600 }}>fabricated</b>.
            </span>
          </div>
        )}
        {c.status === "uncertain" && c.rationale && (
          <div style={{ display: "flex", gap: 9, padding: "10px 13px", borderRadius: 9, background: `color-mix(in srgb, var(--v-unverified) 9%, transparent)`, border: `1px solid color-mix(in srgb, var(--v-unverified) 28%, transparent)` }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: 1, color: "var(--v-unverified)" }}>
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M7 4V7.5M7 9.4V9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            <span style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--text-secondary)" }}>{c.rationale} — manual review recommended.</span>
          </div>
        )}

        {/* extra candidates toggle */}
        {c.candidates.length > 1 && (
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setOpen(v => !v)}
              style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: 10.5, color: "var(--accent-bright)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              {open ? "Hide" : "Show"} {c.candidates.length} candidate{c.candidates.length === 1 ? "" : "s"} from indices
            </button>
            {open && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                {c.candidates.map((cand, i) => (
                  <div key={i} style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-inset)" }}>
                    <CandidateLine cand={cand} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CandidateLine({ cand }: { cand: CitationCandidate }) {
  const meta = [cand.authors, cand.year, cand.venue].filter(Boolean).join(" · ");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-primary)" }}>
        {cand.url
          ? <a href={cand.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "none" }}>{cand.title}</a>
          : cand.title}
      </span>
      {meta && (
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {meta} <span style={{ opacity: 0.6 }}>· {cand.source}</span>
        </span>
      )}
    </div>
  );
}
