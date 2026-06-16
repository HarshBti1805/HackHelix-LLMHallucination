import { NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import { NOTION_MCP_ENDPOINT } from "@/lib/connectors/notion";
import {
  discoverOAuthMetadata,
  exchangeCodeForTokens,
} from "@/lib/connectors/oauth";
import {
  clearPending,
  getClientCreds,
  getPending,
  setTokens,
} from "@/lib/store/tokens";

/**
 * GET /api/connectors/notion/callback  (MAJOR_CHANGES.md #C1)
 *
 * Notion redirects here with `?code&state`. We validate `state` against the
 * pending record (CSRF), exchange the code (with the stored PKCE verifier) for
 * tokens, persist them against the session, and bounce back to /workspace.
 */

export const runtime = "nodejs";

function appBaseUrl(reqUrl: string): string {
  return (process.env.APP_BASE_URL || new URL(reqUrl).origin).replace(
    /\/+$/,
    "",
  );
}

export async function GET(req: Request) {
  const base = appBaseUrl(req.url);
  const fail = (msg: string) =>
    NextResponse.redirect(
      `${base}/workspace?error=${encodeURIComponent(msg)}`,
    );

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");
    if (oauthError) return fail(`Notion: ${oauthError}`);
    if (!code || !state) return fail("Missing authorization code or state.");

    const sid = await getSessionId();
    if (!sid) return fail("Session expired. Please try connecting again.");

    const pending = getPending(sid, "notion");
    if (!pending) return fail("No pending authorization for this session.");
    if (pending.state !== state) return fail("State mismatch — possible CSRF.");

    const creds = getClientCreds(NOTION_MCP_ENDPOINT);
    if (!creds) return fail("Lost OAuth client registration. Reconnect.");

    const metadata = await discoverOAuthMetadata(NOTION_MCP_ENDPOINT);
    const tokens = await exchangeCodeForTokens({
      code,
      codeVerifier: pending.code_verifier,
      metadata,
      clientId: creds.client_id,
      clientSecret: creds.client_secret,
      redirectUri: pending.redirect_uri,
    });

    setTokens(sid, "notion", {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expires_in
        ? Date.now() + tokens.expires_in * 1000
        : undefined,
      account: "Notion workspace",
    });
    clearPending(sid, "notion");

    return NextResponse.redirect(`${base}/workspace?connected=notion`);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Notion authorization failed.";
    console.error("[notion/callback]", err);
    return fail(message);
  }
}
