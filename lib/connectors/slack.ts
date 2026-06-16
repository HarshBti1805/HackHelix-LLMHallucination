import {
  getTokens,
  setTokens,
  clearTokens,
} from "@/lib/store/tokens";
import type { ConnectorPageRef, ConnectorPageTextResponse } from "@/types";

/**
 * Slack source connector (MAJOR_CHANGES.md #C1).
 *
 * Like Google/Gmail, Slack has no hosted MCP server, so this talks to the Slack
 * Web API directly over OAuth v2 (`SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET`).
 * Slack's flow differs from the generic PKCE client in three ways, so the auth
 * helpers live here rather than in `lib/connectors/oauth.ts`:
 *   1. No PKCE — Slack authenticates the token exchange with the client secret.
 *   2. The token we want is the *user* token (`authed_user.access_token`), since
 *      `search.messages` and reading channel history require a user token.
 *   3. The token endpoint returns HTTP 200 with `{ ok: false, error }` on
 *      failure rather than a non-2xx status.
 *
 * A Slack "page" is a message (and, when fetched, its surrounding thread):
 * `searchPages` runs `search.messages`; `fetchPageText` pulls the thread via
 * `conversations.replies` (falling back to a single message). Perfect for
 * auditing a Slack-posted summary against the thread it came from, or
 * fact-checking a customer-facing reply before it's sent.
 *
 * Pulls text only; never audits.
 */

export const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
export const SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access";

// User-token scopes: search + read history so we can pull a message's thread,
// plus channel/user lookups to label the conversation and its authors.
export const SLACK_USER_SCOPES = [
  "search:read",
  "channels:history",
  "groups:history",
  "channels:read",
  "groups:read",
  "users:read",
];

const SLACK_API = "https://slack.com/api";
const MAX_RESULTS = 15;
const MAX_THREAD_MESSAGES = 100;
const MAX_BODY_CHARS = 120_000;

export function slackConfigured(): boolean {
  return Boolean(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET);
}

export class SlackNotConnectedError extends Error {
  constructor() {
    super("Slack is not connected for this session.");
    this.name = "SlackNotConnectedError";
  }
}

export function isConnected(sid: string): boolean {
  return getTokens(sid, "slack") !== null;
}

export function connectedAccount(sid: string): string | undefined {
  return getTokens(sid, "slack")?.account;
}

// ── OAuth (Slack-specific, no PKCE) ──────────────────────────────────────────

export function buildSlackAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    state: args.state,
    user_scope: SLACK_USER_SCOPES.join(","),
  });
  return `${SLACK_AUTHORIZE_URL}?${params.toString()}`;
}

interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  team?: { id?: string; name?: string };
  authed_user?: {
    id?: string;
    access_token?: string;
    token_type?: string;
    scope?: string;
    expires_in?: number;
    refresh_token?: string;
  };
}

export async function exchangeSlackCode(args: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  account: string;
}> {
  const params = new URLSearchParams({
    code: args.code,
    client_id: args.clientId,
    client_secret: args.clientSecret,
    redirect_uri: args.redirectUri,
  });
  const res = await fetch(SLACK_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params.toString(),
  });
  const data = (await res.json()) as SlackOAuthResponse;
  if (!data.ok) {
    throw new Error(`Slack token exchange failed: ${data.error ?? res.status}`);
  }
  const userToken = data.authed_user?.access_token;
  if (!userToken) {
    throw new Error(
      "Slack did not return a user token — check that user scopes are configured on the app.",
    );
  }
  return {
    accessToken: userToken,
    refreshToken: data.authed_user?.refresh_token,
    expiresIn: data.authed_user?.expires_in,
    account: data.team?.name?.trim() || "Slack workspace",
  };
}

// ── authenticated calls ──────────────────────────────────────────────────────

function ensureAccessToken(sid: string): string {
  const tokens = getTokens(sid, "slack");
  if (!tokens) throw new SlackNotConnectedError();
  // Slack user tokens don't expire unless token rotation is enabled (opt-in and
  // uncommon). If they do and we lack a refresh path, a stale token surfaces as
  // an `invalid_auth` error below and we prompt a reconnect.
  return tokens.access_token;
}

interface SlackApiResult {
  ok: boolean;
  error?: string;
  [k: string]: unknown;
}

