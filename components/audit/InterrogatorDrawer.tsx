"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AgentRole,
  ChallengeRequestBody,
  ChallengeResponseBody,
  ChallengeStance,
  ClaimAudit,
  InterrogateAuditRequestBody,
  InterrogateAuditResponseBody,
  InterrogateRequestBody,
  InterrogateResponseBody,
  InterrogationTurn,
  MessageAudit,
  Verdict,
} from "@/types";
import { AGENT_ROLE_LABEL, VERDICT_STYLES } from "./verdict";

/**
 * "Ask the auditor" — floating window with three modes:
 *   - per-claim interrogation        → open(ca)        → POST /api/interrogate
 *   - whole-response interrogation B2 → openAudit(a)   → POST /api/interrogate-audit
 *   - challenge a claim with B1       → (in-window UI)  → POST /api/challenge
 *
 * A single, NON-MODAL, draggable + resizable window mounted once via
 * `InterrogatorProvider`. It hovers above the page without shifting layout or
 * locking interaction. Threads live in provider state keyed by target, and the
 * auditor always answers grounded in evidence already gathered — never
 * re-searching the web (CLAUDE.md rule 5). See lib/interrogate*.ts.
 */

const CLAIM_STARTERS = [
  "Why this verdict?",
  "What would change it?",
  "Strongest counter-evidence?",
  "Could this be a false positive?",
];

const AUDIT_STARTERS = [
  "Which claim is weakest?",
  "What should I double-check?",
  "Summarize the risks",
  "Where did the agents disagree?",
];

const MIN_W = 300;
const MIN_H = 320;
const DEFAULT_W = 384;
const DEFAULT_H = 480;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Target =
  | { kind: "claim"; ca: ClaimAudit }
  | { kind: "audit"; audit: MessageAudit; label: string };

function targetKey(t: Target): string {
  return t.kind === "claim" ? t.ca.claim.id : `audit:${t.audit.message_id}`;
}

interface ChallengeResult {
  stance: ChallengeStance;
  suggested_verdict: Verdict;
  quote: string;
  source_url?: string;
}

interface AuditorMeta {
  cited_agents?: AgentRole[];
  cited_source_urls?: string[];
  cited_claim_ids?: string[];
  abstained?: boolean;
  challenge?: ChallengeResult;
}

interface DisplayTurn extends InterrogationTurn {
  meta?: AuditorMeta;
}

interface InterrogatorContextValue {
  open: (ca: ClaimAudit) => void;
  openAudit: (audit: MessageAudit, label: string) => void;
}

const InterrogatorContext = createContext<InterrogatorContextValue>({
  open: () => {},
  openAudit: () => {},
});

export function useInterrogator() {
  return useContext(InterrogatorContext);
}

function clampRect(r: Rect): Rect {
  if (typeof window === "undefined") return r;
  const w = Math.max(MIN_W, Math.min(r.w, window.innerWidth - 16));
  const h = Math.max(MIN_H, Math.min(r.h, window.innerHeight - 16));
  const x = Math.max(8, Math.min(r.x, window.innerWidth - w - 8));
  const y = Math.max(8, Math.min(r.y, window.innerHeight - h - 8));
  return { x, y, w, h };
}

function defaultRect(): Rect {
  if (typeof window === "undefined") {
    return { x: 24, y: 96, w: DEFAULT_W, h: DEFAULT_H };
  }
  const h = Math.min(DEFAULT_H, window.innerHeight - 96);
  return clampRect({ x: 24, y: 88, w: DEFAULT_W, h });
}

