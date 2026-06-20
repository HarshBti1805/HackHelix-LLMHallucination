import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  discoverOAuthMetadata,
  refreshAccessToken,
} from "@/lib/connectors/oauth";
import {
  getClientCreds,
  getTokens,
  setTokens,
  clearTokens,
  type ConnectorTokens,
} from "@/lib/store/tokens";
import type { ConnectorPageRef, ConnectorPageTextResponse } from "@/types";

/**
 * Notion connector — Groundtruth as an MCP *client* of Notion's hosted MCP
 * server (MAJOR_CHANGES.md #C1).
 *
 * Responsibilities: given a session's stored OAuth token, open an MCP
 * connection to `mcp.notion.com` and expose exactly the two read operations the
 * workspace needs — `searchPages` (pick a source doc) and `fetchPageText` (pull
 * its text to use as trusted context for the groundedness check).
 *
 * It does NOT audit, does NOT run the OAuth dance (that's the routes +
 * `oauth.ts`), and does NOT persist beyond refreshing an expired token. The
 * auditing engine (`lib/groundedness.ts`) is reused unchanged — this module
 * only changes where the *context* comes from.
 *
 * Notion's MCP `search`/`fetch` tools follow the OpenAI deep-research tool
 * convention, so results arrive as `{ results: [...] }` / `{ id,title,text,url }`
 * either in `structuredContent` or as JSON text. We read both defensively.
 */

const MCP_BASE = (process.env.NOTION_MCP_URL || "https://mcp.notion.com").replace(
  /\/+$/,
  "",
);
const MCP_ENDPOINT = `${MCP_BASE}/mcp`;
/** Exported so the OAuth routes key client registration off the same URL. */
export const NOTION_MCP_ENDPOINT = MCP_ENDPOINT;
export const NOTION_SCOPES: string[] = [];
// Cap pulled context so it stays under the guardrail's 200k input ceiling.
const MAX_PAGE_CHARS = 180_000;

export class NotionNotConnectedError extends Error {
  constructor() {
    super("Notion is not connected for this session.");
    this.name = "NotionNotConnectedError";
  }
}

