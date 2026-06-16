import { NextResponse } from "next/server";
import { getOrCreateSessionId } from "@/lib/session";
import {
  GOOGLE_AUTH_EXTRA_PARAMS,
  GOOGLE_OAUTH_METADATA,
  GOOGLE_SCOPES,
  googleConfigured,
} from "@/lib/connectors/google";
import {
  buildAuthorizationUrl,
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
} from "@/lib/connectors/oauth";
import { setPending } from "@/lib/store/tokens";

/**
 * GET /api/connectors/google/authorize  (MAJOR_CHANGES.md #C1)
 *
 * Begins Google's OAuth flow. Unlike Notion there is no discovery / dynamic
 * registration — Google's endpoints are well-known and the client id/secret
 * come from a Google Cloud OAuth app (`GOOGLE_CLIENT_ID` /
 * `GOOGLE_CLIENT_SECRET`). We stash a PKCE verifier + CSRF state and redirect to
 * Google's consent screen with `access_type=offline` so a refresh token is
 * issued.
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
    const redirectUri = `${base}/api/connectors/google/callback`;

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();

    setPending(sid, "google", {
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
      scopes: GOOGLE_SCOPES,
      extraParams: GOOGLE_AUTH_EXTRA_PARAMS,
    });

    return NextResponse.redirect(authUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start Google auth.";
    console.error("[google/authorize]", err);
    return NextResponse.redirect(
      `${base}/workspace?error=${encodeURIComponent(message)}`,
    );
  }
}
