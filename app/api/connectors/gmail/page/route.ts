import { NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import { GmailNotConnectedError, fetchPageText } from "@/lib/connectors/gmail";

/**
 * GET /api/connectors/gmail/page?id=…
 * Fetch one message's readable body (text/plain, or stripped text/html).
 */
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const sid = await getSessionId();
  if (!sid) {
    return NextResponse.json({ error: "Gmail not connected." }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  if (!id) {
    return NextResponse.json(
      { error: "Provide a Gmail message id via ?id=" },
      { status: 400 },
    );
  }
  try {
    const page = await fetchPageText(sid, id);
    return NextResponse.json(page);
  } catch (err) {
    if (err instanceof GmailNotConnectedError) {
      return NextResponse.json({ error: "Gmail not connected." }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Gmail fetch failed.";
    console.error("[gmail/page]", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
