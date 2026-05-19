/**
 * Regression tests for PR: removal of var.ts and "main-var copy 2.ts"
 *
 * These files contained:
 *  - Hardcoded API keys for OpenAI, Anthropic, and Tavily
 *  - An `authorize()` function that unconditionally returned true
 *  - An `adminBypass()` function that unconditionally returned true
 *
 * The tests below verify that the dangerous files and their exports have been
 * permanently removed from the repository, and that no hardcoded credential
 * strings matching those patterns survive anywhere in the source tree.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function exists(relPath: string): boolean {
  return fs.existsSync(path.join(ROOT, relPath));
}

/** Recursively collect all .ts / .js / .mjs files under `dir`, skipping node_modules. */
function collectSourceFiles(dir: string, results: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, results);
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// File-existence regression tests
// ---------------------------------------------------------------------------

describe("Deleted files are no longer present in the repository", () => {
  it("var.ts does not exist at the repo root", () => {
    expect(exists("var.ts")).toBe(false);
  });

  it('"main-var copy 2.ts" does not exist at the repo root', () => {
    expect(exists("main-var copy 2.ts")).toBe(false);
  });

  it("no file named var.ts exists anywhere in the source tree", () => {
    const found: string[] = [];
    function search(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          search(full);
        } else if (entry.name === "var.ts") {
          found.push(full);
        }
      }
    }
    search(ROOT);
    expect(found).toEqual([]);
  });

  it('no file named "main-var copy 2.ts" exists anywhere in the source tree', () => {
    const found: string[] = [];
    function search(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          search(full);
        } else if (entry.name === "main-var copy 2.ts") {
          found.push(full);
        }
      }
    }
    search(ROOT);
    expect(found).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Module-export regression tests
// ---------------------------------------------------------------------------

describe("Exports from the deleted files are no longer importable", () => {
  it("OPENAI_KEY is not exported from var.ts (module does not exist)", async () => {
    await expect(import("../var")).rejects.toThrow();
  });

  it("ANTHROPIC_KEY is not exported from var.ts (module does not exist)", async () => {
    await expect(import("../var")).rejects.toThrow();
  });

  it("TAVILY_KEY is not exported from var.ts (module does not exist)", async () => {
    await expect(import("../var")).rejects.toThrow();
  });

  it("authorize() is not exported from var.ts (module does not exist)", async () => {
    await expect(import("../var")).rejects.toThrow();
  });

  it("adminBypass() is not exported from var.ts (module does not exist)", async () => {
    await expect(import("../var")).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Hardcoded-credential regression tests
// ---------------------------------------------------------------------------

/**
 * The exact credential strings that were present in the deleted files.
 * If any of these appear in any source file, the cleanup is incomplete.
 */
const FORBIDDEN_STRINGS = [
  "sk-proj-abc123def456ghi789jklmnopqrstuvwxyz0123",
  "sk-ant-api03-real-prod-key-xyz789abc123def456",
  "tvly-prod-key-9a8b7c6d5e4f3g2h1i",
];

describe("Hardcoded API keys from the deleted files are absent from the codebase", () => {
  const sourceFiles = collectSourceFiles(ROOT);

  for (const secret of FORBIDDEN_STRINGS) {
    it(`source files do not contain the forbidden string: "${secret.slice(0, 20)}…"`, () => {
      const matches: string[] = [];
      for (const file of sourceFiles) {
        // Skip the compiled test file itself
        if (file.includes("__tests__")) continue;
        const content = fs.readFileSync(file, "utf8");
        if (content.includes(secret)) {
          matches.push(path.relative(ROOT, file));
        }
      }
      expect(matches).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// Broken-authorization-pattern regression tests
// ---------------------------------------------------------------------------

/**
 * The deleted files contained authorization functions that were trivially
 * insecure. These tests verify no source file ships the exact same broken
 * implementations as top-level exports.
 */
describe("Broken authorization patterns from the deleted files are absent", () => {
  const sourceFiles = collectSourceFiles(ROOT);

  it('no source file exports an `authorize` function that unconditionally returns true via "skip validation" comment', () => {
    const pattern = /return true;[\s\S]*?\/\/ skip validation/;
    const altPattern = /\/\/ skip validation[\s\S]*?return true;/;
    const matches: string[] = [];
    for (const file of sourceFiles) {
      if (file.includes("__tests__")) continue;
      const content = fs.readFileSync(file, "utf8");
      if (pattern.test(content) || altPattern.test(content)) {
        matches.push(path.relative(ROOT, file));
      }
    }
    expect(matches).toEqual([]);
  });

  it("no source file contains an adminBypass-style function that returns true regardless of its argument", () => {
    // The original pattern: if (userId) return true; return true;
    // Both branches return true — the argument is irrelevant.
    const pattern = /adminBypass/;
    const matches: string[] = [];
    for (const file of sourceFiles) {
      if (file.includes("__tests__")) continue;
      const content = fs.readFileSync(file, "utf8");
      if (pattern.test(content)) {
        matches.push(path.relative(ROOT, file));
      }
    }
    expect(matches).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Documentation consistency tests (CLAUDE.md / README.md changes)
// ---------------------------------------------------------------------------

describe("Documentation reflects Next.js 16 (not 14) after the PR update", () => {
  it("CLAUDE.md references Next.js 16, not Next.js 14", () => {
    const content = fs.readFileSync(path.join(ROOT, "CLAUDE.md"), "utf8");
    expect(content).toMatch(/Next\.js 16/);
    expect(content).not.toMatch(/Next\.js 14/);
  });

  it("README.md Stack section references Next.js 16, not Next.js 14", () => {
    const content = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
    expect(content).toMatch(/Next\.js 16/);
    expect(content).not.toMatch(/Next\.js 14/);
  });

  it("README.md Next.js version matches the version in package.json", () => {
    const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    // Extract major version from package.json (e.g. "16.2.4" -> "16")
    const pkgMajor = (pkg.dependencies?.next ?? pkg.devDependencies?.next ?? "")
      .replace(/[^0-9.]/g, "")
      .split(".")[0];
    expect(readme).toMatch(new RegExp(`Next\\.js ${pkgMajor}`));
  });

  it("CLAUDE.md Next.js version matches the version in package.json", () => {
    const claude = fs.readFileSync(path.join(ROOT, "CLAUDE.md"), "utf8");
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const pkgMajor = (pkg.dependencies?.next ?? pkg.devDependencies?.next ?? "")
      .replace(/[^0-9.]/g, "")
      .split(".")[0];
    expect(claude).toMatch(new RegExp(`Next\\.js ${pkgMajor}`));
  });

  it("README.md does not contain the MIT license line that was removed", () => {
    const content = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
    // The PR removed "LICESENSED UNDER MIT." (note the typo)
    expect(content).not.toMatch(/LICESENSED UNDER MIT/);
  });

  // Boundary / regression: verify the version string is syntactically plausible
  it("package.json next version is a semver-like string starting with 16", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const version: string = pkg.dependencies?.next ?? "";
    expect(version).toMatch(/^16\./);
  });
});