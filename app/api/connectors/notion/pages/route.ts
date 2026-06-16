import { NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import { NotionNotConnectedError, searchPages } from "@/lib/connectors/notion";

/**
 * GET /api/connectors/notion/pages?q=…
 * Search the connected Notion workspace for source pages to audit against.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const sid = await getSessionId();
  if (!sid) {
    return NextResponse.json({ error: "Notion not connected." }, { status: 401 });
  }
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  try {
    const pages = await searchPages(sid, q);
    return NextResponse.json({ pages });
  } catch (err) {
    if (err instanceof NotionNotConnectedError) {
      return NextResponse.json({ error: "Notion not connected." }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Notion search failed.";
    console.error("[notion/pages]", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
