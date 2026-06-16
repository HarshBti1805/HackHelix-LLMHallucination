import { NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import {
  connectedAccount,
  googleConfigured,
  isConnected,
} from "@/lib/connectors/gmail";
import type { ConnectorStatus } from "@/types";

/** GET /api/connectors/gmail/status → ConnectorStatus (no network call). */
export const runtime = "nodejs";

export async function GET() {
  const sid = await getSessionId();
  const connected = sid ? isConnected(sid) : false;
  const status: ConnectorStatus & { configured: boolean } = {
    connector: "gmail",
    connected,
    account: connected && sid ? connectedAccount(sid) : undefined,
    configured: googleConfigured(),
  };
  return NextResponse.json(status);
}
