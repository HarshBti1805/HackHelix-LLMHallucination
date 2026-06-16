import { NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import { GoogleNotConnectedError, fetchPageText } from "@/lib/connectors/google";

/**
 * GET /api/connectors/google/page?id=…
 * Fetch one Drive file's text (Google Doc → text/plain export, or text file).
 */
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const sid = await getSessionId();
  if (!sid) {
    return NextResponse.json({ error: "Google not connected." }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  if (!id) {
    return NextResponse.json(
      { error: "Provide a Drive file id via ?id=" },
      { status: 400 },
    );
  }
  try {
    const page = await fetchPageText(sid, id);
    return NextResponse.json(page);
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) {
      return NextResponse.json({ error: "Google not connected." }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Google fetch failed.";
    console.error("[google/page]", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
