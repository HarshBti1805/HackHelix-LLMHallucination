import { NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import { connectedAccount, isConnected } from "@/lib/connectors/notion";
import type { ConnectorStatus } from "@/types";

/** GET /api/connectors/notion/status → ConnectorStatus (no network call). */
export const runtime = "nodejs";

export async function GET() {
  const sid = await getSessionId();
  const connected = sid ? isConnected(sid) : false;
  const status: ConnectorStatus = {
    connector: "notion",
    connected,
    account: connected && sid ? connectedAccount(sid) : undefined,
  };
  return NextResponse.json(status);
}
