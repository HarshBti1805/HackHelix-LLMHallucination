/*
 * Gemini adapter (gemini.google.com).
 *
 * Gemini is an Angular app that renders responses inside a <model-response>
 * custom element, with the actual prose under `.model-response-text` /
 * `message-content`. User turns live in <user-query> / `.query-text`. The
 * composer is a Quill editor (`.ql-editor`) inside a <rich-textarea>.
 */
(() => {
  const NS = window.__GROUNDTRUTH;
  const USER_SEL = "user-query .query-text, .query-text, user-query";
  const ASSISTANT_SELECTORS = [
    "message-content.model-response-text",
    ".model-response-text",
    "model-response message-content",
    "message-content",
  ];

  function assistantEls() {
    for (const sel of ASSISTANT_SELECTORS) {
      const found = document.querySelectorAll(sel);
      if (found.length) return Array.from(found);
    }
    return [];
  }

  NS.registerAdapter({
    id: "gemini",
    label: "Gemini",
    matches: (host) => host.includes("gemini.google.com"),

    getAssistantEls: assistantEls,

    isStreaming() {
      // Angular toggles a stop/loading control while generating. Best-effort;
      // stability detection is the real guard.
      return !!document.querySelector(
        'button[aria-label*="Stop"], .stop-icon, .blinking-cursor',
      );
    },

    getPromptFor(el) {
      return NS.helpers.previousUserText(el, USER_SEL);
    },

    getComposer() {
      return (
        document.querySelector("rich-textarea .ql-editor") ||
        document.querySelector(".ql-editor") ||
        document.querySelector('div[contenteditable="true"]') ||
        document.querySelector("textarea")
      );
    },

    setComposer(text) {
      return NS.helpers.insertIntoField(this.getComposer(), text);
    },
  });
})();
