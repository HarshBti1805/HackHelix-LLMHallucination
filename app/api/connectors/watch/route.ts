import { NextResponse } from "next/server";
import { getOrCreateSessionId, getSessionId } from "@/lib/session";
import { createWatch, getWatches } from "@/lib/connectors/watch";
import type {
  AddWatchRequestBody,
  ConnectorId,
  WatchListResponseBody,
} from "@/types";

/**
 * GET  /api/connectors/watch  → list this session's watches.
 * POST /api/connectors/watch  → add a watch on a connector page.  (C)
 */
export const runtime = "nodejs";

const VALID_CONNECTORS: ConnectorId[] = ["notion", "google", "gmail", "slack"];

export async function GET() {
  const sid = await getSessionId();
  const body: WatchListResponseBody = {
    watches: sid ? getWatches(sid) : [],
  };
  return NextResponse.json(body);
}

export async function POST(req: Request) {
  // A watch is a per-browser registration — mint a session id if needed.
  const sid = await getOrCreateSessionId();

  let body: AddWatchRequestBody;
  try {
    body = (await req.json()) as AddWatchRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Request body is not valid JSON." },
      { status: 400 },
    );
  }

  if (!VALID_CONNECTORS.includes(body.connector)) {
    return NextResponse.json(
      { error: `Unknown connector: ${String(body.connector)}` },
      { status: 400 },
    );
  }
  if (typeof body.page_id !== "string" || body.page_id.trim().length === 0) {
    return NextResponse.json(
      { error: "`page_id` is required." },
      { status: 400 },
    );
  }

  const watch = createWatch(sid, {
    connector: body.connector,
    page_id: body.page_id.trim(),
    title: typeof body.title === "string" ? body.title : "Untitled",
    url: typeof body.url === "string" ? body.url : undefined,
    writeback: body.writeback === true,
  });
  return NextResponse.json({ watch });
}
