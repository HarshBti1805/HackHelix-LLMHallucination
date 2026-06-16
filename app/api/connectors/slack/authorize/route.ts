import { NextResponse } from "next/server";
import { getOrCreateSessionId } from "@/lib/session";
import { buildSlackAuthUrl, slackConfigured } from "@/lib/connectors/slack";
import { generateState } from "@/lib/connectors/oauth";
import { setPending } from "@/lib/store/tokens";

/**
 * GET /api/connectors/slack/authorize  (MAJOR_CHANGES.md #C1)
 *
 * Slack OAuth v2 (no PKCE). Stashes `state` + the redirect URI, then sends the
 * user to Slack's consent screen requesting user-token scopes.
 */

export const runtime = "nodejs";

function appBaseUrl(reqUrl: string): string {
  return (process.env.APP_BASE_URL || new URL(reqUrl).origin).replace(/\/+$/, "");
}

export async function GET(req: Request) {
  const base = appBaseUrl(req.url);
  try {
    if (!slackConfigured()) {
      return NextResponse.redirect(
        `${base}/workspace?error=${encodeURIComponent(
          "Slack is not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET.",
        )}`,
      );
    }

    const sid = await getOrCreateSessionId();
    const redirectUri = `${base}/api/connectors/slack/callback`;
    const state = generateState();

    setPending(sid, "slack", {
      state,
      code_verifier: "", // Slack does not use PKCE.
      redirect_uri: redirectUri,
      created_at: Date.now(),
    });

    const authUrl = buildSlackAuthUrl({
      clientId: process.env.SLACK_CLIENT_ID as string,
      redirectUri,
      state,
    });

    return NextResponse.redirect(authUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start Slack auth.";
    console.error("[slack/authorize]", err);
    return NextResponse.redirect(
      `${base}/workspace?error=${encodeURIComponent(message)}`,
    );
  }
}
