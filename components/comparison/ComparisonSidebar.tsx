"use client";

import { useMemo } from "react";
import type { ChatMessage, MessageAudit } from "@/types";
import { ComparisonColumn } from "./ComparisonColumn";
import { ClaimDiffLedger } from "./ClaimDiffLedger";
import { diffClaims, type ClaimDiff } from "./diffClaims";

export interface ComparisonSidebarProps {
  open: boolean;
  beforeMessage: ChatMessage | undefined;
  afterMessage: ChatMessage | undefined;
  beforeAudit: MessageAudit | undefined;
  afterAudit: MessageAudit | undefined;
  beforePending: boolean;
  afterPending: boolean;
  beforeError: string | undefined;
  afterError: string | undefined;
  onClose: () => void;
}

export function ComparisonSidebar({
  open,
  beforeMessage,
  afterMessage,
  beforeAudit,
  afterAudit,
  beforePending,
  afterPending,
  beforeError,
  afterError,
  onClose,
}: ComparisonSidebarProps) {
  const diff: ClaimDiff = useMemo(() => {
    return diffClaims(beforeAudit?.claims ?? [], afterAudit?.claims ?? []);
  }, [beforeAudit, afterAudit]);

  if (!open) return null;

  const bothReady = Boolean(beforeAudit && afterAudit);
  const eitherFailed = Boolean(beforeError || afterError);

  // compute stats for hero section
  const beforeFailed = beforeAudit ? beforeAudit.summary.contradicted + beforeAudit.summary.likely_hallucination : 0;
  const afterFailed = afterAudit ? afterAudit.summary.contradicted + afterAudit.summary.likely_hallucination : 0;
  const issuesFixed = Math.max(0, beforeFailed - afterFailed);

  return (
    <aside
      role="complementary"
      aria-label="Regeneration comparison"
      style={{width:340,flexShrink:0,height:"100%",display:"flex",flexDirection:"column",borderLeft:"1px solid var(--border)",background:"var(--bg-raised)",animation:"gt-claimin .22s ease both",overflow:"hidden"}}
    >
      {/* header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"12px 16px",borderBottom:"1px solid var(--border)",flexShrink:0}}>
        <div>
          <div style={{fontFamily:"'Geist Mono',monospace",fontSize:9.5,letterSpacing:"0.18em",textTransform:"uppercase",color:"var(--accent)",marginBottom:2}}>Regeneration · Diff</div>
          <div style={{fontFamily:"'Space Grotesk',sans-serif",fontWeight:600,fontSize:17,letterSpacing:"-0.01em"}}>Before <span style={{fontStyle:"italic",fontWeight:500}}>vs.</span> After</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close comparison"
          style={{width:28,height:28,display:"grid",placeItems:"center",borderRadius:7,border:"1px solid var(--border)",background:"transparent",cursor:"pointer",color:"var(--text-muted)"}}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M6 18L18 6"/></svg>
        </button>
      </div>

      {/* confidence hero */}
      {bothReady && beforeAudit && afterAudit && (
        <div style={{padding:"12px 16px 10px",borderBottom:"1px solid var(--border)",display:"flex",gap:12,flexShrink:0}}>
          <div style={{flex:1,display:"flex",flexDirection:"column",gap:2,alignItems:"center",padding:"8px 0",borderRadius:8,background:"var(--bg-card)"}}>
            <span style={{fontFamily:"'Geist Mono',monospace",fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase",color:"var(--text-faint)"}}>Before</span>
            <span style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:22,fontWeight:600,color:beforeFailed > 0 ? "var(--v-hallucination)" : "var(--v-verified)"}}>
              {beforeAudit.summary.total_claims > 0 ? Math.round((beforeAudit.summary.verified / beforeAudit.summary.total_claims) * 100) : 0}%
            </span>
            <span style={{fontFamily:"'Geist Mono',monospace",fontSize:9.5,color:"var(--text-muted)"}}>verified</span>
          </div>
          <div style={{display:"flex",alignItems:"center",color:"var(--text-faint)",fontSize:18,fontWeight:300}}>→</div>
          <div style={{flex:1,display:"flex",flexDirection:"column",gap:2,alignItems:"center",padding:"8px 0",borderRadius:8,background:"var(--bg-card)"}}>
            <span style={{fontFamily:"'Geist Mono',monospace",fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase",color:"var(--text-faint)"}}>After</span>
            <span style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:22,fontWeight:600,color:afterFailed > 0 ? "var(--v-unverified)" : "var(--v-verified)"}}>
              {afterAudit.summary.total_claims > 0 ? Math.round((afterAudit.summary.verified / afterAudit.summary.total_claims) * 100) : 0}%
            </span>
            <span style={{fontFamily:"'Geist Mono',monospace",fontSize:9.5,color:"var(--text-muted)"}}>verified</span>
          </div>
        </div>
      )}

      {/* issues resolved banner */}
      {bothReady && issuesFixed > 0 && (
        <div style={{margin:"10px 16px 0",padding:"8px 12px",borderRadius:8,background:`color-mix(in srgb, var(--v-verified) 10%, transparent)`,border:`1px solid color-mix(in srgb, var(--v-verified) 30%, transparent)`,display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.5 5.5 10.5 11.5 4" stroke="var(--v-verified)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span style={{fontSize:12.5,color:"var(--v-verified)",fontWeight:500}}>{issuesFixed} issue{issuesFixed !== 1 ? "s" : ""} resolved</span>
        </div>
      )}

      {/* columns */}
      <div style={{flex:3,minHeight:0,display:"flex",flexDirection:"column",gap:0,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",flex:1,minHeight:0}}>
          <ComparisonColumn
            label="Before"
            responseText={beforeMessage?.content ?? ""}
            audit={beforeAudit}
            pending={beforePending}
            errorMessage={beforeError}
            toneById={diff.toneById}
          />
          <div style={{borderLeft:"1px solid var(--border)",display:"flex",flexDirection:"column",overflow:"hidden"}}>
            <ComparisonColumn
              label="After"
              responseText={afterMessage?.content ?? ""}
              audit={afterAudit}
              pending={afterPending}
              errorMessage={afterError}
              toneById={diff.toneById}
            />
          </div>
        </div>
      </div>

      {/* ledger */}
      <div style={{flex:2,minHeight:0,overflowY:"auto",borderTop:"1px solid var(--border)"}}>
        {bothReady ? (
          <ClaimDiffLedger diff={diff}/>
        ) : (
          <div style={{display:"flex",height:"100%",alignItems:"center",justifyContent:"center",padding:"20px 20px",textAlign:"center"}}>
            <p style={{fontSize:14,fontStyle:"italic",color:"var(--text-muted)"}}>
              {eitherFailed
                ? "One audit failed — diff will appear once both sides complete."
                : "Waiting for the second audit to finish…"}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
