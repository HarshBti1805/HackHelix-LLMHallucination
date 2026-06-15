/*
 * Groundtruth content-script orchestrator.
 *
 * Wires the active site adapter, completion detection, the audit client, the
 * highlight engine, and the overlay (launcher + per-response badges + popover)
 * together. The auditor is provider-agnostic and text-only, so this is the only
 * site-independent "brain"; adapters supply DOM access.
 *
 * Flow:
 *   - Idle until the user opens the launcher (toolbar icon) and clicks Start.
 *   - Once started, each NEW completed assistant response gets a small badge.
 *   - Hovering a badge opens a popover (claims + verdicts + agent breakdowns +
 *     "copy grounded re-prompt") AND highlights the flagged sentences inline.
 *
 * Completion detection is adapter-light: a message is "done" once its text has
 * been stable for STABILITY_MS and the adapter reports no active streaming.
 */
(() => {
  const NS = window.__GROUNDTRUTH;
  const cfg = NS.config;

  const adapter = NS.getActiveAdapter();
  if (!adapter) return; // not a supported site

  const tracked = new Map(); // el -> record
  let started = false;

  /* ---------- helpers ---------- */

  function recById(id) {
    for (const [el, rec] of tracked) if (rec.id === id) return [el, rec];
    return null;
  }

  function safe(fn) {
    try {
      return fn();
    } catch {
      return null;
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    }
  }

  /* ---------- overlay handlers ---------- */

  NS.overlay.init(adapter.label, {
    onStart() {
      setStarted(true);
      // Immediate feedback: audit the latest existing response too.
      auditLatest();
    },
    onStop() {
      setStarted(false);
    },
    onAuditLatest: () => auditLatest(),
    onDehallucinateLatest: () => dehallucinateLatest(),
    onOpenOptions() {
      chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" });
    },
    onClaimClick(messageId, claimId) {
      NS.highlights.flashClaim(messageId, claimId);
    },
    onShow(messageId) {
      const entry = recById(messageId);
      if (entry && entry[1].audit) {
        NS.highlights.setForMessage(messageId, entry[0], entry[1].audit.claims || []);
      }
    },
    onHide(messageId) {
      NS.highlights.clearMessage(messageId);
    },
    onRetry(messageId) {
      const entry = recById(messageId);
      if (entry) auditMessage(entry[0], entry[1], true);
    },
    onDehallucinate: (messageId) => runDehallucinate(messageId),
  });

  /* ---------- started state ---------- */

  function setStarted(on) {
    started = on;
    NS.overlay.setStarted(on);
    chrome.storage.sync.set({ [cfg.KEY_STARTED]: on });
    if (!on) {
      NS.overlay.clearAllBadges();
      NS.highlights.clearAll();
    }
  }

  function auditLatest() {
    const els = adapter.getAssistantEls();
    const last = els[els.length - 1];
    if (!last) {
      NS.overlay.toast("No assistant response found on this page yet.");
      return;
    }
    const rec = ensureRecord(last);
    auditMessage(last, rec, true);
  }

  /* ---------- tracking / completion ---------- */

  function ensureRecord(el) {
    let rec = tracked.get(el);
    if (!rec) {
      rec = {
        id: NS.nextId(),
        lastText: "",
        lastChange: Date.now(),
        audited: false,
        auditing: false,
        audit: null,
      };
      tracked.set(el, rec);
    }
    return rec;
  }

  function scan() {
    const els = adapter.getAssistantEls();
    for (const el of els) {
      const rec = ensureRecord(el);
      const text = NS.cleanText(el);
      if (text !== rec.lastText) {
        rec.lastText = text;
        rec.lastChange = Date.now();
      }
    }
    for (const [el, rec] of tracked) {
      if (!el.isConnected) {
        NS.highlights.clearMessage(rec.id);
        NS.overlay.removeBadge(rec.id);
        tracked.delete(el);
      }
    }
    NS.overlay.reposition();
  }

  function maybeAuditCompleted() {
    if (!started) return;
    const now = Date.now();
    for (const [el, rec] of tracked) {
      if (rec.audited || rec.auditing || rec.seenAtLoad) continue;
      if (!el.isConnected) continue;
      if (rec.lastText.length < cfg.MIN_TEXT_LEN) continue;
      let streaming = false;
      try {
        streaming = adapter.isStreaming(el);
      } catch {
        streaming = false;
      }
      if (streaming) {
        rec.lastChange = now;
        continue;
      }
      if (now - rec.lastChange >= cfg.STABILITY_MS) {
        auditMessage(el, rec, false);
      }
    }
  }

  /* ---------- audit ---------- */

  async function auditMessage(el, rec, force) {
    if (rec.auditing) return;
    if (rec.audited && !force) return;
    rec.auditing = true;
    rec.audited = true;
    rec.seenAtLoad = false;

    rec.promptText = safe(() => adapter.getPromptFor(el)) || "";
    NS.overlay.setBadge(rec.id, el, { state: "pending" });

    try {
      const audit = await NS.auditClient.audit(rec.id, rec.lastText);
      rec.audit = audit;
      NS.overlay.setBadge(rec.id, el, { state: "done", audit });
    } catch (e) {
      NS.overlay.setBadge(rec.id, el, {
        state: "error",
        error: e.message || String(e),
      });
    } finally {
      rec.auditing = false;
    }
  }

  /* ---------- dehallucinate (copy grounded re-prompt) ---------- */

  // Launcher entry point: audit the latest reply if needed, then copy a
  // grounded re-prompt for it. Throws a friendly Error (surfaced as a toast)
  // when there's nothing to fix.
  async function dehallucinateLatest() {
    const els = adapter.getAssistantEls();
    const last = els[els.length - 1];
    if (!last) throw new Error("No assistant response found on this page yet.");
    const rec = ensureRecord(last);
    if (!rec.audit) {
      await auditMessage(last, rec, true);
    }
    if (!rec.audit) throw new Error("Couldn't audit the latest response.");
    const s = rec.audit.summary;
    if (s.contradicted + s.likely_hallucination === 0) {
      throw new Error(
        "The latest response has no flagged claims to fix — nothing to dehallucinate.",
      );
    }
    await runDehallucinate(rec.id);
  }

  async function runDehallucinate(messageId) {
    const entry = recById(messageId);
    if (!entry) throw new Error("Message no longer on page.");
    const [el, rec] = entry;
    if (!rec.audit) throw new Error("No audit available for this message.");

    const originalUserMessage =
      rec.promptText || safe(() => adapter.getPromptFor(el)) || "";
    if (!originalUserMessage) {
      throw new Error("Couldn't find the original prompt for this response.");
    }

    const { suggested_prompt } = await NS.auditClient.dehallucinate({
      originalUserMessage,
      flawedResponse: rec.lastText,
      audit: rec.audit,
    });

    const ok = await copyText(suggested_prompt);
    if (!ok) throw new Error("Generated the prompt but clipboard write failed.");
    NS.overlay.toast(
      "Grounded re-prompt copied. Paste it into the chat to regenerate a cleaner answer.",
    );
  }

  /* ---------- boot ---------- */

  // Mark whatever assistant messages already exist when the extension loads as
  // "seen" so activation doesn't auto-audit an entire pre-existing conversation
  // (cost + rate limits). Only genuinely new responses are auto-audited; the
  // user can still check existing ones via "Re-check latest".
  function markExistingAsSeen() {
    for (const el of adapter.getAssistantEls()) {
      const rec = ensureRecord(el);
      rec.lastText = NS.cleanText(el);
      rec.seenAtLoad = true;
    }
  }

  async function loadSettings() {
    try {
      const stored = await chrome.storage.sync.get(cfg.KEY_STARTED);
      started = !!stored[cfg.KEY_STARTED];
      NS.overlay.setStarted(started);
    } catch {
      /* ignore */
    }
    try {
      const conf = await NS.auditClient.getConfig();
      NS.overlay.setApiBase(conf.apiBase);
    } catch {
      /* ignore */
    }
  }

  loadSettings();
  markExistingAsSeen();

  let scanQueued = false;
  const observer = new MutationObserver(() => {
    if (scanQueued) return;
    scanQueued = true;
    setTimeout(() => {
      scanQueued = false;
      scan();
    }, 250);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  setInterval(() => {
    scan();
    maybeAuditCompleted();
  }, cfg.TICK_MS);

  // Toolbar icon click → show/hide the launcher.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "TOGGLE_PANEL") NS.overlay.toggleLauncher();
  });
})();
