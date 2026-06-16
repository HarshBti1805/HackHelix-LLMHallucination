"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SummaryBar } from "@/components/audit/SummaryBar";
import { ClaimList } from "@/components/audit/ClaimList";
import type {
  CitationsReport,
  ClaimCitations,
  ConnectorId,
  ConnectorPageRef,
  ConnectorStatus,
  GroundedClaim,
  GroundednessAudit,
  GroundingVerdict,
  WorkspaceAttachment,
  WorkspaceRunRequestBody,
  WorkspaceRunResult,
} from "@/types";

/* ── types ─────────────────────────────────────────────────────────── */
type ConnStatus = ConnectorStatus & { configured?: boolean };

interface Turn {
  id: string;
  instruction: string;
  attachments: WorkspaceAttachment[];
  status: "pending" | "done" | "error";
  result?: WorkspaceRunResult;
  error?: string;
}

/* ── constants ──────────────────────────────────────────────────────── */
const CONNECTOR_IDS: ConnectorId[] = ["notion", "google", "gmail", "slack"];

const CONNECTOR_LABEL: Record<ConnectorId, string> = {
  notion: "Notion",
  google: "Google Drive",
  gmail: "Gmail",
  slack: "Slack",
};

const CONNECTOR_DESC: Record<ConnectorId, string> = {
  notion: "Audit pages, specs & wikis",
  google: "Docs, sheets & slides",
  gmail: "Threads & attachments",
  slack: "Set SLACK_BOT_TOKEN to enable",
};

const GVERDICT: Record<GroundingVerdict, { label: string; color: string }> = {
  grounded:    { label: "Grounded",      color: "var(--v-verified)"     },
  ungrounded:  { label: "Not in source", color: "var(--v-unverified)"   },
  contradicted:{ label: "Contradicted",  color: "var(--v-contradicted)" },
};

const MODE_LABEL: Record<WorkspaceRunResult["mode"], string> = {
  groundedness: "Faithfulness check",
  factcheck: "Web fact-check",
  citations: "Citation dossier",
};

const FOLLOW_UPS: Record<WorkspaceRunResult["mode"], string[]> = {
  groundedness: ["Fact-check the contradicted claims against the web", "Generate citations for and against these claims"],
  factcheck: ["Generate citations for and against these claims", "Ground these against my Notion"],
  citations: ["Fact-check these claims against the web"],
};

