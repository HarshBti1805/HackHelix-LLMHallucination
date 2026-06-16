import type { ClaimAudit, IndependentCheck } from "@/types";
import { AgentSection } from "./AgentSection";
import { useInterrogator } from "./InterrogatorDrawer";
import { VERDICT_STYLES, formatConfidence } from "./verdict";

const STANCE_COPY: Record<IndependentCheck["stance"], { label: string; color: string }> = {
  supports: { label: "Independent agrees", color: "var(--v-verified)" },
  contradicts: { label: "Independent disagrees", color: "var(--v-contradicted)" },
  absent: { label: "Not addressed by independent", color: "var(--text-muted)" },
};

function IndependentCheckSection({ check }: { check: IndependentCheck }) {
  const copy = STANCE_COPY[check.stance];
  return (
    <div style={{padding:"9px 12px",borderRadius:8,border:`1px solid color-mix(in srgb, var(--v-crosscheck) 30%, transparent)`,background:`color-mix(in srgb, var(--v-crosscheck) 7%, transparent)`,display:"flex",flexDirection:"column",gap:4}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontFamily:"'Geist Mono',monospace",fontSize:9.5,letterSpacing:"0.1em",textTransform:"uppercase",color:"var(--v-crosscheck)"}}>
          Independent cross-check
        </span>
        {check.escalated && (
          <span style={{fontFamily:"'Geist Mono',monospace",fontSize:9,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--v-crosscheck)",border:`1px solid color-mix(in srgb, var(--v-crosscheck) 45%, transparent)`,padding:"1px 6px",borderRadius:4,animation:"gt-pop .25s ease both"}}>
            escalated verdict
          </span>
        )}
      </div>
      <span style={{fontSize:12,fontWeight:500,color:copy.color}}>{copy.label}</span>
      {check.note && (
        <p style={{fontSize:11.5,lineHeight:1.45,color:"var(--text-secondary)"}}>{check.note}</p>
      )}
    </div>
  );
}

export interface ClaimRowProps {
  ca: ClaimAudit;
  isExpanded: boolean;
  onToggle: () => void;
  notLocatedNote?: string;
}

const TYPE_LABEL: Record<string, string> = {
  numerical: "NUM",
  entity: "ENT",
  citation: "CIT",
};

export function ClaimRow({ ca, isExpanded, onToggle, notLocatedNote }: ClaimRowProps) {
  const style = VERDICT_STYLES[ca.consensus_verdict];
  const { open } = useInterrogator();
  return (
    <div style={{borderRadius:10,border:"1px solid var(--border)",background:"var(--bg-card)",overflow:"hidden",animation:"gt-claimin .2s ease both"}}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        style={{display:"flex",width:"100%",alignItems:"flex-start",gap:10,padding:"10px 12px",background:"transparent",border:"none",cursor:"pointer",textAlign:"left"}}
      >
        {/* verdict dot */}
        <span style={{flexShrink:0,marginTop:2,width:8,height:8,borderRadius:"50%",background:style.color,boxShadow:style.dotGlow,display:"inline-block"}}/>

        {/* verdict label — fixed 108px Geist Mono */}
        <span style={{flexShrink:0,width:108,fontFamily:"'Geist Mono',monospace",fontSize:9.5,letterSpacing:"0.08em",textTransform:"uppercase",color:style.color,marginTop:1}}>
          {style.label}
        </span>

        {/* claim text */}
        <span style={{flex:1,minWidth:0,fontSize:13,lineHeight:1.4,color:"var(--text-primary)",display:"-webkit-box",WebkitLineClamp:isExpanded ? undefined : 2,WebkitBoxOrient:"vertical",overflow:isExpanded ? "visible" : "hidden"}}>
          {ca.claim.text}
        </span>

        {/* badges */}
        <div style={{flexShrink:0,display:"flex",alignItems:"center",gap:5}}>
          {ca.claim.type && (
            <span style={{fontFamily:"'Geist Mono',monospace",fontSize:8.5,letterSpacing:"0.1em",color:"var(--text-faint)",background:"var(--bg-inset)",padding:"2px 5px",borderRadius:4}}>
              {TYPE_LABEL[ca.claim.type] ?? ca.claim.type.toUpperCase()}
            </span>
          )}
          {ca.independent_check?.escalated && (
            <span
              title="Cross-check escalated verdict"
              style={{fontFamily:"'Geist Mono',monospace",fontSize:8.5,letterSpacing:"0.08em",color:"var(--v-crosscheck)",background:`color-mix(in srgb, var(--v-crosscheck) 12%, transparent)`,padding:"2px 5px",borderRadius:4,border:`1px solid color-mix(in srgb, var(--v-crosscheck) 35%, transparent)`,animation:"gt-pop .3s ease both"}}
            >
              ↑ XC
            </span>
          )}
          {ca.agents_disagreed && (
            <span
              title="Agents disagreed"
              style={{fontFamily:"'Geist Mono',monospace",fontSize:8.5,letterSpacing:"0.06em",color:"var(--v-unverified)",background:`color-mix(in srgb, var(--v-unverified) 12%, transparent)`,padding:"2px 5px",borderRadius:4,border:`1px solid color-mix(in srgb, var(--v-unverified) 35%, transparent)`}}
            >
              ⚑ SPLIT
            </span>
          )}
          <svg
            width="14" height="14" viewBox="0 0 14 14" fill="none"
            style={{transition:"transform .15s",transform:isExpanded ? "rotate(180deg)" : "none",color:"var(--text-faint)",flexShrink:0}}
          >
            <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </div>
      </button>

      {isExpanded && (
        <div style={{borderTop:"1px solid var(--border-faint)",padding:"10px 12px",display:"flex",flexDirection:"column",gap:8}}>
          <div style={{fontFamily:"'Geist Mono',monospace",fontSize:10,letterSpacing:"0.04em",color:"var(--text-secondary)"}}>
            {formatConfidence(ca.consensus_confidence)} confidence ·{" "}
            <span style={{color:"var(--text-muted)"}}>{ca.agreement_score >= 1 ? "Unanimous" : ca.agents_disagreed ? "Agents split" : "Majority"}</span>
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:1}}>
            <span style={{fontFamily:"'Geist Mono',monospace",fontSize:9.5,letterSpacing:"0.1em",textTransform:"uppercase",color:"var(--text-faint)"}}>Original sentence</span>
            <p style={{fontSize:12,fontStyle:"italic",lineHeight:1.4,color:"var(--text-secondary)"}}>&ldquo;{ca.claim.sentence}&rdquo;</p>
            {notLocatedNote && (
              <span style={{fontSize:10.5,color:"var(--text-faint)"}}>{notLocatedNote}</span>
            )}
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {ca.per_agent_reports.map((report) => (
              <AgentSection key={report.agent_role} report={report}/>
            ))}
          </div>

          {ca.independent_check && (
            <IndependentCheckSection check={ca.independent_check}/>
          )}

          <button
            type="button"
            onClick={() => open(ca)}
            style={{display:"inline-flex",alignItems:"center",alignSelf:"flex-start",gap:6,padding:"6px 11px",borderRadius:8,border:"1px solid color-mix(in srgb, var(--accent) 30%, transparent)",background:"color-mix(in srgb, var(--accent) 7%, transparent)",cursor:"pointer",color:"var(--accent-bright, var(--accent))",fontFamily:"'Geist Mono',monospace",fontSize:10.5,letterSpacing:"0.04em"}}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <path d="M2.5 3.2h9v6h-5l-2.4 2v-2H2.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
            Ask the auditor
          </button>
        </div>
      )}
    </div>
  );
}
