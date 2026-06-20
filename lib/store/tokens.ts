import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ConnectorId } from "@/types";

/**
 * Encrypted, session-keyed OAuth token store.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * DELIBERATE EXCEPTION TO "IN-MEMORY ONLY" (CLAUDE.md core rule 6).
 * ──────────────────────────────────────────────────────────────────────────
 * Connectors (MAJOR_CHANGES.md #C1) need OAuth tokens to survive a server
 * restart so a user doesn't re-authorize Notion on every reload. This is the
 * ONE place in the codebase that persists state to disk, and it persists ONLY
 * secrets required to talk to the connector — never audit content, never
 * conversation history, never anything the rest of the app touches. The
 * durable audit artifact remains the exported report, exactly as before.
 *
 * Hygiene:
 *   - The whole store file is encrypted at rest with AES-256-GCM. The key is
 *     derived (scrypt) from `TOKEN_ENC_KEY`.
 *   - Tokens are keyed by the opaque httpOnly session id (`lib/session.ts`),
 *     so one browser's tokens are never readable from another session.
 *   - The file lives in `.connector-data/` (gitignored).
 *
 * If `TOKEN_ENC_KEY` is unset we fall back to a fixed dev key and warn — this
 * keeps local dev frictionless but is NOT safe for a shared deployment.
 */

const STORE_DIR = process.env.CONNECTOR_STORE_DIR
  ? process.env.CONNECTOR_STORE_DIR
  : join(process.cwd(), ".connector-data");
const STORE_FILE = join(STORE_DIR, "store.json");
const SALT = "groundtruth.connector.tokens.v1";

let _warnedKey = false;
function encryptionKey(): Buffer {
  let secret = process.env.TOKEN_ENC_KEY;
  if (!secret) {
    if (!_warnedKey) {
      console.warn(
        "[connector-store] TOKEN_ENC_KEY is not set — using an insecure dev " +
          "fallback key. Set TOKEN_ENC_KEY before any real deployment.",
      );
      _warnedKey = true;
    }
    secret = "dev-insecure-token-encryption-key";
  }
  return scryptSync(secret, SALT, 32);
}

// ── on-disk shapes ──────────────────────────────────────────────────────────

/** Dynamic-client-registration credentials (RFC 7591). Reusable per server. */
export interface OAuthClientCreds {
  client_id: string;
  client_secret?: string;
}

/** A pending authorization (between /authorize redirect and /callback). */
export interface PendingAuth {
  state: string;
  code_verifier: string;
  redirect_uri: string;
  created_at: number;
}

/** Live tokens for a connected account. */
export interface ConnectorTokens {
  access_token: string;
  refresh_token?: string;
  /** Epoch ms when the access token expires (best-effort). */
  expires_at?: number;
  /** Human label for the connected workspace/account, when discoverable. */
  account?: string;
}

interface ConnectorRecord {
  pending?: PendingAuth;
  tokens?: ConnectorTokens;
}

/**
 * A persisted connector watch (C — automation). Metadata ONLY: which page, its
 * content hash for change detection, last-run timestamp, and verdict COUNTS.
 * Never claim text or audit content — the durable audit artifact is the
 * exported/Notion report, exactly as the token-store exception intends.
 */
export interface WatchRecord {
  id: string;
  connector: ConnectorId;
  page_id: string;
  title: string;
  url: string;
  writeback: boolean;
  /** sha256 of the last-audited page text — used to skip unchanged pages. */
  last_hash?: string;
  last_run_at?: number;
  last_summary?: { total: number; flagged: number };
  last_report_url?: string;
  created_at: number;
}

interface StoreShape {
  /** Dynamic client registrations, keyed by MCP server URL. */
  clients: Record<string, OAuthClientCreds>;
  /** Per-session connector records. */
  sessions: Record<string, Partial<Record<ConnectorId, ConnectorRecord>>>;
  /** Per-session connector watches (C — automation). Metadata only. */
  watches?: Record<string, WatchRecord[]>;
}

// ── encrypted load/save (whole-file; the store is small) ─────────────────────

let _cache: StoreShape | null = null;

