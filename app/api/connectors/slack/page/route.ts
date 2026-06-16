import { NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import { SlackNotConnectedError, fetchPageText } from "@/lib/connectors/slack";

/**
 * GET /api/connectors/slack/page?id=…
 * Fetch one message's thread as readable text (channel:ts reference).
 */
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const sid = await getSessionId();
  if (!sid) {
    return NextResponse.json({ error: "Slack not connected." }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  if (!id) {
    return NextResponse.json(
      { error: "Provide a Slack message reference via ?id=" },
      { status: 400 },
    );
  }
  try {
    const page = await fetchPageText(sid, id);
    return NextResponse.json(page);
  } catch (err) {
    if (err instanceof SlackNotConnectedError) {
      return NextResponse.json({ error: "Slack not connected." }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Slack fetch failed.";
    console.error("[slack/page]", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
