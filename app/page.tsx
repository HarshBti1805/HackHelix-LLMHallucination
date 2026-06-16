"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type {
  AuditRequestBody,
  ChatMessage,
  ChatModel,
  ChatRequestBody,
  ChatResponseBody,
  DehallucinateRequestBody,
  DehallucinateResponseBody,
  MessageAudit,
  Provider,
} from "@/types";
import { ClaimList } from "@/components/audit/ClaimList";
import { SummaryBar } from "@/components/audit/SummaryBar";
import { AuditHeadlineBar } from "@/components/audit/AuditHeadlineBar";
import { failedClaimCount } from "@/components/audit/verdict";
import { ComparisonSidebar } from "@/components/comparison/ComparisonSidebar";
import { useTheme, PALETTE_META, type Palette } from "@/components/ThemeProvider";

const PROVIDER_MODELS: Record<Provider, ChatModel[]> = {
  openai: ["gpt-4o", "gpt-4o-mini"],
  gemini: ["gemini-2.5-flash"],
  anthropic: ["claude-haiku-4-5"],
};

const PROVIDER_LABEL: Record<Provider, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  anthropic: "Anthropic",
};

interface DemoPrompt { label: string; prompt: string; color: string; tag: string }
const DEMO_PROMPTS: DemoPrompt[] = [
  {
    label: "Summarize the findings of Johnson et al. 2021 on intermittent fasting.",
    prompt: "Summarize the findings of Johnson et al. 2021 on intermittent fasting.",
    color: "var(--v-hallucination)",
    tag: "citation hallucination",
  },
  {
    label: "Tesla milestones — three specific, dated events.",
    prompt: "Tell me three specific, dated milestones in the history of Tesla, Inc., including the names of the people involved and the cities where the events took place.",
    color: "var(--v-contradicted)",
    tag: "contested claim",
  },
  {
    label: "How tall is the Eiffel Tower including its antenna?",
    prompt: "How tall is the Eiffel Tower in metres, including its antenna?",
    color: "var(--v-verified)",
    tag: "benign truth",
  },
  {
    label: "Who won the 2023 Nobel Prize in Physics and for what?",
    prompt: "Who won the 2023 Nobel Prize in Physics, and for what?",
    color: "var(--v-unverified)",
    tag: "fact check",
  },
];

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

function makeUserMessage(content: string): ChatMessage {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role: "user",
    content,
    timestamp: Date.now(),
  };
}

// ─── SVGs ────────────────────────────────────────────────────────────────────
function BrandSVG({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden="true">
      <circle cx="13" cy="13" r="11.2" stroke="var(--border-strong)" strokeWidth="1"/>
      <circle cx="13" cy="4.6" r="2.1" fill="var(--v-contradicted)"/>
      <circle cx="5.7" cy="17.5" r="2.1" fill="var(--accent)"/>
      <circle cx="20.3" cy="17.5" r="2.1" fill="var(--v-crosscheck)"/>
      <circle cx="13" cy="13" r="2.6" fill="var(--text-primary)"/>
      <path d="M13 6.7 13 10.4 M7.5 16.3 11 14.3 M18.5 16.3 15 14.3" stroke="var(--text-muted)" strokeWidth="1"/>
    </svg>
  );
}

function AssistantAvatar() {
  return (
    <div style={{
      flexShrink: 0, width: 30, height: 30, borderRadius: 9,
      background: "var(--bg-card)", border: "1px solid var(--border)",
      display: "grid", placeItems: "center",
    }}>
      <svg width="17" height="17" viewBox="0 0 26 26" fill="none">
        <circle cx="13" cy="4.6" r="2" fill="var(--v-contradicted)"/>
        <circle cx="5.7" cy="17.5" r="2" fill="var(--accent)"/>
        <circle cx="20.3" cy="17.5" r="2" fill="var(--v-crosscheck)"/>
        <circle cx="13" cy="13" r="2.4" fill="var(--text-primary)"/>
      </svg>
    </div>
  );
}

// ─── Markdown renderer ────────────────────────────────────────────────────────
function renderInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(`+)([^`]+?)\1|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|(?<!\*)\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)|(?<!_)_(?!\s)([^_\n]+?)(?<!\s)_(?!_)/g;
  let lastIndex = 0, key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) out.push(text.slice(lastIndex, m.index));
    if (m[2] !== undefined) {
      out.push(<code key={key++} style={{fontFamily:"'Geist Mono',monospace",fontSize:"0.88em",background:"var(--bg-inset)",padding:"1px 4px",borderRadius:3}}>{m[2]}</code>);
    } else if (m[3] !== undefined || m[4] !== undefined) {
      out.push(<strong key={key++}>{m[3] ?? m[4]}</strong>);
    } else if (m[5] !== undefined || m[6] !== undefined) {
      out.push(<em key={key++}>{m[5] ?? m[6]}</em>);
    }
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out;
}

function MarkdownLite({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  const listRe = /^\s*([-*•]|\d+\.)\s+(.*)$/;
  const headingRe = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
  let i = 0, key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }
    const heading = headingRe.exec(line);
    if (heading) {
      const level = heading[1].length;
      const fs = level <= 2 ? 16 : level === 3 ? 14.5 : 13.5;
      blocks.push(<div key={key++} style={{fontWeight:600,fontSize:fs,margin:"14px 0 6px",fontFamily:"'Space Grotesk',sans-serif"}}>{renderInline(heading[2])}</div>);
      i++; continue;
    }
    if (listRe.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && listRe.test(lines[i])) {
        items.push(listRe.exec(lines[i])![2]); i++;
      }
      const liNodes = items.map((it, idx) => <li key={idx}>{renderInline(it)}</li>);
      blocks.push(ordered
        ? <ol key={key++} style={{margin:"8px 0",paddingLeft:20,display:"flex",flexDirection:"column",gap:4}}>{liNodes}</ol>
        : <ul key={key++} style={{margin:"8px 0",paddingLeft:20,display:"flex",flexDirection:"column",gap:4}}>{liNodes}</ul>
      );
      continue;
    }
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !headingRe.test(lines[i]) && !listRe.test(lines[i])) {
      paraLines.push(lines[i]); i++;
    }
    blocks.push(<p key={key++} style={{margin:"6px 0",whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{renderInline(paraLines.join("\n"))}</p>);
  }
  return <>{blocks}</>;
}

