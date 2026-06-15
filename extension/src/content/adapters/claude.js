/*
 * Claude adapter (claude.ai).
 *
 * Claude renders assistant turns inside `.font-claude-message` /
 * `.font-claude-response` containers and user turns inside
 * `[data-testid="user-message"]`. Class names here are less stable than
 * ChatGPT's data attributes, so we try a short list of candidate selectors and
 * lean on the shared stability-based completion detector rather than a
 * Claude-specific "is streaming" flag.
 */
(() => {
  const NS = window.__GROUNDTRUTH;
  const USER_SEL =
    '[data-testid="user-message"], [data-testid="user-turn"]';
  const ASSISTANT_SELECTORS = [
    ".font-claude-message",
    ".font-claude-response",
    '[data-testid="assistant-turn"] .prose',
  ];

  function assistantEls() {
    for (const sel of ASSISTANT_SELECTORS) {
      const found = document.querySelectorAll(sel);
      if (found.length) return Array.from(found);
    }
    return [];
  }

  NS.registerAdapter({
    id: "claude",
    label: "Claude",
    matches: (host) => host.includes("claude.ai"),

    getAssistantEls: assistantEls,

    isStreaming() {
      // Claude shows a "Stop" affordance while generating. If present, assume
      // the latest message is still streaming; otherwise rely on text
      // stability. Returning false here is safe — the stability window catches
      // completion regardless.
      return !!document.querySelector(
        'button[aria-label*="Stop"], button[aria-label*="stop"]',
      );
    },

    getPromptFor(el) {
      return NS.helpers.previousUserText(el, USER_SEL);
    },

    getComposer() {
      return (
        document.querySelector('div[contenteditable="true"].ProseMirror') ||
        document.querySelector('div[contenteditable="true"]') ||
        document.querySelector("textarea")
      );
    },

    setComposer(text) {
      return NS.helpers.insertIntoField(this.getComposer(), text);
    },
  });
})();
