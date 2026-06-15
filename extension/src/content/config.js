/*
 * Groundtruth content-script namespace + shared config.
 *
 * Content scripts for an extension all run in the SAME isolated world per
 * frame and share one global object. We hang everything off a single
 * `window.__GROUNDTRUTH` namespace (instead of leaking many globals) and rely
 * on the file order declared in manifest.json `content_scripts.js` so that
 * each file can assume the ones above it have already populated the namespace.
 *
 * This file MUST be listed first.
 */
(() => {
  const NS = (window.__GROUNDTRUTH = window.__GROUNDTRUTH || {});

  NS.config = {
    // How long an assistant message's text must stay unchanged before we treat
    // streaming as finished and audit it. Tuned to feel responsive without
    // firing mid-stream.
    STABILITY_MS: 1500,
    // Minimum characters before a message is worth auditing (skips "Sure!" etc).
    MIN_TEXT_LEN: 60,
    // Polling cadence for the scan/complete loop.
    TICK_MS: 600,
    // Storage keys.
    KEY_STARTED: "started",
  };

  // Monotonic id source for message records (used as the audit `message_id`).
  let counter = 0;
  NS.nextId = () => `gt-msg-${Date.now().toString(36)}-${++counter}`;

  // Normalise an element's rendered text into the form the extractor expects:
  // visible text, collapsed whitespace, no UI chrome.
  NS.cleanText = (el) => {
    if (!el) return "";
    // innerText respects CSS visibility/line-breaks and skips hidden chrome,
    // which is what we want over textContent.
    const raw = el.innerText || "";
    return raw.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").trim();
  };

  // Verdict → presentation tokens. Mirrors components/audit/verdict.ts so the
  // extension renders the same labels/colors as the web app. `color` is the
  // solid accent used for badges/pills; `code` keys the ::highlight() pseudos.
  NS.VERDICTS = {
    verified:             { label: "Verified",             code: "ok",     color: "#34c77b" },
    unverified_plausible: { label: "Unverified, plausible", code: "warn",   color: "#f3c14a" },
    contradicted:         { label: "Contradicted",          code: "bad",    color: "#f8843a" },
    likely_hallucination: { label: "Likely hallucination",  code: "halluc", color: "#fb5070" },
  };

  // App palette — Iris dark theme, matching the web app's design system.
  NS.THEME = {
    bg: "#0e0f13",
    surface: "#1b1d25",
    surfaceMuted: "#16181f",
    fg: "#edeef3",
    fgMuted: "#a4a7b6",
    border: "rgba(255,255,255,0.085)",
    accent: "#7c5cff",
    accentHover: "#6a4be0",
    accentFg: "#ffffff",
  };

  NS.escapeHtml = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
})();
