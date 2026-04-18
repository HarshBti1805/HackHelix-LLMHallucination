import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * File-based cache keyed by SHA-256 of the call arguments. Dev-only — no-op
 * in production so fact-checks always see fresh search results.
 *
 * Layout (per ARCHITECTURE.md §5.8):
 *   <tmpdir>/halluc-cache/<namespace>/<sha256-of-args>.json
 *
 * The cached value is JSON-serialised; pass JSON-safe arguments and return
 * JSON-safe values. Errors from the wrapped function are NEVER cached — only
 * successful results are persisted.
 */

const CACHE_ROOT = join(tmpdir(), "halluc-cache");
const ENABLED = process.env.NODE_ENV !== "production";

function hashArgs(args: unknown[]): string {
  const stable = JSON.stringify(args, (_k, v) =>
    typeof v === "function" ? "[fn]" : v,
  );
  return createHash("sha256").update(stable).digest("hex");
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

interface CachedEnvelope<R> {
  cached_at: string;
  value: R;
}

/**
 * Wrap an async function so identical inputs return the cached output.
 *
 * Example:
 *   const cachedFoo = withCache("foo", foo);
 *   await cachedFoo("hello"); // miss → calls foo, writes file
 *   await cachedFoo("hello"); // hit  → reads file, never calls foo
 */
export function withCache<Args extends unknown[], R>(
  namespace: string,
  fn: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
  if (!ENABLED) return fn;

  const dir = join(CACHE_ROOT, namespace);

  return async (...args: Args): Promise<R> => {
    const key = hashArgs(args);
    const file = join(dir, `${key}.json`);

    if (existsSync(file)) {
      try {
        const raw = await readFile(file, "utf8");
        const env = JSON.parse(raw) as CachedEnvelope<R>;
        return env.value;
      } catch {
        // corrupt cache entry — fall through and refresh
      }
    }

    const value = await fn(...args);
    try {
      await ensureDir(dir);
      const env: CachedEnvelope<R> = {
        cached_at: new Date().toISOString(),
        value,
      };
      await writeFile(file, JSON.stringify(env), "utf8");
    } catch {
      // cache write failure is non-fatal — do not crash the request path
    }
    return value;
  };
}

export const __cacheRoot = CACHE_ROOT;
export const __cacheEnabled = ENABLED;
