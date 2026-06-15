import type { ClaimAudit, Verdict } from "@/types";
import { VERDICT_STYLES } from "@/components/audit/verdict";
import { toneFor, type ClaimDiff, type DiffTone, type MatchedPair } from "./diffClaims";

export interface ClaimDiffLedgerProps {
  diff: ClaimDiff;
}

export function ClaimDiffLedger({ diff }: ClaimDiffLedgerProps) {
  const changed = diff.matched.filter((p) => p.before.consensus_verdict !== p.after.consensus_verdict);
  const totalRows = changed.length + diff.eliminated.length + diff.introduced.length;

  if (totalRows === 0) {
    return (
      <div style={{padding:"20px 20px",textAlign:"center",display:"flex",flexDirection:"column",gap:6,alignItems:"center",justifyContent:"center",height:"100%"}}>
        <p style={{fontSize:15,fontStyle:"italic",color:"var(--text-muted)"}}>No claim-level changes detected.</p>
        <p style={{fontSize:12,color:"var(--text-faint)"}}>Every audited claim landed on the same verdict.</p>
      </div>
    );
  }

  return (
    <section style={{display:"flex",flexDirection:"column",gap:12,padding:"14px 16px"}}>
      <header style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={{fontFamily:"'Geist Mono',monospace",fontSize:9.5,letterSpacing:"0.18em",textTransform:"uppercase",color:"var(--text-muted)"}}>Claim diff</span>
        <span style={{fontFamily:"'Geist Mono',monospace",fontSize:10.5,color:"var(--text-faint)"}}>{changed.length} changed · {diff.eliminated.length} removed · {diff.introduced.length} added</span>
      </header>
      <ul style={{display:"flex",flexDirection:"column",gap:8,listStyle:"none",padding:0,margin:0}}>
        {changed.map((pair) => <ChangedRow key={`c-${pair.before.claim.id}`} pair={pair}/>)}
        {diff.eliminated.map((c) => <EliminatedRow key={`e-${c.claim.id}`} claim={c}/>)}
        {diff.introduced.map((c) => <IntroducedRow key={`i-${c.claim.id}`} claim={c}/>)}
      </ul>
    </section>
  );
}

function ChangedRow({ pair }: { pair: MatchedPair }) {
  const tone: DiffTone = toneFor(pair.before.consensus_verdict, pair.after.consensus_verdict);
  const arrowColor = tone === "improved" ? "var(--v-verified)" : tone === "worsened" ? "var(--v-hallucination)" : "var(--text-muted)";
  return (
    <li style={{display:"flex",flexDirection:"column",gap:8,borderRadius:10,border:"1px solid var(--border)",background:"var(--bg-card)",padding:"10px 12px"}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
        <span style={{width:20,height:20,flexShrink:0,borderRadius:5,background:"var(--bg-inset)",display:"grid",placeItems:"center",fontFamily:"'Geist Mono',monospace",fontSize:10,color:"var(--text-faint)"}}>·</span>
        <p style={{flex:1,fontSize:13,lineHeight:1.45,color:"var(--text-primary)"}}>{pair.after.claim.text || pair.before.claim.text}</p>
      </div>
      <div style={{marginLeft:30,display:"flex",flexWrap:"wrap",alignItems:"center",gap:8}}>
        <VerdictPill verdict={pair.before.consensus_verdict}/>
        <span style={{color:arrowColor,fontSize:13}}>→</span>
        <VerdictPill verdict={pair.after.consensus_verdict}/>
      </div>
    </li>
  );
}

function EliminatedRow({ claim }: { claim: ClaimAudit }) {
  return (
    <li style={{display:"flex",alignItems:"flex-start",gap:10,borderRadius:10,border:`1px solid color-mix(in srgb, var(--v-hallucination) 25%, transparent)`,background:`color-mix(in srgb, var(--v-hallucination) 7%, transparent)`,padding:"10px 12px"}}>
      <span style={{width:20,height:20,flexShrink:0,borderRadius:5,background:"var(--v-hallucination)",display:"grid",placeItems:"center",fontFamily:"'Geist Mono',monospace",fontSize:11,fontWeight:700,color:"#fff"}}>−</span>
      <div style={{flex:1,display:"flex",flexDirection:"column",gap:4}}>
        <p style={{fontSize:13,lineHeight:1.45,color:"var(--text-secondary)",textDecoration:"line-through",textDecorationColor:"color-mix(in srgb, var(--v-hallucination) 50%, transparent)"}}>{claim.claim.text}</p>
        <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:7}}>
          <span style={{fontFamily:"'Geist Mono',monospace",fontSize:9.5,letterSpacing:"0.1em",textTransform:"uppercase",color:"var(--text-faint)"}}>Removed · was</span>
          <VerdictPill verdict={claim.consensus_verdict}/>
        </div>
      </div>
    </li>
  );
}

function IntroducedRow({ claim }: { claim: ClaimAudit }) {
  return (
    <li style={{display:"flex",alignItems:"flex-start",gap:10,borderRadius:10,border:`1px solid color-mix(in srgb, var(--v-verified) 25%, transparent)`,background:`color-mix(in srgb, var(--v-verified) 7%, transparent)`,padding:"10px 12px"}}>
      <span style={{width:20,height:20,flexShrink:0,borderRadius:5,background:"var(--v-verified)",display:"grid",placeItems:"center",fontFamily:"'Geist Mono',monospace",fontSize:11,fontWeight:700,color:"#fff"}}>+</span>
      <div style={{flex:1,display:"flex",flexDirection:"column",gap:4}}>
        <p style={{fontSize:13,lineHeight:1.45,color:"var(--text-primary)"}}>{claim.claim.text}</p>
        <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:7}}>
          <span style={{fontFamily:"'Geist Mono',monospace",fontSize:9.5,letterSpacing:"0.1em",textTransform:"uppercase",color:"var(--text-faint)"}}>New · now</span>
          <VerdictPill verdict={claim.consensus_verdict}/>
        </div>
      </div>
    </li>
  );
}

function VerdictPill({ verdict }: { verdict: Verdict }) {
  const style = VERDICT_STYLES[verdict];
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:5,height:20,padding:"0 8px",borderRadius:999,background:style.bgMix,border:`1px solid color-mix(in srgb, ${style.color} 35%, transparent)`,fontFamily:"'Geist Mono',monospace",fontSize:9,letterSpacing:"0.07em",textTransform:"uppercase",color:style.color,fontWeight:600}}>
      <span style={{width:5,height:5,borderRadius:"50%",background:style.color,display:"inline-block"}}/>
      {style.label}
    </span>
  );
}