// ─── Audit skeleton ───────────────────────────────────────────────────────────
function AuditSkeleton() {
  return (
    <div style={{padding:"16px 18px"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <span style={{position:"relative",width:18,height:18,display:"grid",placeItems:"center"}}>
          <svg width="18" height="18" viewBox="0 0 18 18" style={{animation:"gt-spin 1.1s linear infinite"}}>
            <circle cx="9" cy="9" r="7" stroke="var(--accent-dim)" strokeWidth="2" fill="none"/>
            <path d="M9 2 A7 7 0 0 1 16 9" stroke="var(--accent)" strokeWidth="2" fill="none" strokeLinecap="round"/>
          </svg>
        </span>
        <span style={{fontFamily:"'Geist Mono',monospace",fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--text-secondary)"}}>Auditing claims</span>
        <div style={{display:"flex",gap:5,marginLeft:2}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:"var(--v-contradicted)",animation:"gt-node 1.2s ease-in-out infinite",display:"inline-block"}}/>
          <span style={{width:6,height:6,borderRadius:"50%",background:"var(--accent)",animation:"gt-node 1.2s ease-in-out infinite .25s",display:"inline-block"}}/>
          <span style={{width:6,height:6,borderRadius:"50%",background:"var(--v-crosscheck)",animation:"gt-node 1.2s ease-in-out infinite .5s",display:"inline-block"}}/>
        </div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {[0, 0.15, 0.3].map((delay) => (
          <div key={delay} style={{height:38,borderRadius:9,background:"linear-gradient(90deg,var(--bg-inset) 25%,var(--bg-elev) 50%,var(--bg-inset) 75%)",backgroundSize:"200% 100%",animation:`gt-shimmer 1.4s linear infinite ${delay}s`}}/>
        ))}
      </div>
    </div>
  );
}

function AuditError({ message }: { message: string }) {
  return (
    <div style={{padding:"12px 16px",display:"flex",alignItems:"center",gap:8,color:"var(--text-muted)",fontSize:12}}>
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 1.5 1.5 12.5 H12.5 Z" stroke="var(--v-contradicted)" strokeWidth="1.2" strokeLinejoin="round"/><path d="M7 5.5 V8.5 M7 10.3 V10.4" stroke="var(--v-contradicted)" strokeWidth="1.3" strokeLinecap="round"/></svg>
      Audit unavailable ({message})
    </div>
  );
}

function AuditEmpty() {
  return (
    <div style={{padding:"12px 16px",color:"var(--text-muted)",fontSize:12}}>
      No verifiable claims found in this response.
    </div>
  );
}

// ─── Audit panel ──────────────────────────────────────────────────────────────
interface AuditPanelProps {
  messageId: string;
  isPending: boolean;
  audit: MessageAudit | undefined;
  errorMessage: string | undefined;
  onDehallucinate?: () => void;
  isDehallucPending?: boolean;
  dehallucError?: string;
}

function AuditPanel({ isPending, audit, errorMessage, onDehallucinate, isDehallucPending, dehallucError }: AuditPanelProps) {
  if (isPending) return (
    <div style={{marginTop:16,border:"1px solid var(--border)",borderRadius:13,background:"var(--bg-raised)",overflow:"hidden",boxShadow:"var(--shadow-card)"}}>
      <AuditSkeleton/>
    </div>
  );
  if (errorMessage) return (
    <div style={{marginTop:16,border:"1px solid var(--border)",borderRadius:13,background:"var(--bg-raised)",overflow:"hidden"}}>
      <AuditError message={errorMessage}/>
    </div>
  );
  if (!audit) return null;
  if (audit.claims.length === 0) return (
    <div style={{marginTop:16,border:"1px solid var(--border)",borderRadius:13,background:"var(--bg-raised)",overflow:"hidden"}}>
      <AuditEmpty/>
    </div>
  );

  const failed = failedClaimCount(audit);
  const showRegen = failed > 0 && Boolean(onDehallucinate);

  return (
    <div style={{marginTop:16,border:"1px solid var(--border)",borderRadius:13,background:"var(--bg-raised)",overflow:"hidden",boxShadow:"var(--shadow-card)"}}>
      <AuditHeadlineBar summary={audit.summary} />
      <SummaryBar
        summary={audit.summary}
        failedCount={failed}
        showDehallucinate={showRegen}
        isDehallucPending={isDehallucPending}
        dehallucError={dehallucError}
        onDehallucinate={onDehallucinate}
      />
      <div style={{padding:8,display:"flex",flexDirection:"column",gap:7}}>
        <ClaimList claims={audit.claims}/>
      </div>
    </div>
  );
}

// ─── Dehallucinate modal ──────────────────────────────────────────────────────
interface DehallucinateModalProps {
  open: boolean;
  suggestedPrompt: string | null;
  editedPrompt: string;
  onEdit: (v: string) => void;
  onCancel: () => void;
  onSend: () => void;
}

function DehallucinateModal({ open, suggestedPrompt, editedPrompt, onEdit, onCancel, onSend }: DehallucinateModalProps) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); }};
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [open, onCancel]);

  if (!open || suggestedPrompt === null) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{position:"fixed",inset:0,zIndex:50,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.6)",backdropFilter:"blur(8px)",padding:"24px 16px"}}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display:"flex",flexDirection:"column",gap:0,width:"100%",maxWidth:680,maxHeight:"88vh",
          borderRadius:16,border:"1px solid var(--border-strong)",background:"var(--bg-card)",
          boxShadow:"var(--shadow-pop)",overflow:"hidden",animation:"gt-modalin .22s ease both",
        }}
      >
        {/* header */}
        <div style={{display:"flex",alignItems:"flex-start",gap:12,padding:"18px 20px 14px",borderBottom:"1px solid var(--border)"}}>
          <div style={{display:"grid",placeItems:"center",width:34,height:34,borderRadius:9,background:"color-mix(in srgb, var(--v-hallucination) 14%, transparent)",color:"var(--v-hallucination)",flexShrink:0}}>
            <svg width="15" height="15" viewBox="0 0 14 14" fill="none"><path d="M7 1.5 1.5 12.5 H12.5 Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M7 5.5 V8.5 M7 10.3 V10.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
          </div>
          <div style={{flex:1}}>
            <div style={{fontFamily:"'Space Grotesk',sans-serif",fontWeight:600,fontSize:15}}>Review the regeneration prompt</div>
            <p style={{fontSize:12,lineHeight:1.5,color:"var(--text-secondary)",marginTop:4}}>
              The auditor built this from the failed claims and their evidence. Edit freely — this will become your next message.
            </p>
          </div>
          <button
            onClick={onCancel}
            aria-label="Close"
            style={{width:26,height:26,display:"grid",placeItems:"center",borderRadius:7,border:"1px solid var(--border)",background:"transparent",cursor:"pointer",color:"var(--text-muted)",flexShrink:0}}
          >
            <svg width="11" height="11" viewBox="0 0 11 11"><path d="M2 2 9 9 M9 2 2 9" stroke="currentColor" strokeWidth="1.3"/></svg>
          </button>
        </div>

        {/* textarea with fake line numbers */}
        <div style={{flex:1,display:"flex",minHeight:260,overflow:"hidden"}}>
          <div style={{width:36,background:"var(--bg-inset)",borderRight:"1px solid var(--border-faint)",padding:"14px 0",display:"flex",flexDirection:"column",alignItems:"center",gap:0,flexShrink:0}}>
            {Array.from({length: Math.max(editedPrompt.split("\n").length, 8)}, (_, i) => (
              <div key={i} style={{fontFamily:"'Geist Mono',monospace",fontSize:10,color:"var(--text-faint)",lineHeight:"20px",height:20,textAlign:"center",width:"100%"}}>{i + 1}</div>
            ))}
          </div>
          <textarea
            value={editedPrompt}
            onChange={(e) => onEdit(e.target.value)}
            spellCheck={false}
            style={{flex:1,resize:"none",border:"none",outline:"none",background:"transparent",color:"var(--text-primary)",fontFamily:"'Geist Mono',monospace",fontSize:12.5,lineHeight:"20px",padding:14,overflowY:"auto"}}
          />
        </div>

        {/* footer */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"13px 20px",borderTop:"1px solid var(--border)",background:"var(--bg-inset)"}}>
          <span style={{fontSize:11.5,color:"var(--text-muted)"}}>On Send, this becomes your next message and the response will be re-audited.</span>
          <div style={{display:"flex",gap:9}}>
            <button
              onClick={onCancel}
              style={{height:34,padding:"0 14px",borderRadius:9,border:"1px solid var(--border)",background:"transparent",cursor:"pointer",color:"var(--text-secondary)",fontSize:13,fontWeight:500}}
            >
              Cancel
            </button>
            <button
              onClick={onSend}
              style={{height:34,padding:"0 16px",borderRadius:9,border:"none",background:"var(--accent)",cursor:"pointer",color:"#fff",fontSize:13,fontWeight:600,display:"flex",alignItems:"center",gap:7}}
            >
              <svg width="14" height="14" viewBox="0 0 17 17" fill="none"><path d="M8.5 14V3.5M8.5 3.5 4 8M8.5 3.5 13 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Palette picker dropdown ──────────────────────────────────────────────────
