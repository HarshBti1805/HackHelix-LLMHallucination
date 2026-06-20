import { NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import { deleteWatch, setWatchWriteback } from "@/lib/connectors/watch";
import type { UpdateWatchRequestBody } from "@/types";

/**
 * PATCH  /api/connectors/watch/:id  → toggle writeback.
 * DELETE /api/connectors/watch/:id  → remove the watch.  (C)
 */
export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const sid = await getSessionId();
  if (!sid) return NextResponse.json({ error: "No session." }, { status: 401 });

  const { id } = await params;
  let body: UpdateWatchRequestBody;
  try {
    body = (await req.json()) as UpdateWatchRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Request body is not valid JSON." },
      { status: 400 },
    );
  }
  if (typeof body.writeback !== "boolean") {
    return NextResponse.json(
      { error: "`writeback` (boolean) is required." },
      { status: 400 },
    );
  }

  const watch = setWatchWriteback(sid, id, body.writeback);
  if (!watch) {
    return NextResponse.json({ error: "Watch not found." }, { status: 404 });
  }
  return NextResponse.json({ watch });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const sid = await getSessionId();
  if (!sid) return NextResponse.json({ error: "No session." }, { status: 401 });
  const { id } = await params;
  deleteWatch(sid, id);
  return NextResponse.json({ ok: true });
}