/* ── page ───────────────────────────────────────────────────────────── */
export default function WorkspacePage() {
  const [statuses, setStatuses] = useState<Record<ConnectorId, ConnStatus>>({
    notion: { connector: "notion", connected: false },
    google: { connector: "google", connected: false, configured: true },
    gmail:  { connector: "gmail",  connected: false, configured: true },
    slack:  { connector: "slack",  connected: false, configured: false },
  });
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [instruction, setInstruction] = useState("");
  const [attached, setAttached] = useState<WorkspaceAttachment[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSource, setPickerSource] = useState<ConnectorId>("notion");
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerResults, setPickerResults] = useState<ConnectorPageRef[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const refreshStatus = useCallback(async () => {
    const results = await Promise.all(
      CONNECTOR_IDS.map(async (id) => {
        try {
          const res = await fetch(`/api/connectors/${id}/status`);
          return (await res.json()) as ConnStatus;
        } catch {
          return { connector: id, connected: false } as ConnStatus;
        }
      }),
    );
    const next = {} as Record<ConnectorId, ConnStatus>;
    CONNECTOR_IDS.forEach((id, i) => { next[id] = results[i]; });
    setStatuses(next);
  }, []);

  useEffect(() => {
    refreshStatus();
    const params = new URLSearchParams(window.location.search);
    const c = params.get("connected");
    if (c) setBanner({ kind: "ok", msg: `${CONNECTOR_LABEL[c as ConnectorId] ?? c} connected.` });
    const e = params.get("error");
    if (e) setBanner({ kind: "err", msg: e });
    if (c || e) window.history.replaceState({}, "", window.location.pathname);
  }, [refreshStatus]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const connected = CONNECTOR_IDS.some((id) => statuses[id].connected);

  async function disconnect(connector: ConnectorId) {
    await fetch(`/api/connectors/${connector}/disconnect`, { method: "POST" });
    setAttached((prev) => prev.filter((a) => a.connector !== connector));
    setBanner({ kind: "ok", msg: `Disconnected from ${CONNECTOR_LABEL[connector]}.` });
    refreshStatus();
  }

  const runPickerSearch = useCallback(async (q: string, source: ConnectorId) => {
    setPickerLoading(true);
    try {
      const res = await fetch(`/api/connectors/${source}/pages?q=${encodeURIComponent(q)}`);
      const data = (await res.json()) as { pages?: ConnectorPageRef[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `search failed (${res.status})`);
      setPickerResults(data.pages ?? []);
    } catch (err) {
      setPickerResults([]);
      setBanner({ kind: "err", msg: err instanceof Error ? err.message : "Search failed." });
    } finally {
      setPickerLoading(false);
    }
  }, []);

  function openPicker() {
    if (pickerOpen) { setPickerOpen(false); return; }
    const source = CONNECTOR_IDS.find((id) => statuses[id].connected) ?? "notion";
    setPickerSource(source);
    setPickerOpen(true);
  }

  function switchSource(source: ConnectorId) {
    setPickerSource(source);
    setPickerResults([]);
  }

  useEffect(() => {
    if (!pickerOpen) return;
    const t = setTimeout(() => runPickerSearch(pickerQuery, pickerSource), 280);
    return () => clearTimeout(t);
  }, [pickerOpen, pickerQuery, pickerSource, runPickerSearch]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPickerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickerOpen]);

  function addAttachment(p: ConnectorPageRef, source: ConnectorId) {
    setAttached((prev) =>
      prev.some((a) => a.id === p.id)
        ? prev.filter((a) => a.id !== p.id)
        : [...prev, { connector: source, id: p.id, title: p.title }],
    );
  }

  function removeAttachment(id: string) {
    setAttached((prev) => prev.filter((a) => a.id !== id));
  }

  async function send() {
    if (!connected) return;
    const text = instruction.trim();
    if (!text && attached.length === 0) return;

    const lastDone = [...turns].reverse().find((t) => t.status === "done" && t.result);
    const prior = lastDone?.result
      ? lastDone.result.used.map((u) => ({ connector: u.connector, id: u.id, title: u.title }))
      : [];

    const turn: Turn = { id: `t-${Date.now()}`, instruction: text, attachments: attached, status: "pending" };
    setTurns((prev) => [...prev, turn]);
    setInstruction("");
    setAttached([]);
    setPickerOpen(false);

    try {
      const body: WorkspaceRunRequestBody = { instruction: text, attachments: turn.attachments, prior };
      const res = await fetch("/api/workspace/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as WorkspaceRunResult | { error?: string };
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `failed (${res.status})`);
      setTurns((prev) =>
        prev.map((t) => (t.id === turn.id ? { ...t, status: "done", result: data as WorkspaceRunResult } : t)),
      );
    } catch (err) {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turn.id ? { ...t, status: "error", error: err instanceof Error ? err.message : "Failed." } : t,
        ),
      );
    }
  }

  const connectedSources = CONNECTOR_IDS.filter((id) => statuses[id].connected);

  return (
    <div style={{ position: "relative", height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-base)", color: "var(--text-primary)", fontFamily: "'Geist', system-ui, sans-serif" }}>

      {/* ── ambient glow ── */}
      <div aria-hidden style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, backgroundImage: "radial-gradient(60% 50% at 50% 0%, var(--accent-dim), transparent 70%)" }} />

      {/* ── nav ── */}
      <header style={{ position: "relative", zIndex: 30, flexShrink: 0, display: "flex", alignItems: "center", height: 52, padding: "0 18px", borderBottom: "1px solid var(--border)", background: "color-mix(in srgb, var(--bg-base) 88%, transparent)" }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 7, background: "transparent", border: "none", cursor: "pointer", color: "var(--text-secondary)", fontSize: 13, textDecoration: "none" }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M8.5 3 4.5 7 8.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Groundtruth
        </Link>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {CONNECTOR_IDS.map((id) => (
            <ConnectorBadge key={id} id={id} status={statuses[id]} onDisconnect={() => disconnect(id)} />
          ))}
        </div>
      </header>

      {/* ── banner ── */}
      {banner && (
        <div style={{ maxWidth: 780, margin: "10px auto 0", width: "100%", padding: "0 18px" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 13px", borderRadius: 10, border: "1px solid var(--border)", background: banner.kind === "err" ? "color-mix(in srgb, var(--v-hallucination) 12%, transparent)" : "var(--bg-card)", fontSize: 12.5, color: banner.kind === "err" ? "var(--v-hallucination)" : "var(--text-secondary)" }}>
            <span>{banner.msg}</span>
            <button onClick={() => setBanner(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: "inherit", cursor: "pointer", opacity: 0.6 }}>✕</button>
          </div>
        </div>
      )}

      {/* ── transcript ── */}
      <div
        ref={transcriptRef}
        className="wa-scroll"
        style={{ position: "relative", zIndex: 1, flex: 1, overflowY: "auto", padding: "26px 22px" }}
      >
        <div style={{ maxWidth: 780, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
          {turns.length === 0 && <EmptyState statuses={statuses} connected={connected} />}
          {turns.map((t) => (
            <TurnView key={t.id} turn={t} onFollowUp={setInstruction} />
          ))}
        </div>
      </div>

      {/* ── composer ── */}
      <div style={{ position: "relative", zIndex: 2, flexShrink: 0, padding: "14px 18px 18px", background: "color-mix(in srgb, var(--bg-base) 70%, transparent)", backdropFilter: "blur(10px)", borderTop: "1px solid var(--border)" }}>
        {pickerOpen && (
          <div onMouseDown={() => setPickerOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 15 }} />
        )}
        {pickerOpen && (
          <DocPicker
            source={pickerSource}
            sources={connectedSources}
            onSwitchSource={switchSource}
            query={pickerQuery}
            setQuery={setPickerQuery}
            results={pickerResults}
            loading={pickerLoading}
            selectedIds={attached.map((a) => a.id)}
            onSearch={() => runPickerSearch(pickerQuery, pickerSource)}
            onPick={(p) => addAttachment(p, pickerSource)}
            onClose={() => setPickerOpen(false)}
          />
        )}
        <div style={{ maxWidth: 780, margin: "0 auto", border: `1px solid ${pickerOpen ? "var(--accent)" : "var(--border)"}`, borderRadius: 14, background: "var(--bg-card)", boxShadow: pickerOpen ? "0 0 0 3px var(--accent-dim)" : "none", padding: "11px 12px", opacity: connected ? 1 : 0.6 }}>
          {/* attachment chips */}
          {attached.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 9 }}>
              {attached.map((a) => (
                <span key={a.id} style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 28, padding: "0 7px 0 9px", borderRadius: 8, background: "var(--accent-dim)", border: "1px solid color-mix(in srgb, var(--accent) 40%, transparent)" }}>
                  <ConnectorGlyph id={a.connector} size={12} stroke="var(--accent-bright)" />
                  <span style={{ fontSize: 12, color: "var(--text-primary)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
                  <button onClick={() => removeAttachment(a.id)} style={{ display: "grid", placeItems: "center", width: 16, height: 16, borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", color: "var(--text-muted)" }}>
                    <svg width="8" height="8" viewBox="0 0 10 10"><path d="M2 2 8 8 M8 2 2 8" stroke="currentColor" strokeWidth="1.4"/></svg>
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
            placeholder={connected ? (turns.length > 0 ? "Ask a follow-up…" : "Ask me to check your docs — e.g. “is my meeting summary faithful to the transcript?”") : "Connect a source to start."}
            disabled={!connected}
            rows={turns.length > 0 ? 1 : 2}
            style={{ width: "100%", resize: "none", border: "none", outline: "none", background: "transparent", color: "var(--text-primary)", fontFamily: "'Geist', system-ui, sans-serif", fontSize: 14, lineHeight: 1.5 }}
          />
          <div style={{ display: "flex", alignItems: "center", marginTop: 6 }}>
            <button
              onClick={openPicker}
              disabled={!connected}
              style={{ display: "flex", alignItems: "center", gap: 6, height: 30, padding: "0 11px", borderRadius: 8, border: `1px solid ${pickerOpen ? "var(--accent)" : "var(--border)"}`, background: pickerOpen ? "var(--accent-dim)" : "transparent", color: pickerOpen ? "var(--accent-bright)" : "var(--text-secondary)", cursor: "pointer", fontSize: 12, fontWeight: 500 }}
            >
              <SearchGlyph />
              Find docs
            </button>
            <div style={{ flex: 1 }} />
            <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10.5, color: "var(--text-faint)", marginRight: 11, whiteSpace: "nowrap" }}>⌘↵ to send</span>
            <button
              onClick={send}
              disabled={!connected || (!instruction.trim() && attached.length === 0)}
              style={{ display: "flex", alignItems: "center", gap: 7, height: 32, padding: "0 14px", borderRadius: 9, border: "none", background: "var(--accent)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: !connected || (!instruction.trim() && attached.length === 0) ? 0.4 : 1 }}
            >
              Audit
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <path d="M2 7 H11 M7.5 3.5 11 7 7.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── empty state ────────────────────────────────────────────────────── */
function EmptyState({ statuses, connected }: { statuses: Record<ConnectorId, ConnStatus>; connected: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 30, minHeight: "60vh" }}>
      <div style={{ width: "100%", maxWidth: 600, textAlign: "center" }}>
        <div style={{ display: "inline-grid", placeItems: "center", width: 56, height: 56, borderRadius: 15, background: "var(--bg-card)", border: "1px solid var(--border)", marginBottom: 20 }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <circle cx="14" cy="5"    r="2.3" fill="var(--v-contradicted)"/>
            <circle cx="6.2" cy="19"  r="2.3" fill="var(--accent)"/>
            <circle cx="21.8" cy="19" r="2.3" fill="var(--v-crosscheck)"/>
            <circle cx="14"  cy="14"  r="2.7" fill="var(--text-primary)"/>
            <path d="M14 7.3 V11.3 M8 17.7 L11.7 15.6 M20 17.7 L16.3 15.6" stroke="var(--text-faint)" strokeWidth="1.1"/>
          </svg>
        </div>
        <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10.5, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>
          Connectors · audit workspace
        </div>
        <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 33, lineHeight: 1.08, letterSpacing: "-0.025em", marginBottom: 12, color: "var(--text-primary)" }}>
          Audit your docs<br />by just asking.
        </h2>
        <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--text-secondary)", maxWidth: 460, margin: "0 auto 28px" }}>
          Connect a workspace source, then ask Groundtruth to fact-check, ground, or build a citation dossier from your real pages — no copy-paste.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, textAlign: "left" }}>
          {CONNECTOR_IDS.map((id) => {
            const st = statuses[id];
            const isOn = st.connected;
            const needsSetup = st.configured === false;
            return (
              <div key={id} style={{ display: "flex", alignItems: "center", gap: 13, padding: "15px 16px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-card)", opacity: needsSetup ? 0.55 : 1 }}>
                <span style={{ display: "grid", placeItems: "center", width: 36, height: 36, borderRadius: 10, background: id === "notion" ? "#fff" : "var(--bg-inset)", flexShrink: 0 }}>
                  <ConnectorGlyph id={id} size={18} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" }}>{CONNECTOR_LABEL[id]}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 1 }}>{isOn ? (st.account ?? "Connected") : CONNECTOR_DESC[id]}</div>
                </div>
                {isOn ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "'Geist Mono', monospace", fontSize: 10.5, color: "var(--v-verified)", flexShrink: 0 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--v-verified)", boxShadow: "0 0 6px var(--v-verified)" }} />
                    On
                  </span>
                ) : needsSetup ? (
                  <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 13, color: "var(--text-faint)", flexShrink: 0 }}>—</span>
                ) : (
                  <a href={`/api/connectors/${id}/authorize`} style={{ height: 30, padding: "0 13px", borderRadius: 8, border: "1px solid var(--accent)", background: "var(--accent-dim)", color: "var(--accent-bright)", textDecoration: "none", fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
                    Connect
                  </a>
                )}
              </div>
            );
          })}
        </div>

        {connected && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 28 }}>
            {[
              "Audit the meeting summary in this email against the transcript",
              "Fact-check the market claims in this memo",
              "Generate citations for and against these claims",
            ].map((s) => (
              <span key={s} style={{ fontSize: 12.5, padding: "6px 13px", borderRadius: 999, border: "1px solid var(--border-strong)", background: "var(--bg-card)", color: "var(--text-secondary)", cursor: "default" }}>{s}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── turn ───────────────────────────────────────────────────────────── */
function TurnView({ turn, onFollowUp }: { turn: Turn; onFollowUp: (text: string) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* user bubble */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
        <div style={{ maxWidth: "82%", background: "var(--accent)", color: "#fff", borderRadius: "15px 15px 4px 15px", padding: "12px 15px" }}>
          {turn.attachments.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: turn.instruction ? 8 : 0 }}>
              {turn.attachments.map((a) => (
                <span key={a.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 8px", borderRadius: 6, background: "rgba(255,255,255,0.18)" }}>
                  <ConnectorGlyph id={a.connector} size={10} stroke="#fff" />
                  <span style={{ fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
                </span>
              ))}
            </div>
          )}
          {turn.instruction && <div style={{ fontSize: 14, lineHeight: 1.5 }}>{turn.instruction}</div>}
        </div>
      </div>

      {/* assistant response */}
      {turn.status === "pending" && <PendingTurn />}
      {turn.status === "error" && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "13px 15px", border: "1px solid color-mix(in srgb, var(--v-hallucination) 40%, transparent)", borderRadius: 12, background: "color-mix(in srgb, var(--v-hallucination) 9%, transparent)" }}>
          <svg width="17" height="17" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0, marginTop: 1, color: "var(--v-hallucination)" }}>
            <path d="M9 2 1.5 16 H16.5 Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
            <path d="M9 7 V10.5 M9 12.8 V12.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 2 }}>Audit failed</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--text-secondary)" }}>{turn.error}</div>
          </div>
        </div>
      )}
      {turn.status === "done" && turn.result && (
        <ResultCard result={turn.result} onFollowUp={onFollowUp} />
      )}
    </div>
  );
}

