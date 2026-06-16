import { NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import {
  GOOGLE_OAUTH_METADATA,
  fetchAccountEmail,
} from "@/lib/connectors/gmail";
import { exchangeCodeForTokens } from "@/lib/connectors/oauth";
import { clearPending, getPending, setTokens } from "@/lib/store/tokens";

/**
 * GET /api/connectors/gmail/callback  (MAJOR_CHANGES.md #C1)
 * Validates state, exchanges the code for tokens, labels with the account
 * email, persists under the "gmail" connector, and bounces back.
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
    if (oauthError) return fail(`Gmail: ${oauthError}`);
    if (!code || !state) return fail("Missing authorization code or state.");

    const sid = await getSessionId();
    if (!sid) return fail("Session expired. Please try connecting again.");

    const pending = getPending(sid, "gmail");
    if (!pending) return fail("No pending authorization for this session.");
    if (pending.state !== state) return fail("State mismatch — possible CSRF.");

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return fail("Google client credentials missing.");

    const tokens = await exchangeCodeForTokens({
      code,
      codeVerifier: pending.code_verifier,
      metadata: GOOGLE_OAUTH_METADATA,
      clientId,
      clientSecret,
      redirectUri: pending.redirect_uri,
    });

    const account = await fetchAccountEmail(tokens.access_token);

    setTokens(sid, "gmail", {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expires_in
        ? Date.now() + tokens.expires_in * 1000
        : undefined,
      account,
    });
    clearPending(sid, "gmail");

    return NextResponse.redirect(`${base}/workspace?connected=gmail`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gmail authorization failed.";
    console.error("[gmail/callback]", err);
    return fail(message);
  }
}
