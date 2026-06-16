import { NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import { NotionNotConnectedError, fetchPageText } from "@/lib/connectors/notion";

/**
 * GET /api/connectors/notion/page?id=…
 * Fetch one Notion page's text to use as trusted context for groundedness.
 * `id` accepts a Notion page id OR a full Notion page URL.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const sid = await getSessionId();
  if (!sid) {
    return NextResponse.json({ error: "Notion not connected." }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  if (!id) {
    return NextResponse.json(
      { error: "Provide a Notion page id or URL via ?id=" },
      { status: 400 },
    );
  }
  try {
    const page = await fetchPageText(sid, id);
    return NextResponse.json(page);
  } catch (err) {
    if (err instanceof NotionNotConnectedError) {
      return NextResponse.json({ error: "Notion not connected." }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Notion fetch failed.";
    console.error("[notion/page]", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
