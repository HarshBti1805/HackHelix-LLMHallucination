import { NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import { exchangeSlackCode } from "@/lib/connectors/slack";
import { clearPending, getPending, setTokens } from "@/lib/store/tokens";

/**
 * GET /api/connectors/slack/callback  (MAJOR_CHANGES.md #C1)
 * Validates state, exchanges the code for a Slack *user* token, labels it with
 * the workspace name, persists under the "slack" connector, and bounces back.
 */

export const runtime = "nodejs";

function appBaseUrl(reqUrl: string): string {
  return (process.env.APP_BASE_URL || new URL(reqUrl).origin).replace(/\/+$/, "");
}

export async function GET(req: Request) {
  const base = appBaseUrl(req.url);
  const fail = (msg: string) =>
    NextResponse.redirect(`${base}/workspace?error=${encodeURIComponent(msg)}`);

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");
    if (oauthError) return fail(`Slack: ${oauthError}`);
    if (!code || !state) return fail("Missing authorization code or state.");

    const sid = await getSessionId();
    if (!sid) return fail("Session expired. Please try connecting again.");

    const pending = getPending(sid, "slack");
    if (!pending) return fail("No pending authorization for this session.");
    if (pending.state !== state) return fail("State mismatch — possible CSRF.");

    const clientId = process.env.SLACK_CLIENT_ID;
    const clientSecret = process.env.SLACK_CLIENT_SECRET;
    if (!clientId || !clientSecret) return fail("Slack client credentials missing.");

    const result = await exchangeSlackCode({
      code,
      clientId,
      clientSecret,
      redirectUri: pending.redirect_uri,
    });

    setTokens(sid, "slack", {
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      expires_at: result.expiresIn
        ? Date.now() + result.expiresIn * 1000
        : undefined,
      account: result.account,
    });
    clearPending(sid, "slack");

    return NextResponse.redirect(`${base}/workspace?connected=slack`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Slack authorization failed.";
    console.error("[slack/callback]", err);
    return fail(message);
  }
}