export function InterrogatorProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<Target | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [threads, setThreads] = useState<Record<string, DisplayTurn[]>>({});
  const [rect, setRect] = useState<Rect | null>(null);

  const open = useCallback((ca: ClaimAudit) => {
    setTarget({ kind: "claim", ca });
    setMinimized(false);
    setRect((prev) => prev ?? defaultRect());
  }, []);

  const openAudit = useCallback((audit: MessageAudit, label: string) => {
    setTarget({ kind: "audit", audit, label });
    setMinimized(false);
    setRect((prev) => prev ?? defaultRect());
  }, []);

  const close = useCallback(() => setTarget(null), []);
  const toggleMinimize = useCallback(() => setMinimized((m) => !m), []);

  const setThreadFor = useCallback(
    (key: string, updater: (prev: DisplayTurn[]) => DisplayTurn[]) => {
      setThreads((prev) => ({ ...prev, [key]: updater(prev[key] ?? []) }));
    },
    [],
  );

  const value = useMemo(() => ({ open, openAudit }), [open, openAudit]);

  const key = target ? targetKey(target) : null;

  return (
    <InterrogatorContext.Provider value={value}>
      {children}
      {target && key && rect && (
        <FloatingInterrogator
          key={key}
          target={target}
          turns={threads[key] ?? []}
          setTurns={(updater) => setThreadFor(key, updater)}
          minimized={minimized}
          onToggleMinimize={toggleMinimize}
          onClose={close}
          initialRect={rect}
          onCommitRect={setRect}
        />
      )}
    </InterrogatorContext.Provider>
  );
}

interface FloatingProps {
  target: Target;
  turns: DisplayTurn[];
  setTurns: (updater: (prev: DisplayTurn[]) => DisplayTurn[]) => void;
  minimized: boolean;
  onToggleMinimize: () => void;
  onClose: () => void;
  initialRect: Rect;
  onCommitRect: (r: Rect) => void;
}

