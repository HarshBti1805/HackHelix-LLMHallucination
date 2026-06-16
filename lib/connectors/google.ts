import {
  refreshAccessToken,
  type OAuthMetadata,
} from "@/lib/connectors/oauth";
import {
  getTokens,
  setTokens,
  clearTokens,
  type ConnectorTokens,
} from "@/lib/store/tokens";
import type { ConnectorPageRef, ConnectorPageTextResponse } from "@/types";

/**
 * Google Drive / Docs source connector (MAJOR_CHANGES.md #C1).
 *
 * Unlike Notion, Google has no hosted MCP server with dynamic client
 * registration, so this connector talks to the Drive + Docs REST API directly
 * over OAuth 2.0 (a Google Cloud OAuth app — `GOOGLE_CLIENT_ID` /
 * `GOOGLE_CLIENT_SECRET`). It deliberately exposes the SAME shape as the Notion
 * connector (`searchPages` / `fetchPageText` / `isConnected` /
 * `connectedAccount`) so `lib/connectors/registry.ts` and the workspace
 * orchestrator treat every source identically — only the transport differs.
 *
 * It pulls text only; it never audits (same separation as `lib/search.ts`).
 * v1 supports native Google Docs (exported to text/plain) and plain-text /
 * markdown files; other binary types are reported as unsupported.
 */

// Google's well-known OAuth endpoints (no discovery needed).
export const GOOGLE_OAUTH_METADATA: OAuthMetadata = {
  issuer: "https://accounts.google.com",
  authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  token_endpoint: "https://oauth2.googleapis.com/token",
};

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "openid",
  "email",
];

// Refresh-token issuance + scope-incremental consent.
export const GOOGLE_AUTH_EXTRA_PARAMS: Record<string, string> = {
  access_type: "offline",
  include_granted_scopes: "true",
};

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DOC_MIME = "application/vnd.google-apps.document";
const TEXT_MIMES = ["text/plain", "text/markdown"];
const MAX_PAGE_CHARS = 180_000;

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export class GoogleNotConnectedError extends Error {
  constructor() {
    super("Google is not connected for this session.");
    this.name = "GoogleNotConnectedError";
  }
}

async function ensureAccessToken(sid: string): Promise<string> {
  const tokens = getTokens(sid, "google");
  if (!tokens) throw new GoogleNotConnectedError();

  const skewMs = 60_000;
  const stillValid =
    typeof tokens.expires_at === "number"
      ? Date.now() < tokens.expires_at - skewMs
      : true;
  if (stillValid) return tokens.access_token;

  if (!tokens.refresh_token) return tokens.access_token;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return tokens.access_token;

  try {
    const refreshed = await refreshAccessToken({
      refreshToken: tokens.refresh_token,
      metadata: GOOGLE_OAUTH_METADATA,
      clientId,
      clientSecret,
    });
    const next: ConnectorTokens = {
      // Google does not return a new refresh_token on refresh — keep the old.
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? tokens.refresh_token,
      expires_at: refreshed.expires_in
        ? Date.now() + refreshed.expires_in * 1000
        : undefined,
      account: tokens.account,
    };
    setTokens(sid, "google", next);
    return next.access_token;
  } catch (err) {
    if (err instanceof Error && err.message === "REAUTH_REQUIRED") {
      clearTokens(sid, "google");
      throw new GoogleNotConnectedError();
    }
    throw err;
  }
}

async function driveFetch(sid: string, url: string): Promise<Response> {
  const token = await ensureAccessToken(sid);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    // Token rejected mid-flight — force a reconnect.
    clearTokens(sid, "google");
    throw new GoogleNotConnectedError();
  }
  return res;
}

export function isConnected(sid: string): boolean {
  return getTokens(sid, "google") !== null;
}

export function connectedAccount(sid: string): string | undefined {
  return getTokens(sid, "google")?.account;
}

/** Look up the signed-in account's email (used as the display label). */
export async function fetchAccountEmail(accessToken: string): Promise<string> {
  try {
    const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return "Google account";
    const data = (await res.json()) as { email?: string };
    return data.email || "Google account";
  } catch {
    return "Google account";
  }
}

function escapeQ(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

interface DriveFile {
  id: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  webViewLink?: string;
}

export async function searchPages(
  sid: string,
  query: string,
): Promise<ConnectorPageRef[]> {
  const typeFilter = `(mimeType='${DOC_MIME}' or ${TEXT_MIMES.map(
    (m) => `mimeType='${m}'`,
  ).join(" or ")})`;
  const clauses = ["trashed=false", typeFilter];
  const q = query.trim();
  if (q) {
    const esc = escapeQ(q);
    clauses.push(`(name contains '${esc}' or fullText contains '${esc}')`);
  }

  const params = new URLSearchParams({
    q: clauses.join(" and "),
    pageSize: "25",
    orderBy: "modifiedTime desc",
    fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
    spaces: "drive",
    corpora: "user",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });

  const res = await driveFetch(sid, `${DRIVE_FILES}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(
      `Google Drive search failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
    );
  }
  const data = (await res.json()) as { files?: DriveFile[] };
  const files = Array.isArray(data.files) ? data.files : [];
  return files
    .filter((f) => f.id)
    .map((f) => ({
      id: f.id,
      title: f.name?.trim() || "Untitled",
      url: f.webViewLink || `https://drive.google.com/open?id=${f.id}`,
      last_edited: f.modifiedTime ? f.modifiedTime.slice(0, 10) : "",
    }));
}

export async function fetchPageText(
  sid: string,
  id: string,
): Promise<ConnectorPageTextResponse> {
  // Metadata first — we need the mimeType to choose export vs download.
  const metaParams = new URLSearchParams({
    fields: "id,name,mimeType,webViewLink",
    supportsAllDrives: "true",
  });
  const metaRes = await driveFetch(
    sid,
    `${DRIVE_FILES}/${encodeURIComponent(id)}?${metaParams.toString()}`,
  );
  if (!metaRes.ok) {
    throw new Error(
      `Google Drive fetch failed (${metaRes.status}): ${(await metaRes.text()).slice(0, 300)}`,
    );
  }
  const meta = (await metaRes.json()) as DriveFile;
  const title = meta.name?.trim() || "Google Doc";
  const url = meta.webViewLink || `https://drive.google.com/open?id=${id}`;

  let textRes: Response;
  if (meta.mimeType === DOC_MIME) {
    const p = new URLSearchParams({
      mimeType: "text/plain",
      supportsAllDrives: "true",
    });
    textRes = await driveFetch(
      sid,
      `${DRIVE_FILES}/${encodeURIComponent(id)}/export?${p.toString()}`,
    );
  } else if (meta.mimeType && TEXT_MIMES.includes(meta.mimeType)) {
    const p = new URLSearchParams({ alt: "media", supportsAllDrives: "true" });
    textRes = await driveFetch(
      sid,
      `${DRIVE_FILES}/${encodeURIComponent(id)}?${p.toString()}`,
    );
  } else {
    throw new Error(
      `"${title}" is a ${meta.mimeType ?? "binary"} file — only Google Docs and text files are supported for now.`,
    );
  }

  if (!textRes.ok) {
    throw new Error(
      `Could not read "${title}" (${textRes.status}): ${(await textRes.text()).slice(0, 200)}`,
    );
  }
  const text = (await textRes.text()).slice(0, MAX_PAGE_CHARS);
  return { id, title, url, text };
}
