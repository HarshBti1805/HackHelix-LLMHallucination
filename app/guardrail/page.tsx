"use client";

import { useState } from "react";
import Link from "next/link";
import type {
  GroundedClaim,
  GroundednessAudit,
  GroundingVerdict,
  GuardrailRequestBody,
} from "@/types";

const VERDICT_STYLE: Record<GroundingVerdict, { label: string; color: string }> = {
  grounded:    { label: "Grounded",        color: "var(--v-verified)"    },
  ungrounded:  { label: "Not in source",   color: "var(--v-unverified)"  },
  contradicted:{ label: "Contradicted",    color: "var(--v-contradicted)"},
};

export default function GuardrailPage() {
  const [context, setContext] = useState("");
  const [answer,  setAnswer]  = useState("");
  const [audit,   setAudit]   = useState<GroundednessAudit | null>(null);
  const [pending, setPending] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  async function runCheck() {
    if (!context.trim() || !answer.trim()) {
      setError("Paste both the source context and the answer to check.");
      return;
    }
    setPending(true); setError(null); setAudit(null);
    try {
      const body: GuardrailRequestBody = { answer, context };
      const res = await fetch("/api/guardrail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `guardrail responded ${res.status}`);
      }
      setAudit((await res.json()) as GroundednessAudit);
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
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontFamily: "var(--font-geist-mono, monospace)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            <span>OpenAI · gpt-4o-mini</span>
            <span style={{ opacity: 0.4 }}>◆</span>
            <span>No web search</span>
          </div>
        </div>

        {/* ── editorial hero ── */}
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px 36px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 4, padding: "3px 12px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--bg-card)", alignSelf: "flex-start" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", display: "inline-block" }} />
            <span style={{ fontSize: 11, fontFamily: "var(--font-geist-mono, monospace)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)" }}>
              RAG Guardrail · Context-only grading
            </span>
          </div>
          <h1 style={{ fontFamily: "var(--font-space-grotesk, sans-serif)", fontWeight: 600, fontSize: "clamp(28px, 4vw, 48px)", lineHeight: 1.05, letterSpacing: "-0.02em", color: "var(--text-primary)", margin: 0 }}>
            Is your answer <em style={{ fontStyle: "italic", fontWeight: 500 }}>faithful</em> to its sources?
          </h1>
          <p style={{ maxWidth: 640, fontSize: 15, lineHeight: 1.65, color: "var(--text-secondary)", margin: 0 }}>
            Paste the trusted source your model was grounded in, and the answer it produced. Every claim is graded for faithfulness — catching anything added beyond the source, before it reaches a user.
          </p>
        </div>
      </header>

      {/* ── main ── */}
      <main style={{ maxWidth: 1100, margin: "0 auto", width: "100%", flex: 1, padding: "36px 24px 80px", display: "flex", flexDirection: "column", gap: 28 }}>

        {/* two-panel inputs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <PanelTextarea
            icon="doc"
            title="Context document"
            sub="source of truth"
            value={context}
            onChange={setContext}
            placeholder="Paste the knowledge-base article or retrieved passages the model was given…"
          />
          <PanelTextarea
            icon="user"
            title="AI answer to check"
            sub="generated output"
            value={answer}
            onChange={setAnswer}
            placeholder="Paste the chatbot / RAG answer to verify…"
          />
        </div>

        {/* action row */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button
            type="button"
            onClick={runCheck}
            disabled={pending}
            style={{ display: "inline-flex", alignItems: "center", gap: 9, height: 42, padding: "0 22px", borderRadius: 11, border: "none", background: pending ? "var(--bg-inset)" : "var(--accent)", color: pending ? "var(--text-faint)" : "#fff", cursor: pending ? "not-allowed" : "pointer", fontSize: 13.5, fontWeight: 600 }}
          >
            {pending && (
              <svg width="15" height="15" viewBox="0 0 15 15" style={{ animation: "gt-spin 1s linear infinite" }}>
                <circle cx="7.5" cy="7.5" r="5.5" stroke="rgba(255,255,255,.3)" strokeWidth="1.8" fill="none"/>
                <path d="M7.5 2 A5.5 5.5 0 0 1 13 7.5" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
              </svg>
            )}
            {pending ? "Checking groundedness…" : "Check groundedness"}
          </button>
          {error && (
            <span style={{ fontSize: 13, color: "var(--v-hallucination)", display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 1.5 1.5 12.5H12.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M7 5.5V8.5M7 10.3V10.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              {error}
            </span>
          )}
        </div>

        {audit && <GuardrailReport audit={audit} />}
      </main>
    </div>
  );
}

/* ── Panel textarea with labelled header ── */
function PanelTextarea({ icon, title, sub, value, onChange, placeholder }: {
  icon: "doc" | "user"; title: string; sub: string; value: string;
  onChange: (v: string) => void; placeholder: string;
}) {
  const isDoc = icon === "doc";
  const accentColor = isDoc ? "var(--accent-bright)" : "var(--v-crosscheck)";
  const accentDim   = isDoc ? "color-mix(in srgb, var(--accent) 16%, transparent)" : "color-mix(in srgb, var(--v-crosscheck) 16%, transparent)";

  return (
    <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-card)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg-inset)" }}>
        <span style={{ display: "grid", placeItems: "center", width: 22, height: 22, borderRadius: 6, background: accentDim, color: accentColor, flexShrink: 0 }}>
          {isDoc ? (
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <path d="M3 2H8.5L11 4.5V12H3Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              <path d="M8.3 2V4.6H11" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="4.5" r="2.3" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M2.5 12C2.5 9.2 4.5 8 7 8c2.5 0 4.5 1.2 4.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          )}
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)" }}>{title}</span>
        <span style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: 9.5, color: "var(--text-faint)", marginLeft: "auto" }}>{sub}</span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={10}
        style={{ flex: 1, minHeight: 200, resize: "vertical", border: "none", outline: "none", background: "transparent", color: "var(--text-primary)", fontFamily: "var(--font-geist-mono, monospace)", fontSize: 12.5, lineHeight: 1.65, padding: 14 }}
      />
    </div>
  );
}

/* ── Results ── */
function GuardrailReport({ audit }: { audit: GroundednessAudit }) {
  const { summary } = audit;
  if (summary.total_claims === 0) {
    return (
      <div style={{ borderRadius: 13, border: "1px dashed var(--border-strong)", background: "var(--bg-card)", padding: 40, textAlign: "center" }}>
        <p style={{ fontSize: 18, fontStyle: "italic", color: "var(--text-muted)" }}>No verifiable claims found.</p>
        <p style={{ marginTop: 8, fontSize: 13, color: "var(--text-faint)" }}>The answer didn't contain atomic factual claims to ground-check.</p>
      </div>
    );
  }

  const faithfulPct = Math.round((summary.grounded / summary.total_claims) * 100);
  const scoreColor = faithfulPct >= 80 ? "var(--v-verified)" : faithfulPct >= 50 ? "var(--v-unverified)" : "var(--v-hallucination)";

  const chips = [
    { label: "Grounded",      count: summary.grounded,    color: "var(--v-verified)"    },
    { label: "Not in source", count: summary.ungrounded,  color: "var(--v-unverified)"  },
    { label: "Contradicted",  count: summary.contradicted,color: "var(--v-contradicted)"},
  ].filter(c => c.count > 0);

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 13, background: "var(--bg-raised)", overflow: "hidden", boxShadow: "0 1px 0 rgba(255,255,255,0.03) inset, 0 10px 34px rgba(0,0,0,0.5)" }}>
      {/* summary bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "13px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg-inset)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          {chips.map(ch => (
            <span key={ch.label} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 25, padding: "0 10px", borderRadius: 999, background: `color-mix(in srgb, ${ch.color} 16%, transparent)`, fontSize: 11.5, color: "var(--text-primary)", whiteSpace: "nowrap" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: ch.color, display: "inline-block" }} />
              <b style={{ fontWeight: 600 }}>{ch.count}</b> {ch.label}
            </span>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Groundedness</span>
          <span style={{ fontFamily: "var(--font-space-grotesk, sans-serif)", fontSize: 18, fontWeight: 600, color: scoreColor }}>{faithfulPct}%</span>
        </div>
      </div>

      {/* claim rows */}
      <div style={{ padding: 9, display: "flex", flexDirection: "column", gap: 8 }}>
        {audit.claims.map((c, i) => <GroundedClaimCard key={c.claim.id || i} c={c} />)}
      </div>
    </div>
  );
}