async function slackGet(
  sid: string,
  method: string,
  params: Record<string, string>,
): Promise<SlackApiResult> {
  const token = ensureAccessToken(sid);
  const url = `${SLACK_API}/${method}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = (await res.json()) as SlackApiResult;
  if (
    data?.error === "invalid_auth" ||
    data?.error === "token_revoked" ||
    data?.error === "account_inactive" ||
    data?.error === "not_authed"
  ) {
    clearTokens(sid, "slack");
    throw new SlackNotConnectedError();
  }
  return data;
}

// ── Slack mrkdwn → readable text (minimal) ───────────────────────────────────

function cleanMrkdwn(raw: string): string {
  return raw
    // <http://url|label> → label ; <http://url> → url
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<(https?:\/\/[^>]+)>/g, "$1")
    // <@U123> / <#C123|name> → leave a readable token
    .replace(/<#[^|>]+\|([^>]+)>/g, "#$1")
    .replace(/<@([^>]+)>/g, "@$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function tsToDate(ts: string | undefined): string {
  if (!ts) return "";
  const secs = Number(ts.split(".")[0]);
  if (!Number.isFinite(secs)) return "";
  return new Date(secs * 1000).toISOString().slice(0, 10);
}

// ── search + fetch ───────────────────────────────────────────────────────────

interface SlackMatch {
  ts?: string;
  text?: string;
  username?: string;
  user?: string;
  permalink?: string;
  channel?: { id?: string; name?: string };
}

export async function searchPages(
  sid: string,
  query: string,
): Promise<ConnectorPageRef[]> {
  const q = query.trim();
  // search.messages requires a query; an empty box just shows the hint in the UI.
  if (!q) return [];

  const data = await slackGet(sid, "search.messages", {
    query: q,
    count: String(MAX_RESULTS),
    sort: "timestamp",
  });
  if (!data.ok) {
    if (data.error === "missing_scope") {
      throw new Error("Slack search needs the search:read scope — reconnect Slack.");
    }
    throw new Error(`Slack search failed: ${data.error ?? "unknown error"}`);
  }

  const matches =
    ((data.messages as { matches?: SlackMatch[] } | undefined)?.matches) ?? [];
  const refs: ConnectorPageRef[] = [];
  for (const m of matches) {
    if (!m.ts || !m.channel?.id) continue;
    const text = cleanMrkdwn(m.text ?? "");
    const channel = m.channel?.name ? `#${m.channel.name}` : "Slack message";
    const author = m.username || m.user || "";
    refs.push({
      id: `${m.channel.id}:${m.ts}`,
      title: text.split("\n")[0].slice(0, 90) || channel,
      url: m.permalink ?? "",
      last_edited: tsToDate(m.ts),
      snippet: [channel, author].filter(Boolean).join(" · "),
    });
  }
  return refs;
}

interface SlackThreadMessage {
  ts?: string;
  text?: string;
  user?: string;
  username?: string;
  bot_id?: string;
}

async function channelLabel(sid: string, channel: string): Promise<string> {
  try {
    const info = await slackGet(sid, "conversations.info", { channel });
    const c = info.ok ? (info.channel as { name?: string } | undefined) : undefined;
    return c?.name ? `#${c.name}` : "Slack conversation";
  } catch {
    return "Slack conversation";
  }
}

async function resolveUserNames(
  sid: string,
  ids: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    ids.map(async (id) => {
      try {
        const info = await slackGet(sid, "users.info", { user: id });
        if (!info.ok) return;
        const u = info.user as
          | { real_name?: string; name?: string; profile?: { display_name?: string } }
          | undefined;
        out[id] =
          u?.profile?.display_name || u?.real_name || u?.name || id;
      } catch {
        /* leave unresolved — we fall back to the raw id */
      }
    }),
  );
  return out;
}

async function permalink(
  sid: string,
  channel: string,
  ts: string,
): Promise<string> {
  try {
    const res = await slackGet(sid, "chat.getPermalink", {
      channel,
      message_ts: ts,
    });
    return res.ok ? ((res.permalink as string) ?? "") : "";
  } catch {
    return "";
  }
}

export async function fetchPageText(
  sid: string,
  id: string,
): Promise<ConnectorPageTextResponse> {
  const sep = id.indexOf(":");
  const channel = sep > 0 ? id.slice(0, sep) : "";
  const ts = sep > 0 ? id.slice(sep + 1) : "";
  if (!channel || !ts) throw new Error("Invalid Slack message reference.");

  // Prefer the whole thread for context; fall back to the single message.
  let messages: SlackThreadMessage[] = [];
  const replies = await slackGet(sid, "conversations.replies", {
    channel,
    ts,
    limit: String(MAX_THREAD_MESSAGES),
  });
  if (replies.ok && Array.isArray(replies.messages) && replies.messages.length) {
    messages = replies.messages as SlackThreadMessage[];
  } else {
    const hist = await slackGet(sid, "conversations.history", {
      channel,
      latest: ts,
      oldest: ts,
      inclusive: "true",
      limit: "1",
    });
    if (hist.ok && Array.isArray(hist.messages)) {
      messages = hist.messages as SlackThreadMessage[];
    }
  }

  if (messages.length === 0) {
    throw new Error(
      "Couldn't read that Slack message — Groundtruth may not have history access to that channel.",
    );
  }

  const label = await channelLabel(sid, channel);
  const userIds = [...new Set(messages.map((m) => m.user).filter(Boolean) as string[])];
  const names = await resolveUserNames(sid, userIds);

  const lines = messages.map((m) => {
    const who = (m.user && names[m.user]) || m.username || (m.bot_id ? "bot" : "unknown");
    return `${who}: ${cleanMrkdwn(m.text ?? "")}`;
  });

  const url = (await permalink(sid, channel, ts)) || "";
  const text = `Slack ${label}\n\n${lines.join("\n\n")}`.slice(0, MAX_BODY_CHARS);

  return {
    id,
    title: messages.length > 1 ? `${label} thread` : `${label} message`,
    url,
    text,
  };
}