function PendingTurn() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "13px 15px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-raised)" }}>
      <svg width="18" height="18" viewBox="0 0 18 18" style={{ animation: "gt-spin 1s linear infinite", flexShrink: 0 }}>
        <circle cx="9" cy="9" r="6.5" stroke="var(--border-strong)" strokeWidth="2" fill="none"/>
        <path d="M9 2.5 A6.5 6.5 0 0 1 15.5 9" stroke="var(--accent)" strokeWidth="2" fill="none" strokeLinecap="round"/>
      </svg>
      <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Pulling your docs and auditing…</span>
    </div>
  );
}

/* ── result card ────────────────────────────────────────────────────── */
function ResultCard({ result, onFollowUp }: { result: WorkspaceRunResult; onFollowUp: (text: string) => void }) {
  function save(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }

  function download(kind: "json" | "csv" | "md") {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    if (kind === "json") {
      save(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }), `audit_${result.mode}_${stamp}.json`);
      return;
    }
    if (kind === "md") {
      save(new Blob([buildMarkdownReport(result)], { type: "text/markdown" }), `report_${result.mode}_${stamp}.md`);
      return;
    }
    const esc = (s: unknown) => `"${String(s).replace(/"/g, '""')}"`;
    let head = "";
    let rows: string[] = [];
    if (result.mode === "groundedness" && result.groundedness) {
      head = "verdict,confidence,claim,rationale,supporting_quote\n";
      rows = result.groundedness.claims.map((c) =>
        [c.verdict, c.confidence, c.claim.text, c.rationale, c.supporting_quote].map(esc).join(","));
    } else if (result.mode === "citations" && result.citations) {
      head = "claim,stance,supporting_count,contradicting_count\n";
      rows = result.citations.claims.map((c) =>
        [c.claim, c.stance_summary, c.supporting.length, c.contradicting.length].map(esc).join(","));
    } else if (result.audit) {
      head = "verdict,confidence,claim\n";
      rows = result.audit.claims.map((c) =>
        [c.consensus_verdict, c.consensus_confidence, c.claim.text].map(esc).join(","));
    }
    save(new Blob([head + rows.join("\n")], { type: "text/csv" }), `audit_${result.mode}_${stamp}.csv`);
  }

  return (
    <div style={{ border: "1px solid var(--border-strong)", borderRadius: 14, background: "var(--bg-raised)", boxShadow: "var(--shadow-card)", overflow: "hidden" }}>
      {/* header bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "13px 15px", borderBottom: "1px solid var(--border)", background: "var(--bg-inset)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 26, padding: "0 11px", borderRadius: 8, background: "var(--accent-dim)", border: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }} />
          <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10.5, letterSpacing: "0.04em", color: "var(--accent-bright)" }}>{MODE_LABEL[result.mode]}</span>
        </span>
        <span style={{ fontSize: 12, color: "var(--text-secondary)", flex: 1, minWidth: 160 }}>{result.note}</span>
        <div style={{ display: "flex", gap: 6 }}>
          <GhostBtn onClick={() => download("md")}>Report</GhostBtn>
          <GhostBtn onClick={() => download("json")}>JSON</GhostBtn>
          <GhostBtn onClick={() => download("csv")}>CSV</GhostBtn>
        </div>
      </div>

      {/* doc role chips */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "12px 15px 4px" }}>
        {result.used.map((d) => (
          <span key={d.id} style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 26, padding: "0 10px", borderRadius: 7, background: "var(--bg-card)", border: "1px solid var(--border)" }}>
            <ConnectorGlyph id={d.connector} size={11} />
            {d.url
              ? <a href={d.url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: "var(--text-secondary)", textDecoration: "none", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</a>
              : <span style={{ fontSize: 11.5, color: "var(--text-secondary)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</span>
            }
            <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 8.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-faint)" }}>{d.role}</span>
          </span>
        ))}
      </div>

      {/* body by mode */}
      {result.mode === "groundedness" && result.groundedness && <GroundednessBody audit={result.groundedness} />}
      {result.mode === "factcheck" && result.audit && (
        result.audit.summary.total_claims === 0
          ? <EmptyBody body="No verifiable claims found in that document." />
          : <div><SummaryBar summary={result.audit.summary} /><div style={{ padding: "4px 10px 10px" }}><ClaimList claims={result.audit.claims} /></div></div>
      )}
      {result.mode === "citations" && result.citations && <CitationsBody report={result.citations} />}

      {/* follow-up row */}
      <div style={{ padding: "13px 15px", borderTop: "1px solid var(--border)", background: "var(--bg-inset)" }}>
        <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 9 }}>Next</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {FOLLOW_UPS[result.mode].map((s, i) => (
            <button key={s} onClick={() => onFollowUp(s)} style={{ height: 30, padding: "0 13px", borderRadius: 999, border: i === 0 ? "1px solid var(--accent)" : "1px solid var(--border-strong)", background: i === 0 ? "var(--accent-dim)" : "var(--bg-card)", color: i === 0 ? "var(--accent-bright)" : "var(--text-primary)", cursor: "pointer", fontSize: 12, fontWeight: i === 0 ? 500 : 400 }}>
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── groundedness body ──────────────────────────────────────────────── */
function GroundednessBody({ audit }: { audit: GroundednessAudit }) {
  const { summary } = audit;
  if (summary.total_claims === 0) return <EmptyBody body="No verifiable claims found in that document." />;
  const pct = Math.round((summary.grounded / summary.total_claims) * 100);
  const scoreColor = pct >= 80 ? "var(--v-verified)" : pct >= 50 ? "var(--v-unverified)" : "var(--v-hallucination)";
  const chips = [
    { label: "Grounded",      count: summary.grounded,    color: "var(--v-verified)"     },
    { label: "Not in source", count: summary.ungrounded,  color: "var(--v-unverified)"   },
    { label: "Contradicted",  count: summary.contradicted,color: "var(--v-contradicted)" },
  ].filter((c) => c.count > 0);

  return (
    <div>
      {/* summary bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", padding: "12px 15px" }}>
        {chips.map((ch) => (
          <span key={ch.label} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 25, padding: "0 10px", borderRadius: 999, background: `color-mix(in srgb, ${ch.color} 16%, transparent)`, fontSize: 11.5 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: ch.color }} />
            <b style={{ fontWeight: 600 }}>{ch.count}</b> {ch.label}
          </span>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)" }}>Faithful</span>
          <div style={{ width: 60, height: 5, borderRadius: 3, background: "var(--bg-elev)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: scoreColor }} />
          </div>
          <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 12, fontWeight: 600, color: scoreColor }}>{pct}%</span>
        </div>
      </div>

      {/* claim rows */}
      <div style={{ padding: "4px 10px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
        {audit.claims.map((c, i) => <FaithClaimRow key={c.claim.id || i} c={c} />)}
      </div>
    </div>
  );
}

function FaithClaimRow({ c }: { c: GroundedClaim }) {
  const vs = GVERDICT[c.verdict];
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-card)", overflow: "hidden", display: "flex" }}>
      <span style={{ width: 3, flexShrink: 0, background: vs.color }} />
      <div style={{ flex: 1, minWidth: 0, padding: "12px 13px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: vs.color, boxShadow: `0 0 8px ${vs.color}`, flexShrink: 0 }} />
          <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", color: vs.color, flexShrink: 0, width: 108 }}>{vs.label}</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.45, color: "var(--text-primary)" }}>{c.claim.text}</span>
        </div>
        <div style={{ padding: "9px 11px", borderRadius: 8, background: "var(--bg-inset)", border: "1px solid var(--border-faint)", fontSize: 12, lineHeight: 1.5, color: "var(--text-secondary)" }}>{c.rationale}</div>
        {c.supporting_quote && (
          <div style={{ marginTop: 8, padding: "9px 11px 9px 13px", borderLeft: `3px solid ${vs.color}`, borderRadius: "0 8px 8px 0", background: `color-mix(in srgb, ${vs.color} 7%, transparent)` }}>
            <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 8.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>Supporting quote</div>
            <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-secondary)", fontStyle: "italic" }}>&ldquo;{c.supporting_quote}&rdquo;</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── citations body ─────────────────────────────────────────────────── */
function CitationsBody({ report }: { report: CitationsReport }) {
  if (report.claims.length === 0) return <EmptyBody body="No verifiable claims found in that document to cite." />;
  const totalFor = report.claims.reduce((n, c) => n + c.supporting.length, 0);
  const totalAgainst = report.claims.reduce((n, c) => n + c.contradicting.length, 0);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", padding: "12px 15px" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 25, padding: "0 10px", borderRadius: 999, background: "color-mix(in srgb, var(--v-verified) 16%, transparent)", fontSize: 11.5 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--v-verified)" }} />
          <b style={{ fontWeight: 600 }}>{totalFor}</b> Supporting
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 25, padding: "0 10px", borderRadius: 999, background: "color-mix(in srgb, var(--v-hallucination) 16%, transparent)", fontSize: 11.5 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--v-hallucination)" }} />
          <b style={{ fontWeight: 600 }}>{totalAgainst}</b> Contradicting
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 25, padding: "0 10px", borderRadius: 999, background: "var(--bg-inset)", border: "1px solid var(--border)", fontSize: 11.5, color: "var(--text-secondary)" }}>
          <b style={{ fontWeight: 600, color: "var(--text-primary)" }}>{report.claims.length}</b> claims
        </span>
      </div>
      <div style={{ padding: "4px 13px 14px", display: "flex", flexDirection: "column", gap: 11 }}>
        {report.claims.map((c, i) => <CitationCard key={i} c={c} />)}
      </div>
    </div>
  );
}

function CitationCard({ c }: { c: ClaimCitations }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 11, background: "var(--bg-card)", padding: 14 }}>
      <div style={{ fontSize: 13.5, lineHeight: 1.45, color: "var(--text-primary)", marginBottom: 5 }}>{c.claim}</div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 13 }}>{c.stance_summary}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11 }}>
        <CiteColumn label="Supporting" color="var(--v-verified)" cites={c.supporting} />
        <CiteColumn label="Contradicting" color="var(--v-hallucination)" cites={c.contradicting} />
      </div>
    </div>
  );
}