function GroundedClaimCard({ c }: { c: GroundedClaim }) {
  const vs = VERDICT_STYLE[c.verdict];
  return (
    <div style={{ border: "1px solid var(--border)", borderLeft: `3px solid ${vs.color}`, borderRadius: 10, background: "var(--bg-card)", padding: "13px 14px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: vs.color, boxShadow: `0 0 8px ${vs.color}`, flexShrink: 0, marginTop: 4, display: "inline-block" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", color: vs.color }}>{vs.label}</span>
            <span style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: 10, color: "var(--text-faint)" }}>conf {Math.round(c.confidence * 100)}%</span>
          </div>
          <p style={{ fontSize: 13.5, lineHeight: 1.45, color: "var(--text-primary)", margin: "0 0 7px" }}>{c.claim.text}</p>
          <div style={{ display: "flex", gap: 8, padding: "9px 11px", borderRadius: 8, background: "var(--bg-inset)", border: "1px solid var(--border-faint)" }}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: 1, color: "var(--text-muted)" }}>
              <path d="M7 1.5V12.5M2.5 4H11.5M3.5 4 2.5 11H4.5ZM10.5 4 9.5 11H11.5Z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round"/>
            </svg>
            <span style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--text-secondary)" }}>{c.rationale}</span>
          </div>
          {c.supporting_quote && (
            <blockquote style={{ marginTop: 8, borderLeft: "2px solid var(--border)", paddingLeft: 10, fontSize: 11.5, fontStyle: "italic", lineHeight: 1.5, color: "var(--text-muted)" }}>
              &ldquo;{c.supporting_quote}&rdquo;
            </blockquote>
          )}
        </div>
        <div style={{ flexShrink: 0, width: 50, textAlign: "right" }}>
          <div style={{ height: 5, borderRadius: 3, background: "var(--bg-elev)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.round(c.confidence * 100)}%`, background: vs.color }} />
          </div>
        </div>
      </div>
    </div>
  );
}
