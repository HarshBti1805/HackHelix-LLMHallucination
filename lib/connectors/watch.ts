import { createHash } from "node:crypto";
import { auditDocument } from "@/lib/document-audit";
import { getConnector } from "@/lib/connectors/registry";
import { createReportPage, isConnected as notionConnected } from "@/lib/connectors/notion";
import { buildReportMarkdown, reportTitle } from "@/lib/connectors/report";
import {
  addWatchRecord,
  getWatchRecord,
  listWatchRecords,
  removeWatchRecord,
  updateWatchRecord,
  type WatchRecord,
} from "@/lib/store/tokens";
import type {
  AddWatchRequestBody,
  ConnectorWatch,
  WatchRunOutcome,
  WorkspaceRunResult,
  WorkspaceUsedDoc,
} from "@/types";

/**
 * C — connector automation engine.
 *
 * A "watch" is a standing instruction to re-audit a connector document on
 * demand (or on a schedule) and, optionally, file the report back to Notion.
 *
 * This module is the orchestration glue only:
 *   - it reuses the unchanged `auditDocument` engine (no new auditor signal),
 *   - it reuses the Notion write op (`createReportPage`) for the loop-closing
 *     report, and
 *   - it persists only watch METADATA via the token store (CLAUDE.md rule 6
 *     exception — never claim text, only a content hash + verdict counts).
 *
 * Change detection: we hash the pulled page text and skip the (expensive) audit
 * when the hash matches the previous run, so a sweep over unchanged docs is
 * effectively free.
 */

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function toPublic(r: WatchRecord): ConnectorWatch {
  return {
    id: r.id,
    connector: r.connector,
    page_id: r.page_id,
    title: r.title,
    url: r.url,
    writeback: r.writeback,
    last_run_at: r.last_run_at,
    last_summary: r.last_summary,
    last_report_url: r.last_report_url,
    created_at: r.created_at,
  };
}

export function getWatches(sid: string): ConnectorWatch[] {
  return listWatchRecords(sid)
    .map(toPublic)
    .sort((a, b) => b.created_at - a.created_at);
}

export function createWatch(sid: string, body: AddWatchRequestBody): ConnectorWatch {
  // De-dupe: one watch per (connector, page) — return the existing one.
  const existing = listWatchRecords(sid).find(
    (w) => w.connector === body.connector && w.page_id === body.page_id,
  );
  if (existing) {
    if (typeof body.writeback === "boolean" && body.writeback !== existing.writeback) {
      const updated = updateWatchRecord(sid, existing.id, {
        writeback: body.writeback,
      });
      return toPublic(updated ?? existing);
    }
    return toPublic(existing);
  }

  const rec: WatchRecord = {
    id: `w_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    connector: body.connector,
    page_id: body.page_id,
    title: body.title || "Untitled",
    url: body.url ?? "",
    writeback: body.writeback ?? false,
    created_at: Date.now(),
  };
  addWatchRecord(sid, rec);
  return toPublic(rec);
}

export function setWatchWriteback(
  sid: string,
  id: string,
  writeback: boolean,
): ConnectorWatch | null {
  const updated = updateWatchRecord(sid, id, { writeback });
  return updated ? toPublic(updated) : null;
}

export function deleteWatch(sid: string, id: string): void {
  removeWatchRecord(sid, id);
}

/**
 * Run a single watch. Pulls the page, skips the audit if unchanged (unless
 * forced), runs the fact-check, and optionally files the report back to Notion.
 */
export async function runWatch(
  sid: string,
  id: string,
  force = false,
): Promise<WatchRunOutcome> {
  const rec = getWatchRecord(sid, id);
  if (!rec) return { watch_id: id, status: "error", error: "Watch not found." };

  try {
    const page = await getConnector(rec.connector).fetchPageText(sid, rec.page_id);
    const text = page.text ?? "";
    if (!text.trim()) {
      return {
        watch_id: id,
        status: "error",
        error: "Could not read any text from the page.",
      };
    }

    const hash = hashText(text);
    if (!force && rec.last_hash && hash === rec.last_hash) {
      updateWatchRecord(sid, id, { last_run_at: Date.now() });
      return {
        watch_id: id,
        status: "unchanged",
        summary: rec.last_summary,
        report_url: rec.last_report_url,
        note: "No changes since the last audit.",
      };
    }

    const title = page.title || rec.title;
    const audit = await auditDocument(text, title);
    const flagged =
      audit.summary.contradicted + audit.summary.likely_hallucination;

    const checked: WorkspaceUsedDoc = {
      connector: rec.connector,
      id: rec.page_id,
      title,
      url: page.url || rec.url,
      role: "checked",
    };
    const result: WorkspaceRunResult = {
      mode: "factcheck",
      note: `Scheduled re-audit of "${title}".`,
      used: [checked],
      audit,
    };

    let reportUrl: string | undefined;
    let status: WatchRunOutcome["status"] = "audited";
    let note: string | undefined;

    if (rec.writeback) {
      if (notionConnected(sid)) {
        const parentId = rec.connector === "notion" ? rec.page_id : undefined;
        const written = await createReportPage(sid, {
          title: reportTitle(result),
          markdown: buildReportMarkdown(result),
          parentId,
        });
        reportUrl = written.url || undefined;
      } else {
        status = "writeback_skipped";
        note = "Audited, but Notion isn't connected to file the report.";
      }
    }

    const summary = { total: audit.summary.total_claims, flagged };
    updateWatchRecord(sid, id, {
      last_hash: hash,
      last_run_at: Date.now(),
      last_summary: summary,
      last_report_url: reportUrl ?? rec.last_report_url,
    });

    return { watch_id: id, status, summary, report_url: reportUrl, note };
  } catch (err) {
    return {
      watch_id: id,
      status: "error",
      error: err instanceof Error ? err.message : "Watch run failed.",
    };
  }
}

/**
 * Run every watch for the session SEQUENTIALLY. Sequential (not Promise.all) is
 * deliberate: each run can fan out 25×3 auditor calls, so a parallel sweep over
 * many watches would blow past OpenAI/Tavily concurrency limits.
 */
export async function runAllWatches(sid: string): Promise<WatchRunOutcome[]> {
  const ids = listWatchRecords(sid).map((w) => w.id);
  const outcomes: WatchRunOutcome[] = [];
  for (const id of ids) {
    outcomes.push(await runWatch(sid, id, false));
  }
  return outcomes;
}
