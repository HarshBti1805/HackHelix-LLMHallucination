import { NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import { SlackNotConnectedError, searchPages } from "@/lib/connectors/slack";

/**
 * GET /api/connectors/slack/pages?q=…
 * Search the connected workspace (Slack search syntax) for messages to audit.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const sid = await getSessionId();
  if (!sid) {
    return NextResponse.json({ error: "Slack not connected." }, { status: 401 });
  }
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  try {
    const pages = await searchPages(sid, q);
    return NextResponse.json({ pages });
  } catch (err) {
    if (err instanceof SlackNotConnectedError) {
      return NextResponse.json({ error: "Slack not connected." }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Slack search failed.";
    console.error("[slack/pages]", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
