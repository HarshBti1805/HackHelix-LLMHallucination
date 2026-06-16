import { NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import { GmailNotConnectedError, searchPages } from "@/lib/connectors/gmail";

/**
 * GET /api/connectors/gmail/pages?q=…
 * Search the connected mailbox (Gmail query syntax) for messages to audit.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const sid = await getSessionId();
  if (!sid) {
    return NextResponse.json({ error: "Gmail not connected." }, { status: 401 });
  }
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  try {
    const pages = await searchPages(sid, q);
    return NextResponse.json({ pages });
  } catch (err) {
    if (err instanceof GmailNotConnectedError) {
      return NextResponse.json({ error: "Gmail not connected." }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Gmail search failed.";
    console.error("[gmail/pages]", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
