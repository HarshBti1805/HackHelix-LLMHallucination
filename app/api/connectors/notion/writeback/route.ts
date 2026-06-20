import { NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import {
  NotionNotConnectedError,
  createReportPage,
  isConnected,
} from "@/lib/connectors/notion";
import { buildReportMarkdown, reportTitle } from "@/lib/connectors/report";
import type {
  NotionWritebackRequestBody,
  NotionWritebackResponseBody,
  WorkspaceRunResult,
} from "@/types";

/**
 * POST /api/connectors/notion/writeback  (C — close the loop)
 *
 * Writes an audit report back to Notion as a new page. Files it under the
 * audited Notion page when one is present (so the report lands beside its
 * source), else at the workspace root. The single connector WRITE endpoint.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

function looksLikeResult(r: unknown): r is WorkspaceRunResult {
  return (
    !!r &&
    typeof r === "object" &&
    typeof (r as WorkspaceRunResult).mode === "string" &&
    Array.isArray((r as WorkspaceRunResult).used)
  );
}

export async function POST(req: Request) {
  const sid = await getSessionId();
  if (!sid || !isConnected(sid)) {
    return NextResponse.json({ error: "Notion not connected." }, { status: 401 });
  }

  let body: NotionWritebackRequestBody;
  try {
    body = (await req.json()) as NotionWritebackRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Request body is not valid JSON." },
      { status: 400 },
    );
  }

  if (!looksLikeResult(body.result)) {
    return NextResponse.json(
      { error: "`result` must be a WorkspaceRunResult." },
      { status: 400 },
    );
  }

  const { result } = body;
  // Default parent: the audited Notion page, so the report nests under its source.
  const notionChecked =
    result.used.find((u) => u.connector === "notion" && u.role === "checked") ??
    result.used.find((u) => u.connector === "notion");
  const parentId =
    (typeof body.parent_page_id === "string" && body.parent_page_id.trim()) ||
    notionChecked?.id ||
    undefined;

  const title = reportTitle(result);
  const markdown = buildReportMarkdown(result);

  try {
    const written = await createReportPage(sid, { title, markdown, parentId });
    const res: NotionWritebackResponseBody = {
      url: written.url,
      id: written.id,
      title,
    };
    return NextResponse.json(res);
  } catch (err) {
    if (err instanceof NotionNotConnectedError) {
      return NextResponse.json({ error: "Notion not connected." }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Notion writeback failed.";
    console.error("[notion/writeback]", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