/** Returned by `fetch`/`search` tools; only the fields we use are typed. */
interface ToolResultLike {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

function collectText(result: ToolResultLike): string {
  if (!Array.isArray(result.content)) return "";
  return result.content
    .filter((c) => c && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n")
    .trim();
}

/** Prefer `structuredContent`; fall back to JSON-parsing the text content. */
function parseToolJson(result: ToolResultLike): unknown {
  if (result.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }
  const text = collectText(result);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

/**
 * Turn Notion's `notion-fetch` "view" payload into clean, auditable prose.
 *
 * `notion-fetch` returns Notion-flavored markdown that wraps the real body in a
 * lot of navigation/metadata we must NOT feed to the claim extractor, or it
 * "fact-checks" the page tree instead of the content. A typical payload:
 *
 *   Here is the result of "view" for the Page ... as of <timestamp>:
 *   <page url="…">
 *     <ancestor-path><parent-page title="…"/>…</ancestor-path>
 *     <properties>{"title":"…"}</properties>
 *     <content>
 *       <page url="…">Child Page Title</page>   ← sub-page links (navigation)
 *       …the actual prose we want…
 *       <empty-block/>
 *     </content>
 *   </page>
 *
 * We keep ONLY the inner <content>, drop the child-`<page>` link tags and any
 * other XML-ish tags, and strip the preamble. The result is the page's real
 * text (an index page with no prose correctly yields almost nothing).
 */
export function cleanNotionContent(raw: string): string {
  if (!raw) return "";
  let s = raw;

  const contentMatch = s.match(/<content>([\s\S]*?)<\/content>/i);
  if (contentMatch) {
    s = contentMatch[1];
  } else {
    s = s
      .replace(/^Here is the result[\s\S]*?:\s*/i, "")
      .replace(/<ancestor-path>[\s\S]*?<\/ancestor-path>/gi, "")
      .replace(/<properties>[\s\S]*?<\/properties>/gi, "");
  }

  // Child-page reference tags are navigation, not auditable prose — drop them.
  s = s.replace(/<page\b[^>]*>[\s\S]*?<\/page>/gi, " ");
  // Drop any remaining XML-ish / self-closing tags (<empty-block/>, etc.).
  s = s.replace(/<[^>]+\/?>/g, " ");
  // Tidy whitespace.
  return s
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── token lifecycle ──────────────────────────────────────────────────────────

/**
 * Return a valid access token for the session, refreshing if it has (nearly)
 * expired. Throws `NotionNotConnectedError` when there is nothing stored, and
 * clears tokens + signals re-auth when the refresh token is dead.
 */
async function ensureAccessToken(sid: string): Promise<string> {
  const tokens = getTokens(sid, "notion");
  if (!tokens) throw new NotionNotConnectedError();

  const skewMs = 60_000;
  const stillValid =
    typeof tokens.expires_at === "number"
      ? Date.now() < tokens.expires_at - skewMs
      : true;
  if (stillValid) return tokens.access_token;

  if (!tokens.refresh_token) return tokens.access_token; // best effort
  const creds = getClientCreds(MCP_ENDPOINT);
  if (!creds) return tokens.access_token;

  try {
    const metadata = await discoverOAuthMetadata(MCP_ENDPOINT);
    const refreshed = await refreshAccessToken({
      refreshToken: tokens.refresh_token,
      metadata,
      clientId: creds.client_id,
      clientSecret: creds.client_secret,
    });
    const next: ConnectorTokens = {
      access_token: refreshed.access_token,
      // Notion rotates refresh tokens — always keep the newest one.
      refresh_token: refreshed.refresh_token ?? tokens.refresh_token,
      expires_at: refreshed.expires_in
        ? Date.now() + refreshed.expires_in * 1000
        : undefined,
      account: tokens.account,
    };
    setTokens(sid, "notion", next);
    return next.access_token;
  } catch (err) {
    if (err instanceof Error && err.message === "REAUTH_REQUIRED") {
      clearTokens(sid, "notion");
      throw new NotionNotConnectedError();
    }
    throw err;
  }
}

// ── MCP connection ────────────────────────────────────────────────────────────

async function connect(accessToken: string): Promise<Client> {
  const client = new Client(
    { name: "groundtruth", version: "0.1.0" },
    { capabilities: {} },
  );
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": "Groundtruth-MCP-Client/0.1",
  };
  try {
    const transport = new StreamableHTTPClientTransport(new URL(MCP_ENDPOINT), {
      requestInit: { headers },
    });
    await client.connect(transport);
    return client;
  } catch {
    // Fall back to the legacy SSE transport for older/edge deployments.
    const sse = new SSEClientTransport(new URL(`${MCP_BASE}/sse`), {
      requestInit: { headers },
    });
    await client.connect(sse);
    return client;
  }
}

async function withClient<T>(
  sid: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const token = await ensureAccessToken(sid);
  const client = await connect(token);
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

/** Find a tool by exact name, else by substring (Notion has renamed tools). */
async function resolveToolName(
  client: Client,
  candidates: string[],
): Promise<string | null> {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const c of candidates) {
    const exact = names.find((n) => n === c);
    if (exact) return exact;
  }
  for (const c of candidates) {
    const partial = names.find((n) => n.toLowerCase().includes(c));
    if (partial) return partial;
  }
  return null;
}

// ── public operations ─────────────────────────────────────────────────────────

/** Whether the session has a stored Notion token (no network call). */
export function isConnected(sid: string): boolean {
  return getTokens(sid, "notion") !== null;
}

export function connectedAccount(sid: string): string | undefined {
  return getTokens(sid, "notion")?.account;
}

/** Search the connected workspace for pages/docs to use as a source. */
export async function searchPages(
  sid: string,
  query: string,
): Promise<ConnectorPageRef[]> {
  // Notion's search tool requires a non-empty query (minLength 1). Skip the
  // round-trip for an empty box rather than surfacing a 502.
  if (!query.trim()) return [];

  return withClient(sid, async (client) => {
    const tool = await resolveToolName(client, ["search"]);
    if (!tool) return [];
    const result = (await client.callTool({
      name: tool,
      arguments: { query, page_size: 25 },
    })) as ToolResultLike;

    const parsed = parseToolJson(result) as
      | { results?: unknown[] }
      | unknown[]
      | null;
    const rows: unknown[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { results?: unknown[] })?.results)
        ? (parsed as { results: unknown[] }).results
        : [];

    const refs: ConnectorPageRef[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const id = String(r.id ?? r.url ?? "").trim();
      if (!id) continue;
      const snippet = String(r.highlight ?? r.snippet ?? "").trim();
      refs.push({
        id,
        title: String(r.title ?? r.name ?? "Untitled").trim() || "Untitled",
        url: String(r.url ?? "").trim(),
        last_edited: String(
          r.last_edited_time ?? r.timestamp ?? r.last_edited ?? "",
        ).trim(),
        snippet: snippet.slice(0, 200),
      });
    }
    return refs;
  });
}

/**
 * Pull a created page's id + URL out of a create-pages tool result. Notion's
 * MCP tools vary in exactly where they put this (structuredContent vs JSON
 * text vs nested under `pages`/`results`), so we read defensively: stringify
 * the whole payload and regex out the first Notion URL and id we see.
 */
function extractCreatedRef(result: ToolResultLike): { id: string; url: string } {
  const parsed = parseToolJson(result);
  const blob = `${JSON.stringify(parsed ?? "")}\n${collectText(result)}`;
  const url =
    blob.match(/https?:\/\/(?:www\.)?notion\.so\/[^\s"')\]]+/i)?.[0] ?? "";
  const id =
    blob.match(/"(?:id|page_id)"\s*:\s*"([0-9a-fA-F-]{16,})"/)?.[1] ??
    url.match(/([0-9a-f]{32})(?:\?|$)/i)?.[1] ??
    "";
  return { id, url };
}

// Notion's create-pages tool accepts markdown content; cap it so we never send a
// pathological payload (Notion also enforces its own block limits).
const MAX_REPORT_CHARS = 100_000;

/**
 * C — close the loop: create a new Notion page holding an audit report.
 *
 * This is the ONE connector WRITE operation (everything else is read-only). It
 * discovers Notion's create-pages MCP tool and files a markdown report, either
 * under `parentId` (the audited page, so the report lands beside its source) or
 * at the workspace root when no parent is given.
 *
 * Requires that the connected Notion authorization grants edit access. If the
 * server exposes no create tool (read-only grant) we throw a clear, actionable
 * error rather than failing silently.
 */
export async function createReportPage(
  sid: string,
  opts: { title: string; markdown: string; parentId?: string },
): Promise<{ id: string; url: string }> {
  return withClient(sid, async (client) => {
    const tool = await resolveToolName(client, [
      "create-pages",
      "create_pages",
      "create-page",
      "create",
    ]);
    if (!tool) {
      throw new Error(
        "Notion MCP server exposes no create-pages tool. Reconnect Notion and " +
          "grant edit access to enable writing reports back.",
      );
    }

    const content = opts.markdown.slice(0, MAX_REPORT_CHARS);
    const result = (await client.callTool({
      name: tool,
      arguments: {
        pages: [{ properties: { title: opts.title }, content }],
        ...(opts.parentId ? { parent: { page_id: opts.parentId } } : {}),
      },
    })) as ToolResultLike;

    if (result.isError) {
      throw new Error(
        collectText(result) || "Notion create-pages returned an error.",
      );
    }
    return extractCreatedRef(result);
  });
}

/** Fetch a single page's text to use as trusted context. */
export async function fetchPageText(
  sid: string,
  id: string,
): Promise<ConnectorPageTextResponse> {
  return withClient(sid, async (client) => {
    const tool = await resolveToolName(client, ["fetch", "view", "retrieve"]);
    if (!tool) {
      throw new Error("Notion MCP server exposes no fetch/view tool.");
    }
    const result = (await client.callTool({
      name: tool,
      // include_transcript pulls meeting-note transcripts when present — the
      // ideal trusted context for the "summary vs transcript" use case.
      arguments: { id, include_transcript: true },
    })) as ToolResultLike;

    if (result.isError) {
      throw new Error(collectText(result) || "Notion fetch returned an error.");
    }

    const parsed = parseToolJson(result) as Record<string, unknown> | null;
    const rawText =
      (parsed && typeof parsed.text === "string" && parsed.text) ||
      collectText(result) ||
      "";
    const text = cleanNotionContent(rawText);
    const title =
      (parsed && typeof parsed.title === "string" && parsed.title.trim()) ||
      "Notion page";
    const url =
      (parsed && typeof parsed.url === "string" && parsed.url.trim()) || "";

    return {
      id,
      title,
      url,
      text: text.slice(0, MAX_PAGE_CHARS),
    };
  });
}