function emptyStore(): StoreShape {
  return { clients: {}, sessions: {}, watches: {} };
}

function load(): StoreShape {
  if (_cache) return _cache;
  if (!existsSync(STORE_FILE)) {
    _cache = emptyStore();
    return _cache;
  }
  try {
    const raw = readFileSync(STORE_FILE, "utf8");
    const wrapper = JSON.parse(raw) as { v: number; blob: string };
    const buf = Buffer.from(wrapper.blob, "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    _cache = JSON.parse(plaintext) as StoreShape;
  } catch (err) {
    // Corrupt or key-mismatched store — start fresh rather than crash the app.
    console.error(
      "[connector-store] could not read store (starting empty):",
      err instanceof Error ? err.message : err,
    );
    _cache = emptyStore();
  }
  return _cache;
}

function persist(): void {
  if (!_cache) return;
  try {
    mkdirSync(dirname(STORE_FILE), { recursive: true });
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(_cache), "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    const blob = Buffer.concat([iv, tag, ciphertext]).toString("base64");
    writeFileSync(STORE_FILE, JSON.stringify({ v: 1, blob }), "utf8");
  } catch (err) {
    console.error(
      "[connector-store] could not write store:",
      err instanceof Error ? err.message : err,
    );
  }
}

function sessionRecord(
  store: StoreShape,
  sid: string,
  connector: ConnectorId,
): ConnectorRecord {
  const s = (store.sessions[sid] ??= {});
  return (s[connector] ??= {});
}

// ── public API ───────────────────────────────────────────────────────────────

export function getClientCreds(serverUrl: string): OAuthClientCreds | null {
  return load().clients[serverUrl] ?? null;
}

export function setClientCreds(
  serverUrl: string,
  creds: OAuthClientCreds,
): void {
  const store = load();
  store.clients[serverUrl] = creds;
  persist();
}

export function getPending(
  sid: string,
  connector: ConnectorId,
): PendingAuth | null {
  return load().sessions[sid]?.[connector]?.pending ?? null;
}

export function setPending(
  sid: string,
  connector: ConnectorId,
  pending: PendingAuth,
): void {
  const store = load();
  sessionRecord(store, sid, connector).pending = pending;
  persist();
}

export function clearPending(sid: string, connector: ConnectorId): void {
  const rec = load().sessions[sid]?.[connector];
  if (rec) {
    delete rec.pending;
    persist();
  }
}

export function getTokens(
  sid: string,
  connector: ConnectorId,
): ConnectorTokens | null {
  return load().sessions[sid]?.[connector]?.tokens ?? null;
}

export function setTokens(
  sid: string,
  connector: ConnectorId,
  tokens: ConnectorTokens,
): void {
  const store = load();
  sessionRecord(store, sid, connector).tokens = tokens;
  persist();
}

export function clearTokens(sid: string, connector: ConnectorId): void {
  const rec = load().sessions[sid]?.[connector];
  if (rec) {
    delete rec.tokens;
    persist();
  }
}

// ── watches (C — automation; metadata only) ──────────────────────────────────

export function listWatchRecords(sid: string): WatchRecord[] {
  return load().watches?.[sid] ?? [];
}

export function getWatchRecord(sid: string, id: string): WatchRecord | null {
  return listWatchRecords(sid).find((w) => w.id === id) ?? null;
}

export function addWatchRecord(sid: string, rec: WatchRecord): void {
  const store = load();
  const all = (store.watches ??= {});
  (all[sid] ??= []).push(rec);
  persist();
}

export function updateWatchRecord(
  sid: string,
  id: string,
  patch: Partial<Omit<WatchRecord, "id">>,
): WatchRecord | null {
  const store = load();
  const list = store.watches?.[sid];
  if (!list) return null;
  const rec = list.find((w) => w.id === id);
  if (!rec) return null;
  Object.assign(rec, patch);
  persist();
  return rec;
}

export function removeWatchRecord(sid: string, id: string): void {
  const store = load();
  const list = store.watches?.[sid];
  if (!list) return;
  const next = list.filter((w) => w.id !== id);
  if (next.length !== list.length) {
    store.watches![sid] = next;
    persist();
  }
}
