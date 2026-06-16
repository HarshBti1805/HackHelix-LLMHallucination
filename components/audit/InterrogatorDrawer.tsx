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
  ClaimAudit,
  InterrogateRequestBody,
  InterrogateResponseBody,
  InterrogationTurn,
} from "@/types";
import { AGENT_ROLE_LABEL, VERDICT_STYLES } from "./verdict";

/**
 * "Interrogate the verdict / Ask the auditor" — floating window edition.
 *
 * A single, NON-MODAL floating window (mounted once via `InterrogatorProvider`)
 * that any `ClaimRow` opens with `useInterrogator().open(ca)`. Unlike a docked
 * drawer or an inline thread, it hovers above the page without shifting layout
 * or locking interaction — the reviewer can still scroll the claim list and
 * read agent reports underneath, and drag the window out of the way.
 *
 * It is draggable (by its title bar) and resizable (bottom-right handle), can
 * be minimized to a pill, and remembers its position/size for the session.
 * Clicking "Ask the auditor" on a different claim RETARGETS the same window.
 *
 * Threads live in this provider's React state, keyed by `claim.id`, so the
 * conversation is preserved when retargeting/minimizing. Nothing is persisted
 * server-side (CLAUDE.md rule 6). The auditor answers grounded only in evidence
 * already gathered and never re-searches (rule 5); see `lib/interrogate.ts`.
 */

const STARTERS = [
  "Why this verdict?",
  "What would change it?",
  "Strongest counter-evidence?",
  "Could this be a false positive?",
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

interface AuditorMeta {
  cited_agents: AgentRole[];
  cited_source_urls: string[];
  abstained: boolean;
}

interface DisplayTurn extends InterrogationTurn {
  meta?: AuditorMeta;
}

interface InterrogatorContextValue {
  open: (ca: ClaimAudit) => void;
}

const InterrogatorContext = createContext<InterrogatorContextValue>({
  open: () => {},
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
  // Default to the left side, as requested — alongside the panel, not over it.
  const h = Math.min(DEFAULT_H, window.innerHeight - 96);
  return clampRect({ x: 24, y: 88, w: DEFAULT_W, h });
}

export function InterrogatorProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ClaimAudit | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [threads, setThreads] = useState<Record<string, DisplayTurn[]>>({});
  // Persisted window geometry for the session. `null` until first opened.
  const [rect, setRect] = useState<Rect | null>(null);

  const open = useCallback((ca: ClaimAudit) => {
    setActive(ca);
    setMinimized(false);
    setRect((prev) => prev ?? defaultRect());
  }, []);

  const close = useCallback(() => setActive(null), []);
  const toggleMinimize = useCallback(() => setMinimized((m) => !m), []);

  const setThreadFor = useCallback(
    (claimId: string, updater: (prev: DisplayTurn[]) => DisplayTurn[]) => {
      setThreads((prev) => ({
        ...prev,
        [claimId]: updater(prev[claimId] ?? []),
      }));
    },
    [],
  );

  const value = useMemo(() => ({ open }), [open]);

  return (
    <InterrogatorContext.Provider value={value}>
      {children}
      {active && rect && (
        <FloatingInterrogator
          ca={active}
          turns={threads[active.claim.id] ?? []}
          setTurns={(updater) => setThreadFor(active.claim.id, updater)}
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
  ca: ClaimAudit;
  turns: DisplayTurn[];
  setTurns: (updater: (prev: DisplayTurn[]) => DisplayTurn[]) => void;
  minimized: boolean;
  onToggleMinimize: () => void;
  onClose: () => void;
  initialRect: Rect;
  onCommitRect: (r: Rect) => void;
}

function FloatingInterrogator({
  ca,
  turns,
  setTurns,
  minimized,
  onToggleMinimize,
  onClose,
  initialRect,
  onCommitRect,
}: FloatingProps) {
  // Live geometry stays in local state so dragging never re-renders the app.
  const [rect, setRect] = useState<Rect>(initialRect);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Interaction tracking for drag/resize. Null when idle.
  const gesture = useRef<
    | { kind: "drag" | "resize"; px: number; py: number; start: Rect }
    | null
  >(null);

  const style = VERDICT_STYLES[ca.consensus_verdict];

  const urlLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of ca.per_agent_reports) {
      for (const s of r.sources) {
        if (s.url && !m.has(s.url)) m.set(s.url, s.domain || s.url);
      }
    }
    return m;
  }, [ca]);

  // Keep the newest turn in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, loading, minimized]);

  // Re-clamp into the viewport if the browser window resizes.
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

    const history: InterrogationTurn[] = turns.map((t) => ({
      role: t.role,
      content: t.content,
    }));

    setTurns((prev) => [...prev, { role: "user", content: q }]);
    setDraft("");

    try {
      const reqBody: InterrogateRequestBody = {
        claim_audit: ca,
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
        const msg =
          "error" in data ? data.error : `Request failed (${res.status}).`;
        setError(msg);
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
            background: style.color,
            boxShadow: style.dotGlow,
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
            maxWidth: 180,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          Ask the auditor
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
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
          }}
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
          // Don't start a drag from the control buttons.
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
        <span
          style={{
            display: "flex",
            gap: 3,
            alignItems: "center",
            color: "var(--text-faint)",
          }}
          aria-hidden
        >
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
          Ask the auditor
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <button
            type="button"
            onClick={onToggleMinimize}
            aria-label="Minimize"
            style={ctrlBtn}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path
                d="M2.5 8.5h7"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={ctrlBtn}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path
                d="M3 3l6 6M9 3l-6 6"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* claim context */}
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
          <p
            style={{
              fontSize: 12,
              lineHeight: 1.5,
              color: "var(--text-muted)",
              margin: 0,
            }}
          >
            Ask why this claim got its verdict, what would change it, or where
            the agents disagreed.
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
                  }}
                >
                  {t.content}
                </span>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {t.meta?.abstained && (
                  <span
                    style={{
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
                    }}
                  >
                    outside gathered evidence
                  </span>
                )}
                <p
                  style={{
                    fontSize: 12.5,
                    lineHeight: 1.5,
                    color: t.meta?.abstained
                      ? "var(--text-muted)"
                      : "var(--text-secondary)",
                    whiteSpace: "pre-wrap",
                    margin: 0,
                  }}
                >
                  {t.content}
                </p>
                {(t.meta?.cited_agents.length || t.meta?.cited_source_urls.length) ? (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    {t.meta?.cited_agents.map((role) => (
                      <span
                        key={role}
                        style={{
                          fontFamily: "'Geist Mono',monospace",
                          fontSize: 8.5,
                          letterSpacing: "0.06em",
                          color: "var(--text-muted)",
                          background: "var(--bg-inset)",
                          border: "1px solid var(--border)",
                          borderRadius: 4,
                          padding: "2px 6px",
                        }}
                      >
                        {AGENT_ROLE_LABEL[role]}
                      </span>
                    ))}
                    {t.meta?.cited_source_urls.map((url) => (
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
          <span style={{ fontSize: 11.5, color: "var(--v-contradicted)" }}>
            {error}
          </span>
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
            {STARTERS.map((s) => (
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

        <div style={{ display: "flex", gap: 6 }}>
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask why this verdict…"
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
              cursor:
                loading || draft.trim().length === 0 ? "default" : "pointer",
            }}
          >
            Ask
          </button>
        </div>
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
          <path
            d="M10 4 4 10M10 8 8 10"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </aside>
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
