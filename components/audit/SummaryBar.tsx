import type { AuditSummary } from "@/types";
import { SUMMARY_CATEGORIES, VERDICT_STYLES } from "./verdict";

interface SummaryBarProps {
  summary: AuditSummary;
  failedCount?: number;
  showDehallucinate?: boolean;
  isDehallucPending?: boolean;
  dehallucError?: string;
  onDehallucinate?: () => void;
}

export function SummaryBar({ summary, failedCount = 0, showDehallucinate, isDehallucPending, dehallucError, onDehallucinate }: SummaryBarProps) {
  const items = SUMMARY_CATEGORIES.flatMap((cat) => {
    const count = summary[cat.field];
    if (count <= 0) return [];
    const noun = count === 1 ? cat.singular : cat.plural;
    return [{ verdict: cat.verdict, text: `${count} ${noun}`, count }];
  });

  if (items.length === 0) return null;

  const total = summary.total_claims;
  const verifiedPct = total > 0 ? (summary.verified / total) * 100 : 0;
  const avgConfidence = 0;

  return (
    <div style={{padding:"12px 16px",display:"flex",flexDirection:"column",gap:11,borderBottom:"1px solid var(--border)"}}>
      {/* verdict chips row */}
      <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:7}}>
        {items.map((item) => {
          const style = VERDICT_STYLES[item.verdict];
          return (
            <span
              key={item.verdict}
              style={{display:"inline-flex",alignItems:"center",gap:6,height:24,padding:"0 10px",borderRadius:999,background:style.bgMix,border:`1px solid color-mix(in srgb, ${style.color} 35%, transparent)`,fontSize:11,fontFamily:"'Geist Mono',monospace",letterSpacing:"0.04em",color:style.color,fontWeight:600,textTransform:"uppercase"}}
            >
              <span style={{width:6,height:6,borderRadius:"50%",background:style.color,boxShadow:style.dotGlow,display:"inline-block"}}/>
              {item.text}
            </span>
          );
        })}

        {showDehallucinate && (
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
            {dehallucError && (
              <span style={{fontSize:11,color:"var(--v-hallucination)"}}>{dehallucError}</span>
            )}
            <button
              onClick={onDehallucinate}
              disabled={isDehallucPending}
              style={{display:"flex",alignItems:"center",gap:7,height:28,padding:"0 12px",borderRadius:8,border:`1px solid color-mix(in srgb, var(--v-hallucination) 40%, transparent)`,background:`color-mix(in srgb, var(--v-hallucination) 10%, transparent)`,cursor:isDehallucPending ? "not-allowed" : "pointer",color:"var(--v-hallucination)",fontSize:11.5,fontWeight:600,opacity:isDehallucPending ? 0.6 : 1}}
            >
              {isDehallucPending ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 12 12" style={{animation:"gt-spin 1s linear infinite"}}><path d="M6 1A5 5 0 0 1 11 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>
                  Building…
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1.5 v4 M4 4 6.5 1.5 9 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 7.5 A4.5 4.5 0 0 0 11 7.5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round"/></svg>
                  Dehallucinate ({failedCount})
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* confidence bar */}
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <div style={{flex:1,height:4,borderRadius:2,background:"var(--bg-inset)",overflow:"hidden"}}>
          <div style={{height:"100%",width:`${verifiedPct}%`,background:"var(--v-verified)",borderRadius:2,transition:"width .4s ease"}}/>
        </div>
        <span style={{fontFamily:"'Geist Mono',monospace",fontSize:10.5,color:"var(--text-muted)",flexShrink:0}}>
          {summary.total_claims} claim{summary.total_claims !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}
