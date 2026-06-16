import { NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import { GoogleNotConnectedError, searchPages } from "@/lib/connectors/google";

/**
 * GET /api/connectors/google/pages?q=…
 * Search the connected Google Drive for Docs / text files to audit.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const sid = await getSessionId();
  if (!sid) {
    return NextResponse.json({ error: "Google not connected." }, { status: 401 });
  }
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  try {
    const pages = await searchPages(sid, q);
    return NextResponse.json({ pages });
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) {
      return NextResponse.json({ error: "Google not connected." }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Google search failed.";
    console.error("[google/pages]", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