function CiteColumn({ label, color, cites }: { label: string; color: string; cites: ClaimCitations["supporting"] }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />
        <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 9, letterSpacing: "0.07em", textTransform: "uppercase", color }}>{label}</span>
      </div>
      {cites.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--text-faint)", fontStyle: "italic", padding: "4px 0" }}>None found.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {cites.map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noreferrer" style={{ display: "block", borderLeft: `3px solid ${color}`, borderRadius: "0 7px 7px 0", background: "var(--bg-inset)", padding: "8px 10px", textDecoration: "none" }}>
              <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10, color: "var(--accent-bright)", marginBottom: 3 }}>{s.domain || new URL(s.url).hostname}</div>
              <div style={{ fontSize: 11.5, lineHeight: 1.4, color: "var(--text-secondary)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{s.snippet}</div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── doc picker popover ─────────────────────────────────────────────── */
function DocPicker({ source, sources, onSwitchSource, query, setQuery, results, loading, selectedIds, onSearch, onPick, onClose }: {
  source: ConnectorId; sources: ConnectorId[]; onSwitchSource: (s: ConnectorId) => void;
  query: string; setQuery: (v: string) => void; results: ConnectorPageRef[]; loading: boolean;
  selectedIds: string[]; onSearch: () => void; onPick: (p: ConnectorPageRef) => void; onClose: () => void;
}) {
  return (
    <div style={{ position: "absolute", left: 18, right: 18, bottom: "calc(100% - 6px)", maxWidth: 760, margin: "0 auto", zIndex: 20 }}>
      <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", maxHeight: 340, border: "1px solid var(--border-strong)", borderRadius: 14, background: "var(--bg-elev)", boxShadow: "var(--shadow-pop)", overflow: "hidden" }}>
        {/* source tabs */}
        {sources.length > 1 && (
          <div style={{ display: "flex", gap: 2, padding: "6px 6px 0", borderBottom: "1px solid var(--border)" }}>
            {sources.map((s) => {
              const active = s === source;
              return (
                <button key={s} onClick={() => onSwitchSource(s)} style={{ display: "flex", alignItems: "center", gap: 7, height: 34, padding: "0 13px", borderRadius: "8px 8px 0 0", borderTop: active ? "2px solid var(--accent)" : "2px solid transparent", borderLeft: "none", borderRight: "none", borderBottom: "none", background: active ? "var(--bg-card)" : "transparent", color: active ? "var(--text-primary)" : "var(--text-muted)", cursor: "pointer", fontSize: 12.5, fontWeight: active ? 500 : 400 }}>
                  <ConnectorGlyph id={s} size={12} />
                  {CONNECTOR_LABEL[s]}
                </button>
              );
            })}
          </div>
        )}
        {/* search input */}
        <div style={{ padding: "11px 13px 9px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, height: 36, padding: "0 12px", borderRadius: 9, background: "var(--bg-inset)", border: "1px solid var(--border)" }}>
            <ConnectorGlyph id={source} size={13} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
              placeholder={`Search ${CONNECTOR_LABEL[source]} pages…`}
              style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--text-primary)", fontFamily: "'Geist', system-ui, sans-serif", fontSize: 13 }}
            />
            <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 9.5, color: "var(--text-faint)", cursor: "pointer" }} onClick={onClose}>Esc</span>
          </div>
        </div>
        {/* results */}
        <div className="wa-scroll" style={{ flex: 1, overflowY: "auto", padding: "0 8px 9px", display: "flex", flexDirection: "column", gap: 5 }}>
          {loading && <div style={{ padding: 14, fontSize: 12.5, color: "var(--text-muted)" }}>Searching…</div>}
          {!loading && results.length === 0 && <div style={{ padding: 14, fontSize: 12.5, color: "var(--text-muted)" }}>No docs found — type to search {CONNECTOR_LABEL[source]}.</div>}
          {results.map((p) => {
            const sel = selectedIds.includes(p.id);
            return (
              <button key={p.id} onClick={() => onPick(p)} style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "10px 11px", borderRadius: 9, border: `1px solid ${sel ? "color-mix(in srgb, var(--accent) 45%, transparent)" : "var(--border)"}`, background: sel ? "var(--accent-dim)" : "transparent", cursor: "pointer", textAlign: "left", width: "100%" }}>
                <span style={{ display: "grid", placeItems: "center", width: 18, height: 18, borderRadius: 5, background: sel ? "var(--accent)" : "transparent", border: `1.5px solid ${sel ? "var(--accent)" : "var(--border-strong)"}`, flexShrink: 0, marginTop: 1 }}>
                  {sel && <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2 5 8.6 9.5 3.4" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</span>
                    {p.last_edited && <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10, color: "var(--text-faint)", flexShrink: 0, whiteSpace: "nowrap" }}>{p.last_edited}</span>}
                  </div>
                  {p.snippet && <div style={{ fontSize: 11.5, lineHeight: 1.4, color: "var(--text-muted)", marginTop: 3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.snippet}</div>}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── connector badges (nav) ─────────────────────────────────────────── */
function ConnectorBadge({ id, status, onDisconnect }: { id: ConnectorId; status: ConnStatus; onDisconnect: () => void }) {
  if (status.connected) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 28, padding: "0 7px 0 10px", borderRadius: 8, border: "1px solid color-mix(in srgb, var(--v-verified) 38%, transparent)", background: "color-mix(in srgb, var(--v-verified) 11%, transparent)" }}>
        <ConnectorGlyph id={id} size={13} />
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--v-verified)", boxShadow: "0 0 6px var(--v-verified)" }} />
        <span style={{ fontSize: 11.5, color: "var(--text-primary)", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{status.account ?? CONNECTOR_LABEL[id]}</span>
        <button onClick={onDisconnect} title={`Disconnect ${CONNECTOR_LABEL[id]}`} style={{ display: "grid", placeItems: "center", width: 16, height: 16, borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", color: "var(--text-muted)" }}>
          <svg width="8" height="8" viewBox="0 0 10 10"><path d="M2 2 8 8 M8 2 2 8" stroke="currentColor" strokeWidth="1.4"/></svg>
        </button>
      </span>
    );
  }
  if (status.configured === false) {
    const envHint = id === "slack"
      ? "Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET to enable"
      : "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable";
    return (
      <span title={envHint} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px", borderRadius: 8, border: "1px dashed var(--border-strong)", background: "var(--bg-card)", cursor: "not-allowed" }}>
        <ConnectorGlyph id={id} size={13} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{CONNECTOR_LABEL[id]} <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10, color: "var(--v-unverified)" }}>(set up)</span></span>
      </span>
    );
  }
  return (
    <a href={`/api/connectors/${id}/authorize`} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px", borderRadius: 8, border: "1px dashed var(--border-strong)", background: "transparent", textDecoration: "none" }}>
      <ConnectorGlyph id={id} size={13} />
      <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Connect {CONNECTOR_LABEL[id]}</span>
    </a>
  );
}

/* ── connector brand glyphs (real brand SVGs) ───────────────────────── */
function ConnectorGlyph({ id, size = 14 }: { id: ConnectorId; size?: number; stroke?: string }) {
  if (id === "notion") return <NotionGlyph size={size} />;
  if (id === "google") return <GoogleDriveGlyph size={size} />;
  if (id === "gmail") return <GmailGlyph size={size} />;
  return <SlackGlyph size={size} />;
}

function NotionGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0, borderRadius: size * 0.22 }}>
      <rect x="1" y="1" width="22" height="22" rx="5" fill="#ffffff"/>
      <path d="M8 7.4v9.2M8 7.4l8 9.2M16 7.4v9.2" stroke="#0f0f0f" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function GoogleDriveGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 87.3 78" style={{ flexShrink: 0 }}>
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" fill="#00ac47"/>
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
    </svg>
  );
}

function GmailGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 52 42" style={{ flexShrink: 0 }}>
      <path d="M3.55 41.5h8V21.7L0 12.5v25.4a3.55 3.55 0 0 0 3.55 3.6z" fill="#4285f4"/>
      <path d="M40.45 41.5h8a3.55 3.55 0 0 0 3.55-3.6V12.5l-11.55 9.2z" fill="#34a853"/>
      <path d="M40.45 4.1v17.6L52 12.5V5.9c0-3.32-3.79-5.21-6.45-3.22z" fill="#fbbc04"/>
      <path d="M11.55 21.7V4.1L26 14.9 40.45 4.1v17.6L26 32.5z" fill="#ea4335"/>
      <path d="M0 5.9v6.6l11.55 9.2V4.1L6.45 2.68C3.79.69 0 2.58 0 5.9z" fill="#c5221f"/>
    </svg>
  );
}

function SlackGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 122.8 122.8" style={{ flexShrink: 0 }}>
      <path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9z" fill="#e01e5a"/>
      <path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9z" fill="#36c5f0"/>
      <path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9z" fill="#2eb67d"/>
      <path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9z" fill="#ecb22e"/>
    </svg>
  );
}

/* ── misc helpers ───────────────────────────────────────────────────── */
function SearchGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="6" cy="6" r="4.2" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M9.2 9.2 12 12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}

function GhostBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ height: 27, padding: "0 11px", borderRadius: 7, border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: 11.5 }}>
      {children}
    </button>
  );
}

function EmptyBody({ body }: { body: string }) {
  return <div style={{ padding: 30, textAlign: "center", fontSize: 14, fontStyle: "italic", color: "var(--text-muted)" }}>{body}</div>;
}

/* ── markdown report ────────────────────────────────────────────────── */
function buildMarkdownReport(result: WorkspaceRunResult): string {
  const lines: string[] = [];
  lines.push(`# Groundtruth report — ${MODE_LABEL[result.mode]}`);
  lines.push(""); lines.push(`_${result.note}_`); lines.push("");
  lines.push(`Generated ${new Date().toLocaleString()}`); lines.push("");
  lines.push("## Documents");
  for (const d of result.used) lines.push(`- **${d.title}** (${d.role})${d.url ? ` — ${d.url}` : ""}`);
  lines.push("");

  if (result.mode === "groundedness" && result.groundedness) {
    const s = result.groundedness.summary;
    lines.push("## Faithfulness");
    lines.push(`- Grounded: ${s.grounded} · Not in source: ${s.ungrounded} · Contradicted: ${s.contradicted} (of ${s.total_claims})`);
    lines.push("");
    result.groundedness.claims.forEach((c, i) => {
      lines.push(`### ${i + 1}. [${GVERDICT[c.verdict].label}] ${c.claim.text}`);
      lines.push(`- Confidence: ${Math.round(c.confidence * 100)}%`);
      lines.push(`- Rationale: ${c.rationale}`);
      if (c.supporting_quote) lines.push(`- Source quote: "${c.supporting_quote}"`);
      lines.push("");
    });
  } else if (result.mode === "factcheck" && result.audit) {
    const s = result.audit.summary;
    lines.push("## Fact-check");
    lines.push(`- Verified: ${s.verified} · Unverified: ${s.unverified_plausible} · Contradicted: ${s.contradicted} · Hallucination: ${s.likely_hallucination} (of ${s.total_claims})`);
    lines.push("");
    result.audit.claims.forEach((c, i) => {
      lines.push(`### ${i + 1}. [${c.consensus_verdict}] ${c.claim.text}`);
      lines.push(`- Confidence: ${Math.round(c.consensus_confidence * 100)}%`);
      lines.push("");
    });
  } else if (result.mode === "citations" && result.citations) {
    lines.push("## Citations");
    lines.push("");
    result.citations.claims.forEach((c, i) => {
      lines.push(`### ${i + 1}. ${c.claim}`);
      lines.push(`_${c.stance_summary}_`); lines.push("");
      lines.push(`**Supporting (${c.supporting.length})**`);
      if (!c.supporting.length) lines.push("- None found.");
      c.supporting.forEach((s) => lines.push(`- [${s.title || s.domain}](${s.url})`));
      lines.push("");
      lines.push(`**Contradicting (${c.contradicting.length})**`);
      if (!c.contradicting.length) lines.push("- None found.");
      c.contradicting.forEach((s) => lines.push(`- [${s.title || s.domain}](${s.url})`));
      lines.push("");
    });
  }
  return lines.join("\n");
}
