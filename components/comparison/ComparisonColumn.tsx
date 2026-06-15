import type { MessageAudit } from "@/types";
import { SummaryBar } from "@/components/audit/SummaryBar";
import { locateClaimSpans, type HighlightSpan } from "@/components/audit/highlightSpans";
import type { DiffTone } from "./diffClaims";

export interface ComparisonColumnProps {
  label: "Before" | "After";
  responseText: string;
  audit: MessageAudit | undefined;
  pending: boolean;
  errorMessage: string | undefined;
  toneById: Map<string, DiffTone>;
}

export function ComparisonColumn({ label, responseText, audit, pending, errorMessage, toneById }: ComparisonColumnProps) {
  const claims = audit?.claims ?? [];
  const { spans } = locateClaimSpans(responseText, claims);
  const dotColor = label === "Before" ? "var(--v-contradicted)" : "var(--v-verified)";

  return (
    <section style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0,overflow:"hidden",background:"var(--bg-raised)"}}>
      <header style={{position:"sticky",top:0,zIndex:10,display:"flex",flexDirection:"column",gap:8,borderBottom:"1px solid var(--border)",background:"color-mix(in srgb, var(--bg-raised) 95%, transparent)",padding:"10px 14px",backdropFilter:"blur(8px)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:7}}>
            <span style={{width:7,height:7,borderRadius:"50%",background:dotColor,display:"inline-block"}}/>
            <span style={{fontFamily:"'Geist Mono',monospace",fontSize:9.5,letterSpacing:"0.18em",textTransform:"uppercase",color:"var(--text-muted)"}}>{label}</span>
          </div>
          <span style={{fontFamily:"'Geist Mono',monospace",fontSize:10.5,color:"var(--text-faint)"}}>{audit ? `${audit.summary.total_claims} claims` : "—"}</span>
        </div>
        {audit && audit.summary.total_claims > 0 ? (
          <SummaryBar summary={audit.summary}/>
        ) : (
          <span style={{fontSize:11,fontStyle:"italic",color:"var(--text-muted)"}}>
            {pending ? "auditing…" : errorMessage ? "audit unavailable" : "no verifiable claims"}
          </span>
        )}
      </header>

      <div style={{flex:1,overflowY:"auto",padding:"16px 16px"}}>
        <article style={{fontSize:14,lineHeight:1.7,color:"var(--text-primary)"}}>
          <HighlightedResponse text={responseText} spans={spans} toneById={toneById}/>
        </article>
      </div>
    </section>
  );
}

function HighlightedResponse({ text, spans, toneById }: { text: string; spans: HighlightSpan[]; toneById: Map<string, DiffTone> }) {
  if (spans.length === 0) return <>{text}</>;

  const segments: React.ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if (span.start > cursor) {
      segments.push(<span key={`t-${cursor}`}>{text.slice(cursor, span.start)}</span>);
    }
    const tone = toneById.get(span.claim.claim.id) ?? "none";
    const slice = text.slice(span.start, span.end);
    if (tone === "none") {
      segments.push(<span key={`u-${span.claim.claim.id}`}>{slice}</span>);
    } else {
      const markStyle: React.CSSProperties = tone === "improved"
        ? {background:"color-mix(in srgb, var(--v-verified) 15%, transparent)",boxShadow:"inset 3px 0 0 var(--v-verified)",padding:"0 2px",borderRadius:3}
        : {background:"color-mix(in srgb, var(--v-hallucination) 15%, transparent)",boxShadow:"inset 3px 0 0 var(--v-hallucination)",padding:"0 2px",borderRadius:3};
      segments.push(
        <mark
          key={`h-${span.claim.claim.id}`}
          style={markStyle}
          title={`${tone === "improved" ? "Improved" : "Still at risk"} — ${span.claim.claim.text}`}
        >
          {slice}
        </mark>
      );
    }
    cursor = span.end;
  }
  if (cursor < text.length) {
    segments.push(<span key={`t-${cursor}-tail`}>{text.slice(cursor)}</span>);
  }
  return <>{segments}</>;
}
