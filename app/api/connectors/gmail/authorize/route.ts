import { NextResponse } from "next/server";
import { getOrCreateSessionId } from "@/lib/session";
import {
  GMAIL_SCOPES,
  GOOGLE_AUTH_EXTRA_PARAMS,
  GOOGLE_OAUTH_METADATA,
  googleConfigured,
} from "@/lib/connectors/gmail";
import {
  buildAuthorizationUrl,
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
} from "@/lib/connectors/oauth";
import { setPending } from "@/lib/store/tokens";

/**
 * GET /api/connectors/gmail/authorize  (MAJOR_CHANGES.md #C1)
 *
 * Same Google OAuth app as the Drive connector, but requests the gmail.readonly
 * scope and uses the gmail-specific redirect URI. Stashes PKCE + state, then
 * redirects to Google's consent screen with offline access.
 */

export const runtime = "nodejs";

function appBaseUrl(reqUrl: string): string {
  return (process.env.APP_BASE_URL || new URL(reqUrl).origin).replace(/\/+$/, "");
}

export async function GET(req: Request) {
  const base = appBaseUrl(req.url);
  try {
    if (!googleConfigured()) {
      return NextResponse.redirect(
        `${base}/workspace?error=${encodeURIComponent(
          "Google is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
        )}`,
      );
    }

    const sid = await getOrCreateSessionId();
    const redirectUri = `${base}/api/connectors/gmail/callback`;

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();

    setPending(sid, "gmail", {
      state,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      created_at: Date.now(),
    });

    const authUrl = buildAuthorizationUrl({
      metadata: GOOGLE_OAUTH_METADATA,
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      redirectUri,
      codeChallenge,
      state,
      scopes: GMAIL_SCOPES,
      extraParams: GOOGLE_AUTH_EXTRA_PARAMS,
    });

    return NextResponse.redirect(authUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start Gmail auth.";
    console.error("[gmail/authorize]", err);
    return NextResponse.redirect(
      `${base}/workspace?error=${encodeURIComponent(message)}`,
    );
  }
}
