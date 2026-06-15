import type { AgentReport } from "@/types";
import { AGENT_ROLE_COLOR, AGENT_ROLE_LABEL, AGENT_ROLE_STANCE, VERDICT_STYLES, formatConfidence } from "./verdict";

export function AgentSection({ report }: { report: AgentReport }) {
  const style = VERDICT_STYLES[report.verdict];
  const accentColor = AGENT_ROLE_COLOR[report.agent_role];

  return (
    <div style={{borderRadius:9,border:"1px solid var(--border)",background:"var(--bg-inset)",borderLeft:`3px solid ${accentColor}`,padding:"10px 12px",display:"flex",flexDirection:"column",gap:7}}>
      {/* header */}
      <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:7}}>
          {/* agent glyph */}
          <span style={{width:22,height:22,borderRadius:6,background:`color-mix(in srgb, ${accentColor} 16%, transparent)`,display:"grid",placeItems:"center",flexShrink:0}}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke={accentColor} strokeWidth="1.2"/>
              <circle cx="6" cy="6" r="1.5" fill={accentColor}/>
            </svg>
          </span>
          <span style={{fontFamily:"'Geist Mono',monospace",fontSize:11,letterSpacing:"0.04em",fontWeight:600,color:"var(--text-primary)"}}>{AGENT_ROLE_LABEL[report.agent_role]}</span>
        </div>

        {/* verdict chip */}
        <span style={{display:"inline-flex",alignItems:"center",gap:5,height:20,padding:"0 8px",borderRadius:999,background:style.bgMix,border:`1px solid color-mix(in srgb, ${style.color} 35%, transparent)`,fontFamily:"'Geist Mono',monospace",fontSize:9.5,letterSpacing:"0.07em",textTransform:"uppercase",color:style.color,fontWeight:600}}>
          <span style={{width:5,height:5,borderRadius:"50%",background:style.color,display:"inline-block"}}/>
          {style.label}
        </span>

        <span style={{fontFamily:"'Geist Mono',monospace",fontSize:10.5,color:"var(--text-muted)",marginLeft:"auto"}}>{formatConfidence(report.confidence)}</span>
      </div>

      {/* stance text */}
      <span style={{fontFamily:"'Geist Mono',monospace",fontSize:10,letterSpacing:"0.03em",color:"var(--text-faint)",fontStyle:"italic"}}>{AGENT_ROLE_STANCE[report.agent_role]}</span>

      {/* reasoning */}
      <p style={{fontSize:12.5,lineHeight:1.5,color:"var(--text-secondary)",whiteSpace:"pre-wrap"}}>{report.reasoning}</p>

      {/* sources */}
      {report.sources.length > 0 && (
        <div style={{display:"flex",flexDirection:"column",gap:5}}>
          <span style={{fontFamily:"'Geist Mono',monospace",fontSize:9.5,letterSpacing:"0.1em",textTransform:"uppercase",color:"var(--text-faint)"}}>Sources</span>
          <ul style={{display:"flex",flexDirection:"column",gap:5,listStyle:"none",padding:0,margin:0}}>
            {report.sources.map((src, i) => (
              <li key={`${src.url}-${i}`} style={{display:"flex",flexDirection:"column",gap:1}}>
                <a
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={src.title}
                  style={{fontSize:12,color:"var(--accent)",textDecoration:"underline dotted",textUnderlineOffset:2,fontWeight:500}}
                >
                  {src.domain || src.url}
                </a>
                {src.title && (
                  <span style={{fontSize:11,color:"var(--text-muted)",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{src.title}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
