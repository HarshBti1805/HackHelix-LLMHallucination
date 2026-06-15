/*
 * Per-site DOM adapter registry.
 *
 * The auditor itself is provider-agnostic and text-only, so the ONLY
 * site-specific logic the extension needs is "how do I read assistant
 * messages and the composer out of this particular page's DOM". Each adapter
 * implements that contract; everything downstream (completion detection,
 * audit, highlighting, panel) is shared and site-independent.
 *
 * Adapter contract:
 *   id                 : string                          unique key
 *   label              : string                          shown in the panel
 *   matches(hostname)  : boolean                         is this the active site?
 *   getAssistantEls()  : Element[]                       assistant message roots
 *   isStreaming(el)    : boolean                         still generating?
 *   getPromptFor(el)   : string                          preceding user prompt
 *   getComposer()      : Element|null                    input box (for paste)
 *   setComposer(text)  : boolean                         best-effort insert text
 */
(() => {
  const NS = window.__GROUNDTRUTH;
  NS.adapters = NS.adapters || {};

  NS.registerAdapter = (adapter) => {
    NS.adapters[adapter.id] = adapter;
  };

  NS.getActiveAdapter = () => {
    const host = location.hostname;
    return (
      Object.values(NS.adapters).find((a) => {
        try {
          return a.matches(host);
        } catch {
          return false;
        }
      }) || null
    );
  };

  /* ---- shared helpers adapters can reuse ---- */

  // Walk previous siblings / ancestors to find the user turn that precedes an
  // assistant turn. Adapters pass their own user-message selector.
  NS.helpers = {
    // Returns the text of the user turn that immediately precedes the given
    // assistant element in document order (the prompt that produced it).
    previousUserText(assistantEl, userSelector) {
      const users = Array.from(document.querySelectorAll(userSelector));
      let best = null;
      for (const u of users) {
        // DOCUMENT_POSITION_FOLLOWING set ⇒ assistantEl comes after u, i.e. u
        // precedes the assistant. Keep the last such user element.
        const pos = u.compareDocumentPosition(assistantEl);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) best = u;
      }
      return best ? NS.cleanText(best) : "";
    },

    // Set text into a textarea OR a contenteditable, dispatching the events
    // front-end frameworks listen for. Returns true on a successful attempt.
    insertIntoField(field, text) {
      if (!field) return false;
      field.focus();
      const tag = field.tagName ? field.tagName.toLowerCase() : "";
      if (tag === "textarea" || tag === "input") {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        if (setter) setter.call(field, text);
        else field.value = text;
        field.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }
      if (field.isContentEditable) {
        // execCommand is deprecated but remains the most reliable way to insert
        // text into a framework-controlled contenteditable (ProseMirror, Quill)
        // while keeping the framework's model in sync.
        try {
          document.execCommand("selectAll", false, undefined);
          document.execCommand("insertText", false, text);
          return true;
        } catch {
          field.textContent = text;
          field.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        }
      }
      return false;
    },
  };
})();