function FloatingInterrogator({
  target,
  turns,
  setTurns,
  minimized,
  onToggleMinimize,
  onClose,
  initialRect,
  onCommitRect,
}: FloatingProps) {
  const [rect, setRect] = useState<Rect>(initialRect);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Challenge composer (claim scope only).
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [challengeText, setChallengeText] = useState("");
  const [challengeUrl, setChallengeUrl] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const gesture = useRef<
    { kind: "drag" | "resize"; px: number; py: number; start: Rect } | null
  >(null);

  const isClaim = target.kind === "claim";
  const ca = isClaim ? target.ca : null;
  const style = ca ? VERDICT_STYLES[ca.consensus_verdict] : null;
  const starters = isClaim ? CLAIM_STARTERS : AUDIT_STARTERS;

  // Evidence URL → label (claim scope) for citation rendering.
  const urlLabels = useMemo(() => {
    const m = new Map<string, string>();
    if (!ca) return m;
    for (const r of ca.per_agent_reports) {
      for (const s of r.sources) {
        if (s.url && !m.has(s.url)) m.set(s.url, s.domain || s.url);
      }
    }
    return m;
  }, [ca]);

  // Claim id → short text (audit scope) for cited-claim chips.
  const claimLabels = useMemo(() => {
    const m = new Map<string, string>();
    if (target.kind !== "audit") return m;
    for (const c of target.audit.claims) {
      m.set(c.claim.id, c.claim.text);
    }
    return m;
  }, [target]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, loading, minimized]);

  useEffect(() => {
    function onResize() {
      setRect((r) => {
        const c = clampRect(r);
        onCommitRect(c);
        return c;
      });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [onCommitRect]);

  function beginGesture(
    kind: "drag" | "resize",
    e: React.PointerEvent<HTMLElement>,
  ) {
    e.preventDefault();
    gesture.current = { kind, px: e.clientX, py: e.clientY, start: rect };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onGesturePointerMove(e: React.PointerEvent<HTMLElement>) {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.px;
    const dy = e.clientY - g.py;
    if (g.kind === "drag") {
      setRect(clampRect({ ...g.start, x: g.start.x + dx, y: g.start.y + dy }));
    } else {
      setRect(clampRect({ ...g.start, w: g.start.w + dx, h: g.start.h + dy }));
    }
  }

  function endGesture(e: React.PointerEvent<HTMLElement>) {
    if (!gesture.current) return;
    gesture.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setRect((r) => {
      onCommitRect(r);
      return r;
    });
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || loading) return;
    setError(null);
    setLoading(true);

    const history: InterrogationTurn[] = turns
      .filter((t) => !t.meta?.challenge)
      .map((t) => ({ role: t.role, content: t.content }));

    setTurns((prev) => [...prev, { role: "user", content: q }]);
    setDraft("");

    try {
      if (target.kind === "claim") {
        const reqBody: InterrogateRequestBody = {
          claim_audit: target.ca,
          history,
          question: q,
        };
        const res = await fetch("/api/interrogate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
        });
        const data = (await res.json()) as
          | InterrogateResponseBody
          | { error: string };
        if (!res.ok || "error" in data) {
          setError("error" in data ? data.error : `Request failed (${res.status}).`);
          return;
        }
        setTurns((prev) => [
          ...prev,
          {
            role: "auditor",
            content: data.answer,
            meta: {
              cited_agents: data.cited_agents,
              cited_source_urls: data.cited_source_urls,
              abstained: data.abstained,
            },
          },
        ]);
      } else {
        const reqBody: InterrogateAuditRequestBody = {
          audit: target.audit,
          history,
          question: q,
        };
        const res = await fetch("/api/interrogate-audit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
        });
        const data = (await res.json()) as
          | InterrogateAuditResponseBody
          | { error: string };
        if (!res.ok || "error" in data) {
          setError("error" in data ? data.error : `Request failed (${res.status}).`);
          return;
        }
        setTurns((prev) => [
          ...prev,
          {
            role: "auditor",
            content: data.answer,
            meta: { cited_claim_ids: data.cited_claim_ids, abstained: data.abstained },
          },
        ]);
      }
    } catch {
      setError("Network error — could not reach the auditor.");
    } finally {
      setLoading(false);
    }
  }

  async function submitChallenge() {
    if (!ca || loading) return;
    const evidence = challengeText.trim();
    if (!evidence) return;
    const url = challengeUrl.trim();
    setError(null);
    setLoading(true);

    setTurns((prev) => [
      ...prev,
      {
        role: "user",
        content: `Challenge with a source${url ? ` (${url})` : ""}:\n${evidence}`,
      },
    ]);
    setChallengeText("");
    setChallengeUrl("");
    setChallengeOpen(false);

    try {
      const reqBody: ChallengeRequestBody = {
        claim_audit: ca,
        user_evidence: evidence,
        source_url: url || undefined,
      };
      const res = await fetch("/api/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });
      const data = (await res.json()) as ChallengeResponseBody | { error: string };
      if (!res.ok || "error" in data) {
        setError("error" in data ? data.error : `Request failed (${res.status}).`);
        return;
      }
      setTurns((prev) => [
        ...prev,
        {
          role: "auditor",
          content: data.reasoning,
          meta: {
            challenge: {
              stance: data.stance,
              suggested_verdict: data.suggested_verdict,
              quote: data.quote,
              source_url: url || undefined,
            },
          },
        },
      ]);
    } catch {
      setError("Network error — could not reach the auditor.");
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask(draft);
    }
  }

  // ---- Minimized pill ----
  if (minimized) {
    return (
      <div
        style={{
          position: "fixed",
          left: rect.x,
          top: rect.y,
          zIndex: 81,
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 38,
          padding: "0 8px 0 12px",
          borderRadius: 999,
          background: "var(--bg-card)",
          border: "1px solid var(--border-strong, var(--border))",
          boxShadow: "var(--shadow-pop)",
          animation: "gt-pop .18s ease both",
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: style ? style.color : "var(--accent)",
            boxShadow: style ? style.dotGlow : "0 0 7px var(--accent)",
            flexShrink: 0,
          }}
        />
        <button
          type="button"
          onClick={onToggleMinimize}
          style={{
            fontFamily: "'Geist Mono',monospace",
            fontSize: 10.5,
            letterSpacing: "0.04em",
            color: "var(--text-secondary)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
          }}
        >
          Ask the auditor
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={pillCloseBtn}
        >
          ×
        </button>
      </div>
    );
  }

  // ---- Full window ----
  return (
    <aside
      role="dialog"
      aria-label="Ask the auditor"
      style={{
        position: "fixed",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        zIndex: 81,
        background: "var(--bg-base, var(--bg-card))",
        border: "1px solid var(--border-strong, var(--border))",
        borderRadius: 14,
        boxShadow: "var(--shadow-pop)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        animation: "gt-modalin .18s ease both",
      }}
    >
      {/* drag handle / title bar */}
      <div
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          beginGesture("drag", e);
        }}
        onPointerMove={onGesturePointerMove}
        onPointerUp={endGesture}
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-inset)",
          cursor: "grab",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        <span style={{ display: "flex", color: "var(--text-faint)" }} aria-hidden>
          <Dots />
        </span>
        <span
          style={{
            fontFamily: "'Geist Mono',monospace",
            fontSize: 9.5,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--accent-bright, var(--accent))",
          }}
        >
          {isClaim ? "Ask the auditor" : "Ask about this response"}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <button type="button" onClick={onToggleMinimize} aria-label="Minimize" style={ctrlBtn}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 8.5h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" onClick={onClose} aria-label="Close" style={ctrlBtn}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* context header */}
      <div
        style={{
          flexShrink: 0,
          padding: "10px 12px",
          borderBottom: "1px solid var(--border-faint, var(--border))",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {ca && style ? (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <span
              style={{
                flexShrink: 0,
                marginTop: 3,
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: style.color,
                boxShadow: style.dotGlow,
              }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span
                style={{
                  fontFamily: "'Geist Mono',monospace",
                  fontSize: 9,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: style.color,
                }}
              >
                {style.label}
              </span>
              <p
                style={{
                  fontSize: 12.5,
                  lineHeight: 1.4,
                  color: "var(--text-primary)",
                  margin: 0,
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {ca.claim.text}
              </p>
            </div>
          </div>
        ) : target.kind === "audit" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span
              style={{
                fontFamily: "'Geist Mono',monospace",
                fontSize: 9,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--text-secondary)",
              }}
            >
              {target.label}
            </span>
            <span style={{ fontSize: 12, color: "var(--text-primary)" }}>
              {target.audit.summary.total_claims} claim
              {target.audit.summary.total_claims === 1 ? "" : "s"} ·{" "}
              {target.audit.summary.contradicted +
                target.audit.summary.likely_hallucination}{" "}
              flagged
            </span>
          </div>
        ) : null}
        <span style={{ fontSize: 10, color: "var(--text-faint)" }}>
          Grounded in the gathered evidence · no new web search
        </span>
      </div>

      {/* thread */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "12px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {turns.length === 0 && !loading && (
          <p style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)", margin: 0 }}>
            {isClaim
              ? "Ask why this claim got its verdict, what would change it, or challenge it with your own source below."
              : "Ask which claims are weakest, what to double-check, or where the agents disagreed."}
          </p>
        )}

        {turns.map((t, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {t.role === "user" ? (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <span
                  style={{
                    maxWidth: "88%",
                    fontSize: 12.5,
                    lineHeight: 1.45,
                    color: "var(--text-primary)",
                    background: "var(--bg-inset)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: "7px 11px",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {t.content}
                </span>
              </div>
            ) : t.meta?.challenge ? (
              <ChallengeTurn reasoning={t.content} challenge={t.meta.challenge} />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {t.meta?.abstained && (
                  <span style={abstainBadge}>outside gathered evidence</span>
                )}
                <p
                  style={{
                    fontSize: 12.5,
                    lineHeight: 1.5,
                    color: t.meta?.abstained ? "var(--text-muted)" : "var(--text-secondary)",
                    whiteSpace: "pre-wrap",
                    margin: 0,
                  }}
                >
                  {t.content}
                </p>
                {/* citations */}
                {(t.meta?.cited_agents?.length ||
                  t.meta?.cited_source_urls?.length ||
                  t.meta?.cited_claim_ids?.length) ? (
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
                    {t.meta?.cited_agents?.map((role) => (
                      <span key={role} style={chip}>
                        {AGENT_ROLE_LABEL[role]}
                      </span>
                    ))}
                    {t.meta?.cited_claim_ids?.map((id) => (
                      <span key={id} style={chip} title={claimLabels.get(id) ?? id}>
                        {(claimLabels.get(id) ?? id).slice(0, 32)}
                        {(claimLabels.get(id) ?? id).length > 32 ? "…" : ""}
                      </span>
                    ))}
                    {t.meta?.cited_source_urls?.map((url) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: 11,
                          color: "var(--accent)",
                          textDecoration: "underline dotted",
                          textUnderlineOffset: 2,
                        }}
                      >
                        {urlLabels.get(url) ?? url}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <span
            style={{
              fontFamily: "'Geist Mono',monospace",
              fontSize: 10.5,
              color: "var(--text-muted)",
            }}
          >
            auditor is reviewing the evidence…
          </span>
        )}

        {error && (
          <span style={{ fontSize: 11.5, color: "var(--v-contradicted)" }}>{error}</span>
        )}
      </div>

      {/* composer */}
      <div
        style={{
          flexShrink: 0,
          padding: "10px 12px",
          borderTop: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {turns.length === 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {starters.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => ask(s)}
                disabled={loading}
                style={{
                  fontSize: 11,
                  color: "var(--text-secondary)",
                  background: "var(--bg-inset)",
                  border: "1px solid var(--border)",
                  borderRadius: 999,
                  padding: "4px 9px",
                  cursor: loading ? "default" : "pointer",
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* challenge composer (claim scope only) */}
        {isClaim && challengeOpen && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              padding: 8,
              borderRadius: 9,
              border: "1px solid color-mix(in srgb, var(--v-crosscheck) 30%, transparent)",
              background: "color-mix(in srgb, var(--v-crosscheck) 6%, transparent)",
            }}
          >
            <span
              style={{
                fontFamily: "'Geist Mono',monospace",
                fontSize: 9,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--v-crosscheck)",
              }}
            >
              Challenge with your own source
            </span>
            <textarea
              value={challengeText}
              onChange={(e) => setChallengeText(e.target.value)}
              placeholder="Paste an excerpt, quote, or abstract the audit missed…"
              rows={3}
              disabled={loading}
              style={{
                resize: "vertical",
                fontSize: 12,
                lineHeight: 1.45,
                color: "var(--text-primary)",
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "7px 9px",
                outline: "none",
                fontFamily: "inherit",
              }}
            />
            <input
              type="text"
              value={challengeUrl}
              onChange={(e) => setChallengeUrl(e.target.value)}
              placeholder="Source URL (optional)"
              disabled={loading}
              style={{
                fontSize: 11.5,
                color: "var(--text-primary)",
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "6px 9px",
                outline: "none",
              }}
            />
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setChallengeOpen(false)}
                style={{
                  fontSize: 11.5,
                  color: "var(--text-muted)",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "5px 10px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitChallenge}
                disabled={loading || challengeText.trim().length === 0}
                style={{
                  fontFamily: "'Geist Mono',monospace",
                  fontSize: 11,
                  color:
                    loading || challengeText.trim().length === 0
                      ? "var(--text-faint)"
                      : "var(--v-crosscheck)",
                  background: "transparent",
                  border: "1px solid color-mix(in srgb, var(--v-crosscheck) 35%, transparent)",
                  borderRadius: 8,
                  padding: "5px 12px",
                  cursor:
                    loading || challengeText.trim().length === 0 ? "default" : "pointer",
                }}
              >
                Re-judge
              </button>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 6 }}>
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={isClaim ? "Ask why this verdict…" : "Ask about this response…"}
            disabled={loading}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12.5,
              color: "var(--text-primary)",
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "8px 11px",
              outline: "none",
            }}
          />
          <button
            type="button"
            onClick={() => ask(draft)}
            disabled={loading || draft.trim().length === 0}
            style={{
              fontFamily: "'Geist Mono',monospace",
              fontSize: 11,
              letterSpacing: "0.04em",
              color:
                loading || draft.trim().length === 0
                  ? "var(--text-faint)"
                  : "var(--accent-bright, var(--accent))",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "0 14px",
              cursor: loading || draft.trim().length === 0 ? "default" : "pointer",
            }}
          >
            Ask
          </button>
        </div>

        {isClaim && !challengeOpen && (
          <button
            type="button"
            onClick={() => setChallengeOpen(true)}
            disabled={loading}
            style={{
              alignSelf: "flex-start",
              fontFamily: "'Geist Mono',monospace",
              fontSize: 10,
              letterSpacing: "0.04em",
              color: "var(--v-crosscheck)",
              background: "transparent",
              border: "none",
              cursor: loading ? "default" : "pointer",
              padding: 0,
            }}
          >
            + Challenge with a source
          </button>
        )}
      </div>

      {/* resize handle */}
      <div
        onPointerDown={(e) => beginGesture("resize", e)}
        onPointerMove={onGesturePointerMove}
        onPointerUp={endGesture}
        aria-hidden
        style={{
          position: "absolute",
          right: 0,
          bottom: 0,
          width: 18,
          height: 18,
          cursor: "nwse-resize",
          touchAction: "none",
          display: "grid",
          placeItems: "center",
          color: "var(--text-faint)",
        }}
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <path d="M10 4 4 10M10 8 8 10" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
      </div>
    </aside>
  );
}

const STANCE_COPY: Record<ChallengeStance, { label: string; color: string }> = {
  supports: { label: "Your source supports the claim", color: "var(--v-verified)" },
  contradicts: { label: "Your source contradicts the claim", color: "var(--v-contradicted)" },
  insufficient: { label: "Your source doesn't settle it", color: "var(--text-muted)" },
};

function ChallengeTurn({
  reasoning,
  challenge,
}: {
  reasoning: string;
  challenge: ChallengeResult;
}) {
  const stance = STANCE_COPY[challenge.stance];
  const vstyle = VERDICT_STYLES[challenge.suggested_verdict];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "9px 11px",
        borderRadius: 9,
        border: "1px solid color-mix(in srgb, var(--v-crosscheck) 28%, transparent)",
        background: "color-mix(in srgb, var(--v-crosscheck) 6%, transparent)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        <span
          style={{
            fontFamily: "'Geist Mono',monospace",
            fontSize: 9,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--v-crosscheck)",
          }}
        >
          Challenge
        </span>
        <span style={{ fontSize: 11.5, fontWeight: 500, color: stance.color }}>
          {stance.label}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ fontSize: 10.5, color: "var(--text-faint)" }}>Would be</span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            height: 19,
            padding: "0 8px",
            borderRadius: 999,
            background: vstyle.bgMix,
            border: `1px solid color-mix(in srgb, ${vstyle.color} 35%, transparent)`,
            fontFamily: "'Geist Mono',monospace",
            fontSize: 9,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: vstyle.color,
          }}
        >
          {vstyle.label}
        </span>
        <span style={{ fontSize: 9.5, color: "var(--text-faint)" }}>(advisory)</span>
      </div>
      <p style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--text-secondary)", margin: 0 }}>
        {reasoning}
      </p>
      {challenge.quote && (
        <blockquote
          style={{
            margin: 0,
            padding: "5px 9px",
            borderLeft: "2px solid color-mix(in srgb, var(--v-crosscheck) 45%, transparent)",
            fontSize: 11.5,
            fontStyle: "italic",
            color: "var(--text-muted)",
          }}
        >
          “{challenge.quote}”
        </blockquote>
      )}
    </div>
  );
}

const ctrlBtn: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-muted)",
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
};

const pillCloseBtn: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-muted)",
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
  fontSize: 13,
  lineHeight: 1,
};

const chip: React.CSSProperties = {
  fontFamily: "'Geist Mono',monospace",
  fontSize: 8.5,
  letterSpacing: "0.06em",
  color: "var(--text-muted)",
  background: "var(--bg-inset)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  padding: "2px 6px",
};

const abstainBadge: React.CSSProperties = {
  alignSelf: "flex-start",
  fontFamily: "'Geist Mono',monospace",
  fontSize: 8.5,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  background: "var(--bg-inset)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  padding: "2px 6px",
};

function Dots() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <circle cx="3" cy="3" r="1" />
      <circle cx="3" cy="6" r="1" />
      <circle cx="3" cy="9" r="1" />
      <circle cx="6" cy="3" r="1" />
      <circle cx="6" cy="6" r="1" />
      <circle cx="6" cy="9" r="1" />
    </svg>
  );
}
