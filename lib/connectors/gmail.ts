import { refreshAccessToken } from "@/lib/connectors/oauth";
import {
  GOOGLE_OAUTH_METADATA,
  GOOGLE_AUTH_EXTRA_PARAMS,
  googleConfigured,
  fetchAccountEmail,
} from "@/lib/connectors/google";
import {
  getTokens,
  setTokens,
  clearTokens,
  type ConnectorTokens,
} from "@/lib/store/tokens";
import { htmlToText } from "@/lib/html-extract";
import type { ConnectorPageRef, ConnectorPageTextResponse } from "@/types";

/**
 * Gmail source connector (MAJOR_CHANGES.md #C1).
 *
 * Reuses the SAME Google Cloud OAuth app as the Drive connector (`google.ts`) —
 * same `GOOGLE_CLIENT_ID/SECRET`, same well-known OAuth endpoints — but it is a
 * separate `ConnectorId` ("gmail") with its own scope (`gmail.readonly`), its
 * own token, and its own redirect URI, so the registry/UI treat it like any
 * other source. A Gmail "page" is one message: `searchPages` lists/searches
 * messages, `fetchPageText` returns the message's readable body — perfect for
 * auditing an emailed AI meeting summary.
 *
 * Pulls text only; never audits.
 */

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "openid",
  "email",
];

export { GOOGLE_OAUTH_METADATA, GOOGLE_AUTH_EXTRA_PARAMS, googleConfigured };

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_RESULTS = 15;
const MAX_BODY_CHARS = 120_000;

export class GmailNotConnectedError extends Error {
  constructor() {
    super("Gmail is not connected for this session.");
    this.name = "GmailNotConnectedError";
  }
}

async function ensureAccessToken(sid: string): Promise<string> {
  const tokens = getTokens(sid, "gmail");
  if (!tokens) throw new GmailNotConnectedError();

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
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? tokens.refresh_token,
      expires_at: refreshed.expires_in
        ? Date.now() + refreshed.expires_in * 1000
        : undefined,
      account: tokens.account,
    };
    setTokens(sid, "gmail", next);
    return next.access_token;
  } catch (err) {
    if (err instanceof Error && err.message === "REAUTH_REQUIRED") {
      clearTokens(sid, "gmail");
      throw new GmailNotConnectedError();
    }
    throw err;
  }
}

async function gmailFetch(sid: string, url: string): Promise<Response> {
  const token = await ensureAccessToken(sid);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    clearTokens(sid, "gmail");
    throw new GmailNotConnectedError();
  }
  return res;
}

export function isConnected(sid: string): boolean {
  return getTokens(sid, "gmail") !== null;
}

export function connectedAccount(sid: string): string | undefined {
  return getTokens(sid, "gmail")?.account;
}

export { fetchAccountEmail };

interface GmailHeader {
  name?: string;
  value?: string;
}
interface GmailPart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
  headers?: GmailHeader[];
}
interface GmailMessage {
  id: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

function header(headers: GmailHeader[] | undefined, name: string): string {
  if (!Array.isArray(headers)) return "";
  const h = headers.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value?.trim() ?? "";
}

function decodeB64Url(data: string): string {
  try {
    return Buffer.from(data, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

/** Walk the MIME tree, preferring text/plain; fall back to stripped text/html. */
function extractBody(payload: GmailPart | undefined): string {
  if (!payload) return "";
  const plains: string[] = [];
  const htmls: string[] = [];

  const walk = (part: GmailPart) => {
    const mime = part.mimeType ?? "";
    if (part.body?.data) {
      if (mime === "text/plain") plains.push(decodeB64Url(part.body.data));
      else if (mime === "text/html") htmls.push(decodeB64Url(part.body.data));
    }
    part.parts?.forEach(walk);
  };
  walk(payload);

  if (plains.join("").trim()) return plains.join("\n").trim();
  if (htmls.join("").trim()) return htmlToText(htmls.join("\n")).text;
  return "";
}

export async function searchPages(
  sid: string,
  query: string,
): Promise<ConnectorPageRef[]> {
  const params = new URLSearchParams({ maxResults: String(MAX_RESULTS) });
  const q = query.trim();
  if (q) params.set("q", q);

  const listRes = await gmailFetch(sid, `${GMAIL_API}/messages?${params.toString()}`);
  if (!listRes.ok) {
    throw new Error(
      `Gmail search failed (${listRes.status}): ${(await listRes.text()).slice(0, 300)}`,
    );
  }
  const list = (await listRes.json()) as { messages?: { id: string }[] };
  const ids = (list.messages ?? []).map((m) => m.id).filter(Boolean);

  const metaParams = new URLSearchParams({ format: "metadata" });
  for (const h of ["Subject", "From", "Date"]) metaParams.append("metadataHeaders", h);

  const metas = await Promise.all(
    ids.map(async (id) => {
      try {
        const r = await gmailFetch(
          sid,
          `${GMAIL_API}/messages/${id}?${metaParams.toString()}`,
        );
        if (!r.ok) return null;
        return (await r.json()) as GmailMessage;
      } catch {
        return null;
      }
    }),
  );

  const refs: ConnectorPageRef[] = [];
  for (const m of metas) {
    if (!m?.id) continue;
    const subject = header(m.payload?.headers, "Subject") || "(no subject)";
    const from = header(m.payload?.headers, "From");
    const date = m.internalDate
      ? new Date(Number(m.internalDate)).toISOString().slice(0, 10)
      : "";
    refs.push({
      id: m.id,
      title: subject,
      url: `https://mail.google.com/mail/u/0/#all/${m.id}`,
      last_edited: date,
      snippet: [from, m.snippet].filter(Boolean).join(" — ").slice(0, 200),
    });
  }
  return refs;
}

export async function fetchPageText(
  sid: string,
  id: string,
): Promise<ConnectorPageTextResponse> {
  const res = await gmailFetch(sid, `${GMAIL_API}/messages/${id}?format=full`);
  if (!res.ok) {
    throw new Error(
      `Gmail fetch failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
    );
  }
  const msg = (await res.json()) as GmailMessage;
  const subject = header(msg.payload?.headers, "Subject") || "(no subject)";
  const from = header(msg.payload?.headers, "From");
  const date = header(msg.payload?.headers, "Date");
  const body = extractBody(msg.payload) || msg.snippet || "";

  // Prepend the envelope so the auditor has sender/date context.
  const preamble = [from && `From: ${from}`, date && `Date: ${date}`, `Subject: ${subject}`]
    .filter(Boolean)
    .join("\n");
  const text = `${preamble}\n\n${body}`.slice(0, MAX_BODY_CHARS);

  return {
    id,
    title: subject,
    url: `https://mail.google.com/mail/u/0/#all/${id}`,
    text,
  };
}
