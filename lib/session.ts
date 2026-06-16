import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Minimal browser-session identity for the connector subsystem.
 *
 * Connectors need a stable per-browser key to hang OAuth tokens off of (see
 * `lib/store/tokens.ts`). We deliberately do NOT build user accounts — there is
 * no login, no password, no profile. A single opaque random id in an httpOnly
 * cookie is enough to say "this browser previously authorized Notion", which is
 * all the workspace feature needs.
 *
 * SameSite=Lax is required (not Strict): the OAuth callback is a top-level GET
 * navigation initiated from notion.com, and Lax is exactly the mode that still
 * sends the cookie on top-level cross-site GETs so we can match the pending
 * auth state back to the session that started it.
 */

const COOKIE = "gt_sid";
const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Read the existing session id, or mint + set a new one. Must be called from a
 * Server Component / Route Handler context (it touches the cookie store).
 */
export async function getOrCreateSessionId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(COOKIE)?.value;
  if (existing) return existing;

  const sid = randomBytes(24).toString("hex");
  jar.set(COOKIE, sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR,
  });
  return sid;
}

/** Read the session id without creating one. Returns null when absent. */
export async function getSessionId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(COOKIE)?.value ?? null;
}
