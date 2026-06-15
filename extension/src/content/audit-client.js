/*
 * Thin bridge from the content script to the background service worker.
 *
 * The actual network calls live in the background worker (src/background.js)
 * so they run with the extension's host permissions and bypass page CORS. The
 * content script never fetches the API directly.
 *
 * Each call resolves to the parsed API payload, or rejects with an Error whose
 * message is the API's `error` field (or a transport error).
 */
(() => {
  const NS = window.__GROUNDTRUTH;

  function send(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (resp) => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr) {
          reject(new Error(lastErr.message));
          return;
        }
        if (!resp) {
          reject(new Error("No response from background worker."));
          return;
        }
        if (resp.ok) resolve(resp.data);
        else reject(new Error(resp.error || "Unknown background error."));
      });
    });
  }

  NS.auditClient = {
    /** POST /api/audit → MessageAudit */
    audit(messageId, content) {
      return send({ type: "AUDIT", messageId, content });
    },
    /** POST /api/dehallucinate → { suggested_prompt } */
    dehallucinate(payload) {
      return send({ type: "DEHALLUCINATE", payload });
    },
    /** Resolved API base + settings from background. */
    getConfig() {
      return send({ type: "GET_CONFIG" });
    },
  };
})();
