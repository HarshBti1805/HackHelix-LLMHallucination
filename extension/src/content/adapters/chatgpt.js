/*
 * ChatGPT adapter (chatgpt.com / chat.openai.com).
 *
 * Assistant + user turns are tagged with `data-message-author-role`, which has
 * been stable across several ChatGPT redesigns and is the most reliable hook.
 * While a message streams, ChatGPT marks the rendered markdown with the
 * `.result-streaming` class and removes it on completion.
 */
(() => {
  const NS = window.__GROUNDTRUTH;
  const USER_SEL = '[data-message-author-role="user"]';
  const ASSISTANT_SEL = '[data-message-author-role="assistant"]';

  NS.registerAdapter({
    id: "chatgpt",
    label: "ChatGPT",
    matches: (host) =>
      host.includes("chatgpt.com") || host.includes("chat.openai.com"),

    getAssistantEls() {
      return Array.from(document.querySelectorAll(ASSISTANT_SEL));
    },

    isStreaming(el) {
      // Per-message marker first, then a global fallback (some layouts put the
      // streaming class on an inner node or on the send/stop button state).
      if (el.querySelector(".result-streaming")) return true;
      if (el.classList.contains("result-streaming")) return true;
      // Stop-generating button present anywhere → a stream is in flight.
      if (
        document.querySelector(
          'button[data-testid="stop-button"], button[aria-label*="Stop"]',
        )
      ) {
        return true;
      }
      return false;
    },

    getPromptFor(el) {
      return NS.helpers.previousUserText(el, USER_SEL);
    },

    getComposer() {
      return (
        document.querySelector("#prompt-textarea") ||
        document.querySelector('div[contenteditable="true"]') ||
        document.querySelector("textarea")
      );
    },

    setComposer(text) {
      return NS.helpers.insertIntoField(this.getComposer(), text);
    },
  });
})();
