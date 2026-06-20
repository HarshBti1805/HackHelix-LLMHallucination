import type {
  GroundingVerdict,
  Verdict,
  WorkspaceRunResult,
} from "@/types";

/**
 * Server-side audit → Markdown renderer (C — close the loop).
 *
 * Produces the report body that gets written back to Notion (and could feed any
 * other writeback target). It mirrors the client-side `buildMarkdownReport` in
 * `app/workspace/page.tsx` but lives server-side so the writeback route and the
 * watch engine render reports without importing the client component tree.
 *
 * Pure string-building — no I/O, no LLM calls, no React.
 */

const MODE_LABEL: Record<WorkspaceRunResult["mode"], string> = {
  groundedness: "Faithfulness check",
  factcheck: "Web fact-check",
  citations: "Citation dossier",
};

const GLABEL: Record<GroundingVerdict, string> = {
  grounded: "Grounded",
  ungrounded: "Not in source",
  contradicted: "Contradicted",
};

const VLABEL: Record<Verdict, string> = {
  verified: "Verified",
  unverified_plausible: "Unverified",
  contradicted: "Contradicted",
  likely_hallucination: "Likely hallucination",
};

function checkedTitle(result: WorkspaceRunResult): string {
  const checked =
    result.used.find((u) => u.role === "checked") ?? result.used[0];
  return checked?.title ?? "Document";
}

/** Deterministic, timestamped title so each run is its own audit-trail entry. */
export function reportTitle(result: WorkspaceRunResult): string {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  return `Groundtruth Audit — ${checkedTitle(result)} (${stamp} UTC)`;
}

/** Count the "needs attention" claims for the headline, by mode. */
function flaggedCount(result: WorkspaceRunResult): number {
  if (result.mode === "factcheck" && result.audit) {
    return (
      result.audit.summary.contradicted +
      result.audit.summary.likely_hallucination
    );
  }
  if (result.mode === "groundedness" && result.groundedness) {
    return (
      result.groundedness.summary.ungrounded +
      result.groundedness.summary.contradicted
    );
  }
  if (result.mode === "citations" && result.citations) {
    return result.citations.claims.filter(
      (c) => c.contradicting.length > 0,
    ).length;
  }
  return 0;
}

export function buildReportMarkdown(result: WorkspaceRunResult): string {
  const lines: string[] = [];
  const flagged = flaggedCount(result);

  lines.push(`# Groundtruth Audit — ${MODE_LABEL[result.mode]}`);
  lines.push("");
  lines.push(`> ${result.note}`);
  lines.push("");
  lines.push(
    flagged > 0
      ? `**${flagged} claim${flagged === 1 ? "" : "s"} need attention.**`
      : "**No problems found.**",
  );
  lines.push("");
  lines.push(`_Generated ${new Date().toISOString()} by Groundtruth._`);
  lines.push("");

  lines.push("## Documents audited");
  for (const d of result.used) {
    lines.push(`- **${d.title}** (${d.role})${d.url ? ` — ${d.url}` : ""}`);
  }
  lines.push("");

  if (result.mode === "groundedness" && result.groundedness) {
    const s = result.groundedness.summary;
    lines.push("## Faithfulness to source");
    lines.push(
      `Grounded: ${s.grounded} · Not in source: ${s.ungrounded} · Contradicted: ${s.contradicted} (of ${s.total_claims})`,
    );
    lines.push("");
    result.groundedness.claims.forEach((c, i) => {
      lines.push(`### ${i + 1}. [${GLABEL[c.verdict]}] ${c.claim.text}`);
      lines.push(`- Confidence: ${Math.round(c.confidence * 100)}%`);
      lines.push(`- ${c.rationale}`);
      if (c.supporting_quote) lines.push(`- Source quote: "${c.supporting_quote}"`);
      lines.push("");
    });
  } else if (result.mode === "factcheck" && result.audit) {
    const s = result.audit.summary;
    lines.push("## Web fact-check");
    lines.push(
      `Verified: ${s.verified} · Unverified: ${s.unverified_plausible} · Contradicted: ${s.contradicted} · Likely hallucination: ${s.likely_hallucination} (of ${s.total_claims})`,
    );
    lines.push("");
    result.audit.claims.forEach((c, i) => {
      lines.push(`### ${i + 1}. [${VLABEL[c.consensus_verdict]}] ${c.claim.text}`);
      lines.push(`- Confidence: ${Math.round(c.consensus_confidence * 100)}%`);
      const lead = c.per_agent_reports[0];
      if (lead?.reasoning) {
        lines.push(`- ${lead.reasoning.replace(/\s+/g, " ").slice(0, 280)}`);
      }
      const urls = Array.from(
        new Set(
          c.per_agent_reports.flatMap((r) => r.sources.map((src) => src.url)),
        ),
      ).filter(Boolean);
      for (const u of urls.slice(0, 4)) lines.push(`- Source: ${u}`);
      lines.push("");
    });
  } else if (result.mode === "citations" && result.citations) {
    lines.push("## Citation dossier");
    lines.push("");
    result.citations.claims.forEach((c, i) => {
      lines.push(`### ${i + 1}. ${c.claim}`);
      lines.push(`_${c.stance_summary}_`);
      lines.push("");
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

  lines.push("---");
  lines.push(
    "_Audited by Groundtruth — a multi-agent hallucination auditor. Verdicts are evidence-based and advisory; review before acting._",
  );
  return lines.join("\n");
}
