import { createHash, randomBytes } from "node:crypto";

/**
 * Generic OAuth 2.0 + PKCE client for OAuth-protected MCP servers.
 *
 * This is connector-agnostic: it speaks the RFC 9470 (protected-resource
 * metadata) → RFC 8414 (authorization-server metadata) discovery flow, RFC 7591
 * dynamic client registration, and the Authorization-Code-with-PKCE exchange.
 * Notion's hosted MCP server (`mcp.notion.com`) implements all three, which is
 * why a user can connect WITHOUT us pre-registering an integration — the client
 * is registered on the fly.
 *
 * It contains no Notion-specific or MCP-tool logic; `lib/connectors/notion.ts`
 * layers that on top. It performs no persistence; the API routes store the
 * results via `lib/store/tokens.ts`.
 *
 * Closely follows Notion's official "Integrating your own MCP client" guide.
 */

export interface OAuthMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  code_challenge_methods_supported?: string[];
  scopes_supported?: string[];
}

export interface ClientCredentials {
  client_id: string;
  client_secret?: string;
}

export interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

const USER_AGENT = "Groundtruth-MCP-Client/0.1";

function base64URLEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export function generateCodeVerifier(): string {
  return base64URLEncode(randomBytes(32));
}

export function generateCodeChallenge(verifier: string): string {
  return base64URLEncode(createHash("sha256").update(verifier).digest());
}

export function generateState(): string {
  return randomBytes(32).toString("hex");
}

/**
 * RFC 9470 → RFC 8414 discovery. Given an MCP server URL, find the OAuth
 * endpoints that protect it.
 */
export async function discoverOAuthMetadata(
  mcpServerUrl: string,
): Promise<OAuthMetadata> {
  const url = new URL(mcpServerUrl);
  const protectedResourceUrl = new URL(
    "/.well-known/oauth-protected-resource",
    url,
  );

  const prRes = await fetch(protectedResourceUrl.toString(), {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!prRes.ok) {
    throw new Error(
      `Failed to fetch protected resource metadata: ${prRes.status}`,
    );
  }
  const protectedResource = (await prRes.json()) as {
    authorization_servers?: string[];
  };
  const authServers = protectedResource.authorization_servers;
  if (!Array.isArray(authServers) || authServers.length === 0) {
    throw new Error("No authorization servers in protected resource metadata.");
  }

  const authServerUrl = authServers[0];
  const metadataUrl = new URL(
    "/.well-known/oauth-authorization-server",
    authServerUrl,
  );
  const mdRes = await fetch(metadataUrl.toString(), {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!mdRes.ok) {
    throw new Error(
      `Failed to fetch authorization server metadata: ${mdRes.status}`,
    );
  }
  const metadata = (await mdRes.json()) as OAuthMetadata;
  if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw new Error("Missing required OAuth endpoints in metadata.");
  }
  return metadata;
}

/** RFC 7591 dynamic client registration. */
export async function registerClient(
  metadata: OAuthMetadata,
  redirectUri: string,
): Promise<ClientCredentials> {
  if (!metadata.registration_endpoint) {
    throw new Error("Server does not support dynamic client registration.");
  }
  const res = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      client_name: "Groundtruth Auditor",
      client_uri: process.env.APP_BASE_URL || "http://localhost:3000",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Client registration failed: ${res.status} - ${await res.text()}`,
    );
  }
  return (await res.json()) as ClientCredentials;
}

export function buildAuthorizationUrl(args: {
  metadata: OAuthMetadata;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scopes?: string[];
  /**
   * Provider-specific extras. Google needs `access_type=offline` (to issue a
   * refresh token) and `include_granted_scopes=true`; Notion needs none.
   */
  extraParams?: Record<string, string>;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    scope: (args.scopes ?? []).join(" "),
    state: args.state,
    code_challenge: args.codeChallenge,
    code_challenge_method: "S256",
    prompt: "consent",
  });
  for (const [k, v] of Object.entries(args.extraParams ?? {})) {
    params.set(k, v);
  }
  return `${args.metadata.authorization_endpoint}?${params.toString()}`;
}

export async function exchangeCodeForTokens(args: {
  code: string;
  codeVerifier: string;
  metadata: OAuthMetadata;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    code_verifier: args.codeVerifier,
  });
  if (args.clientSecret) params.append("client_secret", args.clientSecret);

  const res = await fetch(args.metadata.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body: params.toString(),
  });
  if (!res.ok) {
    throw new Error(
      `Token exchange failed: ${res.status} - ${await res.text()}`,
    );
  }
  const tokens = (await res.json()) as TokenResponse;
  if (!tokens.access_token) throw new Error("Missing access_token in response.");
  return tokens;
}

/**
 * Refresh an access token. Throws `Error("REAUTH_REQUIRED")` when the refresh
 * token is no longer valid so callers can prompt a reconnect rather than retry.
 */
export async function refreshAccessToken(args: {
  refreshToken: string;
  metadata: OAuthMetadata;
  clientId: string;
  clientSecret?: string;
}): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: args.refreshToken,
    client_id: args.clientId,
  });
  if (args.clientSecret) params.append("client_secret", args.clientSecret);

  const res = await fetch(args.metadata.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error === "invalid_grant") throw new Error("REAUTH_REQUIRED");
    } catch (e) {
      if (e instanceof Error && e.message === "REAUTH_REQUIRED") throw e;
    }
    throw new Error(`Token refresh failed: ${res.status} - ${body}`);
  }
  return (await res.json()) as TokenResponse;
}
