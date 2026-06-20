import { NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import { runAllWatches, runWatch } from "@/lib/connectors/watch";
import type { WatchRunRequestBody, WatchRunResponseBody } from "@/types";

/**
 * POST /api/connectors/watch/run  (C)
 *
 * Runs one watch (`{ id }`) or all of the session's watches (no id). Each run
 * pulls the page, skips unchanged docs, re-audits changed ones, and files the
 * report back to Notion when the watch has writeback on.
 *
 * This is the on-demand trigger. A scheduled trigger (cron / queue) would call
 * the same `runAllWatches` per session — see the C design notes.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const sid = await getSessionId();
  if (!sid) {
    return NextResponse.json(
      { error: "No session — connect a source first." },
      { status: 401 },
    );
  }

  let body: WatchRunRequestBody = {};
  try {
    body = (await req.json()) as WatchRunRequestBody;
  } catch {
    // Empty body is fine — defaults to "run all".
  }

  const outcomes =
    typeof body.id === "string" && body.id.trim()
      ? [await runWatch(sid, body.id.trim(), body.force === true)]
      : await runAllWatches(sid);

  const res: WatchRunResponseBody = { outcomes };
  return NextResponse.json(res);
}
