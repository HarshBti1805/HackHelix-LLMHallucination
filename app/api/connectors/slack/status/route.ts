import { NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import {
  connectedAccount,
  isConnected,
  slackConfigured,
} from "@/lib/connectors/slack";
import type { ConnectorStatus } from "@/types";

/** GET /api/connectors/slack/status → ConnectorStatus (no network call). */
export const runtime = "nodejs";

export async function GET() {
  const sid = await getSessionId();
  const connected = sid ? isConnected(sid) : false;
  const status: ConnectorStatus & { configured: boolean } = {
    connector: "slack",
    connected,
    account: connected && sid ? connectedAccount(sid) : undefined,
    configured: slackConfigured(),
  };
  return NextResponse.json(status);
}
