/*
 * Options page logic: persist the API base URL and, for non-localhost hosts,
 * request the optional host permission the background worker needs to call it.
 */

const DEFAULT_API_BASE = "http://localhost:3000";

const $base = document.getElementById("apiBase");
const $save = document.getElementById("save");
const $test = document.getElementById("test");
const $status = document.getElementById("status");

function setStatus(msg, kind) {
  $status.textContent = msg;
  $status.className = "status" + (kind ? " " + kind : "");
}

function normalize(url) {
  return (url || "").trim().replace(/\/+$/, "");
}

function isLocalhost(url) {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  } catch {
    return false;
  }
}

// Build a host-permission match pattern (origin + /*) from a base URL.
function originPattern(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.host}/*`;
}

async function load() {
  const { apiBase } = await chrome.storage.sync.get("apiBase");
  $base.value = apiBase || DEFAULT_API_BASE;
}

async function ensurePermission(url) {
  if (isLocalhost(url)) return true; // covered by manifest host_permissions
  const pattern = originPattern(url);
  const has = await chrome.permissions.contains({ origins: [pattern] });
  if (has) return true;
  return chrome.permissions.request({ origins: [pattern] });
}

$save.addEventListener("click", async () => {
  const base = normalize($base.value);
  if (!base) {
    setStatus("Enter a URL first.", "err");
    return;
  }
  let parsed;
  try {
    parsed = new URL(base);
  } catch {
    setStatus("That doesn't look like a valid URL.", "err");
    return;
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    setStatus("URL must start with http:// or https://", "err");
    return;
  }

  try {
    const granted = await ensurePermission(base);
    if (!granted) {
      setStatus("Host permission was denied — the extension can't reach that URL.", "err");
      return;
    }
  } catch (e) {
    setStatus("Permission request failed: " + e.message, "err");
    return;
  }

  await chrome.storage.sync.set({ apiBase: base });
  $base.value = base;
  setStatus("Saved.", "ok");
});

$test.addEventListener("click", async () => {
  const base = normalize($base.value);
  setStatus("Testing…");
  try {
    await ensurePermission(base);
    // A trivially-invalid audit body — we only care that the server responds
    // (a 400 with an `error` field proves the API is reachable and is ours).
    const res = await fetch(base + "/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message_id: "test", content: "" }),
    });
    if (res.status === 400 || res.ok) {
      setStatus(`Connected — server responded (HTTP ${res.status}).`, "ok");
    } else {
      setStatus(`Reached server but got HTTP ${res.status}.`, "err");
    }
  } catch (e) {
    setStatus("Could not reach the API: " + e.message, "err");
  }
});

load();
