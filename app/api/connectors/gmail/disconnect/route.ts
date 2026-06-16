import { NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import { clearTokens } from "@/lib/store/tokens";

/** POST /api/connectors/gmail/disconnect → forget this session's tokens. */
export const runtime = "nodejs";

export async function POST() {
  const sid = await getSessionId();
  if (sid) clearTokens(sid, "gmail");
  return NextResponse.json({ ok: true });
}
