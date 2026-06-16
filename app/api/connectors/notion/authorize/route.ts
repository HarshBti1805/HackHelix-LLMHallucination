import { NextResponse } from "next/server";
import { getOrCreateSessionId } from "@/lib/session";
import {
  NOTION_MCP_ENDPOINT,
  NOTION_SCOPES,
} from "@/lib/connectors/notion";
import {
  buildAuthorizationUrl,
  discoverOAuthMetadata,
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
  registerClient,
} from "@/lib/connectors/oauth";
import { getClientCreds, setClientCreds, setPending } from "@/lib/store/tokens";

/**
 * GET /api/connectors/notion/authorize  (MAJOR_CHANGES.md #C1)
 *
 * Begins the OAuth dance with Notion's hosted MCP server: discovers the OAuth
 * endpoints, registers a client on the fly (dynamic registration — no manual
 * Notion integration needed), stashes a PKCE verifier + CSRF state against the
 * session, and 302-redirects the user to Notion's consent screen.
 */

export const runtime = "nodejs";

function appBaseUrl(reqUrl: string): string {
  return (process.env.APP_BASE_URL || new URL(reqUrl).origin).replace(
    /\/+$/,
    "",
  );
}

export async function GET(req: Request) {
  try {
    const sid = await getOrCreateSessionId();
    const redirectUri = `${appBaseUrl(req.url)}/api/connectors/notion/callback`;

    const metadata = await discoverOAuthMetadata(NOTION_MCP_ENDPOINT);

    let creds = getClientCreds(NOTION_MCP_ENDPOINT);
    if (!creds) {
      creds = await registerClient(metadata, redirectUri);
      setClientCreds(NOTION_MCP_ENDPOINT, creds);
    }

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();

    setPending(sid, "notion", {
      state,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      created_at: Date.now(),
    });

    const authUrl = buildAuthorizationUrl({
      metadata,
      clientId: creds.client_id,
      redirectUri,
      codeChallenge,
      state,
      scopes: NOTION_SCOPES,
    });

    return NextResponse.redirect(authUrl);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to start Notion auth.";
    console.error("[notion/authorize]", err);
    const base = appBaseUrl(req.url);
    return NextResponse.redirect(
      `${base}/workspace?error=${encodeURIComponent(message)}`,
    );
  }
}
