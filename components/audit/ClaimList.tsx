"use client";

import { useState } from "react";
import type { ClaimAudit } from "@/types";
import { ClaimRow } from "./ClaimRow";

export interface ClaimListProps {
  claims: ClaimAudit[];
  /**
   * Optional per-claim note (keyed by `claim.id`) shown beneath the
   * "Original sentence" line in an expanded row. The `/document` page
   * uses this to flag claims whose sentence couldn't be located verbatim
   * in the source text (IMPROVEMENTS.md Phase A task A.8). The chat
   * AuditPanel never passes notes.
   */
  notLocatedNotes?: Record<string, string>;
}

/**
 * Renders a list of `ClaimRow`s and owns the multi-row expansion state.
 *
 * Originally this expansion-state pattern lived inside `app/page.tsx`'s
 * `AuditPanel`. Factored out at IMPROVEMENTS.md Phase A task A.7-prep so
 * the chat AuditPanel and the new `/document` report share the exact
 * same affordance — multiple rows can be open at once, and the open set
 * resets whenever the parent re-mounts (a fresh audit replaces the
 * `ClaimList` entirely; stale ids never carry over).
 *
 * The expansion Set is keyed by `claim.id`. If a future re-audit hands
 * back claims with new ids, the prior set simply stops matching anything
 * and becomes inert — no need for explicit cleanup.
 */
export function ClaimList({ claims, notLocatedNotes }: ClaimListProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  function toggleExpanded(claimId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(claimId)) next.delete(claimId);
      else next.add(claimId);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {claims.map((ca) => (
        <ClaimRow
          key={ca.claim.id}
          ca={ca}
          isExpanded={expanded.has(ca.claim.id)}
          onToggle={() => toggleExpanded(ca.claim.id)}
          notLocatedNote={notLocatedNotes?.[ca.claim.id]}
        />
      ))}
    </div>
  );
}