const PALETTES: Palette[] = ["iris", "aurora", "orchid", "cobalt", "sandstone", "indigo", "steel"];

function PalettePicker() {
  const { palette, setPalette } = useTheme();
  const [open, setOpen] = useState(false);
  const meta = PALETTE_META[palette];

  return (
    <div style={{position:"relative"}}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Color scheme"
        style={{display:"flex",alignItems:"center",gap:8,height:32,padding:"0 11px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg-card)",cursor:"pointer",color:"var(--text-primary)"}}
      >
        <span style={{width:12,height:12,borderRadius:"50%",background:meta.color,boxShadow:meta.glow,display:"inline-block"}}/>
        <span style={{fontFamily:"'Geist Mono',monospace",fontSize:10.5,letterSpacing:"0.03em",color:"var(--text-secondary)"}}>{meta.label}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" style={{opacity:.5}}><path d="M2 3.5 5 6.5 8 3.5" stroke="currentColor" strokeWidth="1.3" fill="none"/></svg>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{position:"fixed",inset:0,zIndex:55}}/>
          <div style={{position:"absolute",top:40,right:0,zIndex:60,width:180,padding:6,background:"var(--bg-elev)",border:"1px solid var(--border-strong)",borderRadius:12,boxShadow:"var(--shadow-pop)",display:"flex",flexDirection:"column",gap:1,animation:"gt-claimin .16s ease both"}}>
            <div style={{fontFamily:"'Geist Mono',monospace",fontSize:9,letterSpacing:"0.12em",textTransform:"uppercase",color:"var(--text-muted)",padding:"5px 8px"}}>Color scheme</div>
            {PALETTES.map((p) => {
              const m = PALETTE_META[p];
              return (
                <button
                  key={p}
                  onClick={() => { setPalette(p); setOpen(false); }}
                  style={{display:"flex",alignItems:"center",gap:10,height:31,padding:"0 9px",borderRadius:7,border:"none",cursor:"pointer",background:p === palette ? "var(--bg-card)" : "transparent",color:"var(--text-primary)",textAlign:"left"}}
                >
                  <span style={{width:13,height:13,borderRadius:"50%",background:m.color,boxShadow:p === palette ? m.glow : "none",flexShrink:0,display:"inline-block"}}/>
                  <span style={{flex:1,fontSize:12.5}}>{m.label}</span>
                  {p === palette && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5 5 9 9.5 3.5" stroke={m.color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Home() {
  const { theme, toggleTheme } = useTheme();
  const [provider, setProvider] = useState<Provider>("openai");
  const [model, setModel] = useState<ChatModel>("gpt-4o");
  const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [crossCheckEnabled, setCrossCheckEnabled] = useState(true);
  const [audits, setAudits] = useState<Record<string, MessageAudit>>({});
  const [pendingAudits, setPendingAudits] = useState<Set<string>>(() => new Set());
  const [auditErrors, setAuditErrors] = useState<Record<string, string>>({});
  const [dehallucinateModal, setDehallucinateModal] = useState<{open: boolean; messageId: string | null; suggestedPrompt: string | null; editedPrompt: string}>({open: false, messageId: null, suggestedPrompt: null, editedPrompt: ""});
  const [dehallucPending, setDehallucPending] = useState<Set<string>>(() => new Set());
  const [dehallucErrors, setDehallucErrors] = useState<Record<string, string>>({});
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [comparisonTarget, setComparisonTarget] = useState<{beforeId: string; afterId: string} | null>(null);
  const autoOpenedForRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const stickyBottomRef = useRef(true);

  // Provider cycle
  function cycleProvider() {
    const providers = Object.keys(PROVIDER_MODELS) as Provider[];
    const idx = providers.indexOf(provider);
    const next = providers[(idx + 1) % providers.length];
    setProvider(next);
    setModel(PROVIDER_MODELS[next][0]);
  }

  // Query param ?prompt=
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const incoming = params.get("prompt");
    if (!incoming) return;
    setInput(incoming);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.scrollIntoView({ behavior: "smooth", block: "center" });
      const active = document.activeElement;
      if (!(active instanceof HTMLElement && active !== ta && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable))) {
        ta.focus({ preventScroll: true });
        const len = ta.value.length;
        ta.setSelectionRange(len, len);
      }
    });
    params.delete("prompt");
    const remaining = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (remaining ? `?${remaining}` : ""));
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }, [input]);

  // Scroll tracking
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
      stickyBottomRef.current = nearBottom;
      setIsAtBottom(nearBottom);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  function scrollToBottom(behavior: ScrollBehavior = "smooth") {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior });
  }

  useEffect(() => { if (stickyBottomRef.current) scrollToBottom(); }, [messages, pending]);

  // Auto-open comparison sidebar
  useEffect(() => {
    let latestAfter: ChatMessage | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.regenerates_message_id) { latestAfter = m; break; }
    }
    if (!latestAfter?.regenerates_message_id) return;
    const afterId = latestAfter.id, beforeId = latestAfter.regenerates_message_id;
    if (!audits[beforeId] && !auditErrors[beforeId]) return;
    if (!audits[afterId] && !auditErrors[afterId]) return;
    if (autoOpenedForRef.current.has(afterId)) return;
    autoOpenedForRef.current.add(afterId);
    setComparisonTarget({ beforeId, afterId });
    setComparisonOpen(true);
  }, [messages, audits, auditErrors]);

  // ⌘K focus, Esc clear
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        textareaRef.current?.focus();
        return;
      }
      if (e.key === "Escape" && document.activeElement === textareaRef.current) {
        if (input.length > 0) { e.preventDefault(); setInput(""); } else textareaRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [input]);

  async function copyAssistantMessage(id: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(id);
      setTimeout(() => setCopiedMessageId((c) => c === id ? null : c), 1600);
    } catch { setError("Clipboard unavailable."); }
  }

  function requestAudit(messageId: string, content: string, originalPrompt?: string) {
    setPendingAudits((prev) => { const s = new Set(prev); s.add(messageId); return s; });
    setAuditErrors((prev) => { if (!(messageId in prev)) return prev; const n = {...prev}; delete n[messageId]; return n; });
    const body: AuditRequestBody = { message_id: messageId, content, cross_check: crossCheckEnabled, original_prompt: originalPrompt };
    fetch("/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(async (res) => {
        if (!res.ok) { const e = await res.json().catch(() => ({})) as {error?: string}; throw new Error(e.error ?? `Audit failed: ${res.status}`); }
        return (await res.json()) as MessageAudit;
      })
      .then((audit) => setAudits((prev) => ({ ...prev, [messageId]: audit })))
      .catch((err: unknown) => { setAuditErrors((prev) => ({ ...prev, [messageId]: err instanceof Error ? err.message : "Audit unavailable" })); })
      .finally(() => setPendingAudits((prev) => { if (!prev.has(messageId)) return prev; const s = new Set(prev); s.delete(messageId); return s; }));
  }

  function findOriginalUserMessage(assistantId: string): ChatMessage | null {
    const idx = messages.findIndex((m) => m.id === assistantId);
    if (idx < 0) return null;
    for (let i = idx - 1; i >= 0; i--) { if (messages[i].role === "user") return messages[i]; }
    return null;
  }

  function requestDehallucinate(messageId: string) {
    const assistantMsg = messages.find((m) => m.id === messageId);
    const audit = audits[messageId];
    const originalUser = findOriginalUserMessage(messageId);
    if (!assistantMsg || !audit || !originalUser) {
      setDehallucErrors((prev) => ({ ...prev, [messageId]: "Missing message, audit, or original user prompt." }));
      return;
    }
    setDehallucPending((prev) => { const s = new Set(prev); s.add(messageId); return s; });
    setDehallucErrors((prev) => { if (!(messageId in prev)) return prev; const n = {...prev}; delete n[messageId]; return n; });
    const body: DehallucinateRequestBody = { originalUserMessage: originalUser.content, flawedResponse: assistantMsg.content, audit };
    fetch("/api/dehallucinate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(async (res) => {
        if (!res.ok) { const e = await res.json().catch(() => ({})) as {error?: string}; throw new Error(e.error ?? `Dehallucinate failed: ${res.status}`); }
        return (await res.json()) as DehallucinateResponseBody;
      })
      .then(({ suggested_prompt }) => setDehallucinateModal({ open: true, messageId, suggestedPrompt: suggested_prompt, editedPrompt: suggested_prompt }))
      .catch((err: unknown) => setDehallucErrors((prev) => ({ ...prev, [messageId]: err instanceof Error ? err.message : "Dehallucinate failed" })))
      .finally(() => setDehallucPending((prev) => { if (!prev.has(messageId)) return prev; const s = new Set(prev); s.delete(messageId); return s; }));
  }

  function closeDehallucModal() {
    setDehallucinateModal({ open: false, messageId: null, suggestedPrompt: null, editedPrompt: "" });
  }

  function sendDehallucPrompt() {
    const text = dehallucinateModal.editedPrompt;
    const targetId = dehallucinateModal.messageId;
    closeDehallucModal();
    if (!text.trim() || !targetId) return;
    void sendUserMessage(text, { regeneratesMessageId: targetId });
  }

  async function sendUserMessage(text: string, opts?: { regeneratesMessageId?: string }) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    const userMsg: ChatMessage = { ...makeUserMessage(trimmed), regenerates_message_id: opts?.regeneratesMessageId };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setPending(true);
    setError(null);
    try {
      const body: ChatRequestBody = { messages: nextMessages.map((m) => ({ role: m.role, content: m.content })), provider, model };
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const e = await res.json().catch(() => ({})) as {error?: string}; throw new Error(e.error ?? `Request failed: ${res.status}`); }
      const data = (await res.json()) as ChatResponseBody;
      const assistantMsg: ChatMessage = { ...data.message, regenerates_message_id: opts?.regeneratesMessageId };
      setMessages((prev) => [...prev, assistantMsg]);
      requestAudit(assistantMsg.id, assistantMsg.content, trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setPending(false);
    }
  }

  function sendMessage(text: string) { setInput(""); void sendUserMessage(text); }
  function loadDemoPrompt(prompt: string) { setInput(prompt); requestAnimationFrame(() => textareaRef.current?.focus()); }
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }

  const hasMessages = messages.length > 0;
  const canShowComparison = Boolean(comparisonTarget);
  const beforeMessage = comparisonTarget ? messages.find((m) => m.id === comparisonTarget.beforeId) : undefined;
  const afterMessage = comparisonTarget ? messages.find((m) => m.id === comparisonTarget.afterId) : undefined;

  // Audit status dot
  const anyPending = pendingAudits.size > 0;
  const statusDotStyle: React.CSSProperties = anyPending
    ? { width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", animation: "gt-statusglow 1.6s ease-in-out infinite", display: "inline-block" }
    : { width: 8, height: 8, borderRadius: "50%", background: "var(--text-faint)", display: "inline-block" };

  const NAV_ITEMS = [
    { href: "/document", label: "Document" },
    { href: "/guardrail", label: "Guardrail" },
    { href: "/verify", label: "Verify" },
    { href: "/workspace", label: "Workspace" },
    { href: "/benchmark", label: "Benchmark" },
  ];

  return (
    <div style={{height:"100vh",display:"flex",flexDirection:"column",background:"var(--bg-base)",color:"var(--text-primary)"}}>

      {/* ===== COCKPIT HEADER ===== */}
      <header style={{position:"sticky",top:0,zIndex:40,display:"flex",alignItems:"center",gap:13,height:56,padding:"0 16px",background:"color-mix(in srgb, var(--bg-base) 86%, transparent)",backdropFilter:"blur(14px)",borderBottom:"1px solid var(--border)",flexShrink:0}}>
        {/* brand */}
        <div style={{display:"flex",alignItems:"center",gap:11,flexShrink:0}}>
          <BrandSVG size={26}/>
          <span style={{fontFamily:"'Space Grotesk',sans-serif",fontWeight:600,fontSize:16,letterSpacing:"-0.01em"}}>Groundtruth</span>
        </div>

        {/* nav */}
        <nav style={{display:"flex",alignItems:"center",gap:4,marginLeft:6}}>
          {NAV_ITEMS.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              style={{fontSize:12.5,color:"var(--text-secondary)",padding:"6px 11px",borderRadius:7,background:"transparent",border:"none",cursor:"pointer",fontFamily:"'Geist',sans-serif",textDecoration:"none",transition:"color .15s"}}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div style={{flex:1}}/>

        {/* provider selector */}
        <div style={{position:"relative"}}>
          <button
            onClick={() => setProviderDropdownOpen((v) => !v)}
            style={{display:"flex",alignItems:"center",gap:8,height:32,padding:"0 11px",background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:8,cursor:"pointer",color:"var(--text-primary)"}}
          >
            <span style={{width:7,height:7,borderRadius:"50%",background:"var(--v-verified)",boxShadow:"0 0 6px var(--v-verified)",display:"inline-block"}}/>
            <span style={{fontFamily:"'Geist Mono',monospace",fontSize:11.5,letterSpacing:"0.02em"}}>{PROVIDER_LABEL[provider]}</span>
            <span style={{color:"var(--text-faint)",fontSize:10}}>/</span>
            <span style={{fontFamily:"'Geist Mono',monospace",fontSize:11.5,color:"var(--text-secondary)"}}>{model}</span>
            <svg width="10" height="10" viewBox="0 0 10 10" style={{opacity:.5}}><path d="M2 3.5 5 6.5 8 3.5" stroke="currentColor" strokeWidth="1.3" fill="none"/></svg>
          </button>
          {providerDropdownOpen && (
            <>
              <div onClick={() => setProviderDropdownOpen(false)} style={{position:"fixed",inset:0,zIndex:55}}/>
              <div style={{position:"absolute",top:40,right:0,zIndex:60,width:200,padding:6,background:"var(--bg-elev)",border:"1px solid var(--border-strong)",borderRadius:12,boxShadow:"var(--shadow-pop)",animation:"gt-claimin .16s ease both"}}>
                {(Object.entries(PROVIDER_MODELS) as [Provider, ChatModel[]][]).flatMap(([p, models]) =>
                  models.map((m) => (
                    <button
                      key={`${p}-${m}`}
                      onClick={() => { setProvider(p); setModel(m); setProviderDropdownOpen(false); }}
                      style={{display:"flex",alignItems:"center",gap:10,width:"100%",height:31,padding:"0 9px",borderRadius:7,border:"none",cursor:"pointer",background:provider === p && model === m ? "var(--bg-card)" : "transparent",color:"var(--text-primary)",textAlign:"left"}}
                    >
                      <span style={{fontFamily:"'Geist Mono',monospace",fontSize:11.5,flex:1}}>{PROVIDER_LABEL[p]}</span>
                      <span style={{fontFamily:"'Geist Mono',monospace",fontSize:10.5,color:"var(--text-secondary)"}}>{m}</span>
                      {provider === p && model === m && (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5 5 9 9.5 3.5" stroke="var(--accent)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      )}
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* cross-check toggle */}
        <button
          onClick={() => setCrossCheckEnabled((v) => !v)}
          aria-label="Toggle cross-check"
          style={{display:"flex",alignItems:"center",gap:7,height:32,padding:"0 11px",background:crossCheckEnabled ? "color-mix(in srgb, var(--v-crosscheck) 12%, transparent)" : "var(--bg-card)",border:`1px solid ${crossCheckEnabled ? "color-mix(in srgb, var(--v-crosscheck) 40%, transparent)" : "var(--border)"}`,borderRadius:8,cursor:"pointer",color:crossCheckEnabled ? "var(--v-crosscheck)" : "var(--text-muted)"}}
        >
          <span style={{width:7,height:7,borderRadius:"50%",background:crossCheckEnabled ? "var(--v-crosscheck)" : "var(--text-faint)",boxShadow:crossCheckEnabled ? "0 0 6px var(--v-crosscheck)" : "none",display:"inline-block"}}/>
          <span style={{fontFamily:"'Geist Mono',monospace",fontSize:10.5,letterSpacing:"0.06em",textTransform:"uppercase"}}>Cross-check</span>
        </button>

        {/* audit status */}
        <div
          title={anyPending ? "Audit in progress" : "Idle"}
          style={{width:32,height:32,display:"grid",placeItems:"center",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg-card)"}}
        >
          <span style={statusDotStyle}/>
        </div>

        {/* palette picker */}
        <PalettePicker/>

        {/* theme toggle */}
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          style={{width:32,height:32,display:"grid",placeItems:"center",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg-card)",cursor:"pointer",color:"var(--text-secondary)",fontSize:14}}
        >
          {theme === "dark" ? "☽" : "☀"}
        </button>

        {/* comparison toggle */}
        {canShowComparison && (
          <button
            onClick={() => setComparisonOpen((v) => !v)}
            aria-label={comparisonOpen ? "Hide comparison" : "Show comparison"}
            style={{display:"flex",alignItems:"center",gap:7,height:32,padding:"0 11px",background:comparisonOpen ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "var(--bg-card)",border:`1px solid ${comparisonOpen ? "color-mix(in srgb, var(--accent) 40%, transparent)" : "var(--border)"}`,borderRadius:8,cursor:"pointer",color:comparisonOpen ? "var(--accent)" : "var(--text-muted)"}}
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M2 7.5 H13 M9.5 4 13 7.5 9.5 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <span style={{fontFamily:"'Geist Mono',monospace",fontSize:10.5,letterSpacing:"0.03em"}}>Diff</span>
          </button>
        )}
      </header>

      {/* ===== MAIN CONTENT + SIDEBAR ===== */}
      <div style={{flex:1,display:"flex",minHeight:0}}>
        <main style={{flex:1,display:"flex",flexDirection:"column",minWidth:0,minHeight:0,position:"relative"}}>

          {/* EMPTY STATE */}
          {!hasMessages ? (
            <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"40px 24px 28px",position:"relative",overflow:"auto"}}>
              <div style={{position:"absolute",inset:0,backgroundImage:"radial-gradient(circle at 50% 38%, var(--accent-dim), transparent 55%)",pointerEvents:"none"}}/>

              {/* hero mark */}
              <div style={{position:"relative",width:128,height:128,display:"grid",placeItems:"center",marginBottom:30}}>
                <span style={{position:"absolute",width:104,height:104,borderRadius:"50%",border:"1px solid var(--accent)",opacity:.18,animation:"gt-ring 3.4s ease-out infinite",display:"block"}}/>
                <span style={{position:"absolute",width:104,height:104,borderRadius:"50%",border:"1px solid var(--accent)",opacity:.18,animation:"gt-ring 3.4s ease-out infinite 1.13s",display:"block"}}/>
                <span style={{position:"absolute",width:104,height:104,borderRadius:"50%",border:"1px solid var(--accent)",opacity:.18,animation:"gt-ring 3.4s ease-out infinite 2.26s",display:"block"}}/>
                <svg width="128" height="128" viewBox="0 0 128 128" fill="none" aria-hidden="true">
                  <circle cx="64" cy="64" r="52" stroke="var(--border)" strokeWidth="1"/>
                  <circle cx="64" cy="64" r="34" stroke="var(--border-faint)" strokeWidth="1"/>
                  <path d="M64 22 L64 58 M30 84 L57 68 M98 84 L71 68" stroke="var(--text-faint)" strokeWidth="1.4"/>
                  <line x1="64" y1="22" x2="30" y2="84" stroke="var(--accent)" strokeWidth="1" opacity="0.25"/>
                  <line x1="30" y1="84" x2="98" y2="84" stroke="var(--accent)" strokeWidth="1" opacity="0.25"/>
                  <line x1="98" y1="84" x2="64" y2="22" stroke="var(--accent)" strokeWidth="1" opacity="0.25"/>
                  <circle cx="64" cy="22" r="6" fill="var(--v-contradicted)" style={{animation:"gt-node 2.6s ease-in-out infinite"}}/>
                  <circle cx="30" cy="84" r="6" fill="var(--accent)" style={{animation:"gt-node 2.6s ease-in-out infinite .8s"}}/>
                  <circle cx="98" cy="84" r="6" fill="var(--v-crosscheck)" style={{animation:"gt-node 2.6s ease-in-out infinite 1.6s"}}/>
                  <circle cx="64" cy="64" r="8" fill="var(--bg-base)" stroke="var(--text-primary)" strokeWidth="2"/>
                  <circle cx="64" cy="64" r="2.6" fill="var(--text-primary)"/>
                </svg>
                <span style={{position:"absolute",width:88,height:1,background:"linear-gradient(90deg,transparent,var(--accent-bright),transparent)",animation:"gt-scan 3s ease-in-out infinite",boxShadow:"0 0 8px var(--accent-glow)",display:"block"}}/>
              </div>

              <div style={{fontFamily:"'Geist Mono',monospace",fontSize:10.5,letterSpacing:"0.22em",textTransform:"uppercase",color:"var(--text-muted)",marginBottom:16}}>Multi-agent hallucination auditor</div>
              <h1 style={{fontFamily:"'Space Grotesk',sans-serif",fontWeight:600,fontSize:42,lineHeight:1.05,letterSpacing:"-0.02em",textAlign:"center",maxWidth:620,marginBottom:14}}>Three agents.<br/>One ground truth.</h1>
              <p style={{fontSize:15,lineHeight:1.55,color:"var(--text-secondary)",textAlign:"center",maxWidth:480,marginBottom:34}}>Every response is fact-checked in parallel by three independent verifier agents — catching fabricated citations, wrong numbers, and contested claims.</p>

              {/* suggestion cards */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:12,width:"100%",maxWidth:620}}>
                {DEMO_PROMPTS.map((d) => (
                  <button
                    key={d.tag}
                    onClick={() => sendMessage(d.prompt)}
                    style={{textAlign:"left",background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:11,padding:"16px 16px 15px",cursor:"pointer",position:"relative",overflow:"hidden",transition:"border-color .18s,transform .18s"}}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-strong)"; (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-2px)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLButtonElement).style.transform = ""; }}
                  >
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:9}}>
                      <span style={{width:7,height:7,borderRadius:2,background:d.color,display:"inline-block"}}/>
                      <span style={{fontFamily:"'Geist Mono',monospace",fontSize:9.5,letterSpacing:"0.12em",textTransform:"uppercase",color:"var(--text-muted)"}}>{d.tag}</span>
                    </div>
                    <div style={{fontSize:13.5,lineHeight:1.4,color:"var(--text-primary)"}}>{d.label}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* CHAT THREAD */
            <div ref={scrollRef} id="gt-thread" style={{flex:1,minHeight:0,overflowY:"auto",padding:"28px 0 14px"}}>
              <div style={{maxWidth:760,margin:"0 auto",padding:"0 24px",display:"flex",flexDirection:"column",gap:26}}>

                {messages.map((m) => m.role === "user" ? (
                  <div key={m.id} style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:5}}>
                    <div style={{maxWidth:"78%",background:"var(--accent)",color:"#fff",padding:"11px 15px",borderRadius:"14px 14px 4px 14px",fontSize:14.5,lineHeight:1.5}}>
                      {m.content}
                    </div>
                    <span style={{fontFamily:"'Geist Mono',monospace",fontSize:10,color:"var(--text-faint)",paddingRight:4}}>{formatTime(m.timestamp)}</span>
                  </div>
                ) : (
                  <div key={m.id} style={{display:"flex",gap:13}}>
                    <AssistantAvatar/>
                    <div style={{flex:1,minWidth:0}}>
                      {/* meta row */}
                      <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:9}}>
                        <span style={{fontFamily:"'Geist Mono',monospace",fontSize:10.5,color:"var(--text-secondary)"}}>{m.provider ?? provider}</span>
                        <span style={{width:3,height:3,borderRadius:"50%",background:"var(--text-faint)",display:"inline-block"}}/>
                        <span style={{fontFamily:"'Geist Mono',monospace",fontSize:10.5,color:"var(--text-secondary)"}}>{m.model ?? model}</span>
                        <span style={{width:3,height:3,borderRadius:"50%",background:"var(--text-faint)",display:"inline-block"}}/>
                        <span style={{fontFamily:"'Geist Mono',monospace",fontSize:10.5,color:"var(--text-faint)"}}>{formatTime(m.timestamp)}</span>
                        <div style={{flex:1}}/>
                        <button
                          onClick={() => copyAssistantMessage(m.id, m.content)}
                          aria-label="Copy"
                          style={{display:"flex",alignItems:"center",gap:5,height:24,padding:"0 9px",borderRadius:6,border:"1px solid var(--border)",background:"transparent",cursor:"pointer",color:"var(--text-muted)",fontSize:11}}
                        >
                          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><rect x="3.2" y="3.2" width="6.3" height="6.3" rx="1.4" stroke="currentColor" strokeWidth="1.1"/><path d="M2.5 7.2 V2.5 H7.2" stroke="currentColor" strokeWidth="1.1"/></svg>
                          {copiedMessageId === m.id ? "Copied" : "Copy"}
                        </button>
                      </div>
                      {/* response body */}
                      <div style={{fontSize:14.5,lineHeight:1.62,color:"var(--text-primary)"}}>
                        <MarkdownLite text={m.content}/>
                      </div>
                      {/* audit panel */}
                      <AuditPanel
                        messageId={m.id}
                        isPending={pendingAudits.has(m.id)}
                        audit={audits[m.id]}
                        errorMessage={auditErrors[m.id]}
                        onDehallucinate={() => requestDehallucinate(m.id)}
                        isDehallucPending={dehallucPending.has(m.id)}
                        dehallucError={dehallucErrors[m.id]}
                      />
                    </div>
                  </div>
                ))}

                {/* thinking loader */}
                {pending && (
                  <div style={{display:"flex",gap:13}}>
                    <AssistantAvatar/>
                    <div style={{display:"flex",alignItems:"center",gap:6,height:30}}>
                      <span style={{width:7,height:7,borderRadius:"50%",background:"var(--text-muted)",animation:"gt-bounce 1.3s ease-in-out infinite",display:"inline-block"}}/>
                      <span style={{width:7,height:7,borderRadius:"50%",background:"var(--text-muted)",animation:"gt-bounce 1.3s ease-in-out infinite .18s",display:"inline-block"}}/>
                      <span style={{width:7,height:7,borderRadius:"50%",background:"var(--text-muted)",animation:"gt-bounce 1.3s ease-in-out infinite .36s",display:"inline-block"}}/>
                    </div>
                  </div>
                )}

                {error && (
                  <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",borderRadius:10,border:"1px solid color-mix(in srgb, var(--v-hallucination) 40%, transparent)",background:"color-mix(in srgb, var(--v-hallucination) 10%, transparent)",color:"var(--v-hallucination)",fontSize:13}}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5 1.5 12.5 H12.5 Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M7 5.5 V8.5 M7 10.3 V10.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                    {error}
                  </div>
                )}

              </div>
            </div>
          )}

          {/* ===== COMPOSER ===== */}
          <div style={{padding:"14px 24px 22px",background:"linear-gradient(to top, var(--bg-base) 62%, transparent)",flexShrink:0}}>
            <div style={{maxWidth:760,margin:"0 auto"}}>
              {/* demo chips */}
              <div style={{display:"flex",gap:7,marginBottom:10,flexWrap:"wrap"}}>
                {DEMO_PROMPTS.map((d) => (
                  <button
                    key={d.tag}
                    onClick={() => loadDemoPrompt(d.prompt)}
                    disabled={pending}
                    style={{display:"flex",alignItems:"center",gap:6,height:27,padding:"0 11px",borderRadius:999,background:"var(--bg-card)",border:"1px solid var(--border)",cursor:"pointer",color:"var(--text-secondary)",fontSize:11.5}}
                  >
                    <span style={{width:6,height:6,borderRadius:"50%",background:d.color,display:"inline-block"}}/>
                    {d.tag}
                  </button>
                ))}
              </div>
              {/* input */}
              <div
                style={{position:"relative",background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:15,padding:"6px 6px 6px 16px",display:"flex",alignItems:"flex-end",gap:10,transition:"border-color .2s,box-shadow .2s"}}
              >
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={pending}
                  placeholder={hasMessages ? "Reply to Groundtruth…" : "Ask anything…"}
                  aria-label="Message composer"
                  style={{flex:1,resize:"none",border:"none",outline:"none",background:"transparent",color:"var(--text-primary)",fontFamily:"'Geist',sans-serif",fontSize:14.5,lineHeight:1.5,padding:"9px 0",maxHeight:140}}
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={pending || !input.trim()}
                  aria-label="Send"
                  style={{flexShrink:0,width:38,height:38,borderRadius:11,border:"none",cursor:!input.trim() || pending ? "not-allowed" : "pointer",display:"grid",placeItems:"center",background:input.trim() && !pending ? "var(--accent)" : "var(--bg-elev)",color:input.trim() && !pending ? "#fff" : "var(--text-faint)",transition:"background .18s",opacity:pending ? 0.5 : 1}}
                >
                  <svg width="17" height="17" viewBox="0 0 17 17" fill="none"><path d="M8.5 14V3.5M8.5 3.5 4 8M8.5 3.5 13 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              </div>
              {/* hints */}
              <div style={{display:"flex",gap:16,marginTop:9,padding:"0 4px"}}>
                <span style={{fontFamily:"'Geist Mono',monospace",fontSize:10.5,color:"var(--text-faint)"}}><span style={{color:"var(--text-muted)"}}>Enter</span> send</span>
                <span style={{fontFamily:"'Geist Mono',monospace",fontSize:10.5,color:"var(--text-faint)"}}><span style={{color:"var(--text-muted)"}}>Shift+Enter</span> newline</span>
                <span style={{fontFamily:"'Geist Mono',monospace",fontSize:10.5,color:"var(--text-faint)"}}><span style={{color:"var(--text-muted)"}}>⌘K</span> focus</span>
              </div>
            </div>
          </div>

          {/* scroll-to-bottom button */}
          {!isAtBottom && hasMessages && (
            <button
              onClick={() => { stickyBottomRef.current = true; setIsAtBottom(true); scrollToBottom(); }}
              aria-label="Jump to latest"
              style={{position:"fixed",bottom:110,right:comparisonOpen ? 370 : 24,zIndex:30,display:"flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:999,border:"1px solid var(--border)",background:"var(--bg-elev)",cursor:"pointer",color:"var(--text-secondary)",fontSize:12,boxShadow:"var(--shadow-card)"}}
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 2 V11 M3 7.5 6.5 11 10 7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Latest
            </button>
          )}

        </main>

        {/* ===== COMPARISON SIDEBAR ===== */}
        <ComparisonSidebar
          open={comparisonOpen && Boolean(comparisonTarget)}
          beforeMessage={beforeMessage}
          afterMessage={afterMessage}
          beforeAudit={comparisonTarget ? audits[comparisonTarget.beforeId] : undefined}
          afterAudit={comparisonTarget ? audits[comparisonTarget.afterId] : undefined}
          beforePending={comparisonTarget ? pendingAudits.has(comparisonTarget.beforeId) : false}
          afterPending={comparisonTarget ? pendingAudits.has(comparisonTarget.afterId) : false}
          beforeError={comparisonTarget ? auditErrors[comparisonTarget.beforeId] : undefined}
          afterError={comparisonTarget ? auditErrors[comparisonTarget.afterId] : undefined}
          onClose={() => setComparisonOpen(false)}
        />
      </div>

      {/* ===== DEHALLUCINATE MODAL ===== */}
      <DehallucinateModal
        open={dehallucinateModal.open}
        suggestedPrompt={dehallucinateModal.suggestedPrompt}
        editedPrompt={dehallucinateModal.editedPrompt}
        onEdit={(v) => setDehallucinateModal((p) => ({ ...p, editedPrompt: v }))}
        onCancel={closeDehallucModal}
        onSend={sendDehallucPrompt}
      />
    </div>
  );
}
