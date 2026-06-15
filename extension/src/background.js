/*
 * Groundtruth background service worker (MV3).
 *
 * Single responsibility: proxy the content scripts' audit / dehallucinate
 * requests to the hosted Groundtruth API. Running the fetch here (rather than
 * in the content script) means it executes with the extension's host
 * permissions and is NOT subject to the chat site's page CORS policy.
 *
 * The API base URL is user-configurable (options page); it defaults to the
 * local dev server so the extension works out of the box during development.
 */

const DEFAULT_API_BASE = "http://localhost:3000";

async function getApiBase() {
  const { apiBase } = await chrome.storage.sync.get("apiBase");
  return (apiBase || DEFAULT_API_BASE).replace(/\/+$/, "");
}

async function postJson(path, body) {
  const base = await getApiBase();
  let res;
  try {
    res = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(
      `Could not reach Groundtruth API at ${base}. Is it running, and have you granted host access in the options page? (${e.message})`,
    );
  }

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || `HTTP ${res.status}` };
  }
  if (!res.ok) {
    throw new Error(data.error || `Request failed: HTTP ${res.status}`);
  }
  return data;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case "AUDIT": {
          const data = await postJson("/api/audit", {
            message_id: msg.messageId,
            content: msg.content,
          });
          sendResponse({ ok: true, data });
          break;
        }
        case "DEHALLUCINATE": {
          const data = await postJson("/api/dehallucinate", msg.payload);
          sendResponse({ ok: true, data });
          break;
        }
        case "GET_CONFIG": {
          sendResponse({ ok: true, data: { apiBase: await getApiBase() } });
          break;
        }
        case "OPEN_OPTIONS": {
          chrome.runtime.openOptionsPage();
          sendResponse({ ok: true, data: {} });
          break;
        }
        default:
          sendResponse({ ok: false, error: `Unknown message type: ${msg && msg.type}` });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  })();
  // Keep the message channel open for the async response.
  return true;
});

// Clicking the toolbar icon toggles the in-page panel on the active tab.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_PANEL" });
  } catch {
    // No content script on this tab (not a supported site) — ignore.
  }
});
