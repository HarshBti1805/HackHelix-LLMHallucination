import { NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import {
  connectedAccount,
  googleConfigured,
  isConnected,
} from "@/lib/connectors/google";
import type { ConnectorStatus } from "@/types";

/** GET /api/connectors/google/status → ConnectorStatus (no network call). */
export const runtime = "nodejs";

export async function GET() {
  const sid = await getSessionId();
  const connected = sid ? isConnected(sid) : false;
  const status: ConnectorStatus & { configured: boolean } = {
    connector: "google",
    connected,
    account: connected && sid ? connectedAccount(sid) : undefined,
    configured: googleConfigured(),
  };
  return NextResponse.json(status);
}
