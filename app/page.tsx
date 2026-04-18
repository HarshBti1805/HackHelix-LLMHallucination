"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ChatMessage,
  ChatModel,
  ChatRequestBody,
  ChatResponseBody,
  Provider,
} from "@/types";

/**
 * Chat UI inspired by claude.ai's minimal aesthetic.
 * Frontend-only theme toggle (light/dark) persists to localStorage.
 */

const PROVIDER_MODELS: Record<Provider, ChatModel[]> = {
  openai: ["gpt-4o", "gpt-4o-mini"],
  gemini: ["gemini-1.5-pro", "gemini-1.5-flash"],
};

const PROVIDER_LABEL: Record<Provider, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
};

type Theme = "light" | "dark";

function makeUserMessage(content: string): ChatMessage {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role: "user",
    content,
    timestamp: Date.now(),
  };
}

function SunIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SparkIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2l1.8 5.5L19 9.3l-5.2 1.8L12 16l-1.8-5L5 9.3l5.2-1.8L12 2z" />
      <path d="M19 14l.9 2.6L22 17.5l-2.1.9L19 21l-.9-2.6L16 17.5l2.1-.9L19 14z" />
    </svg>
  );
}

function SendIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  );
}

export default function Home() {
  const [theme, setTheme] = useState<Theme>("light");
  const [provider, setProvider] = useState<Provider>("openai");
  const [model, setModel] = useState<ChatModel>("gpt-4o");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Sync theme state with what the no-flash script set on <html>
  useEffect(() => {
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "dark" : "light");
  }, []);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.style.colorScheme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* ignore storage errors */
    }
  }

  function changeProvider(next: Provider) {
    setProvider(next);
    setModel(PROVIDER_MODELS[next][0]);
  }

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 240)}px`;
  }, [input]);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    const userMsg = makeUserMessage(trimmed);
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setPending(true);
    setError(null);

    try {
      const body: ChatRequestBody = {
        messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        provider,
        model,
      };
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `Request failed: ${res.status}`);
      }
      const data = (await res.json()) as ChatResponseBody;
      setMessages((prev) => [...prev, data.message]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
    } finally {
      setPending(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void sendMessage(input);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  }

  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-screen w-full flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-[var(--border)] bg-background/80 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--accent)] text-[var(--accent-foreground)]">
            <SparkIcon className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight">
              Hallucination Audit Trail
            </span>
            <span className="text-[11px] text-[var(--foreground-muted)]">
              Multi-agent verifier
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-1 py-1 text-xs sm:flex">
            <select
              value={provider}
              onChange={(e) => changeProvider(e.target.value as Provider)}
              className="cursor-pointer rounded-full bg-transparent px-2 py-1 text-xs text-[var(--foreground)] outline-none hover:bg-[var(--surface-muted)]"
              aria-label="Provider"
            >
              {(Object.keys(PROVIDER_MODELS) as Provider[]).map((p) => (
                <option key={p} value={p} className="bg-[var(--surface)]">
                  {PROVIDER_LABEL[p]}
                </option>
              ))}
            </select>
            <span className="text-[var(--foreground-muted)]">/</span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value as ChatModel)}
              className="cursor-pointer rounded-full bg-transparent px-2 py-1 text-xs text-[var(--foreground)] outline-none hover:bg-[var(--surface-muted)]"
              aria-label="Model"
            >
              {PROVIDER_MODELS[provider].map((m) => (
                <option key={m} value={m} className="bg-[var(--surface)]">
                  {m}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
          >
            {theme === "dark" ? (
              <SunIcon className="h-4 w-4" />
            ) : (
              <MoonIcon className="h-4 w-4" />
            )}
          </button>
        </div>
      </header>

      {/* Mobile provider/model row */}
      <div className="flex items-center justify-center gap-1 border-b border-[var(--border)] bg-background px-4 py-2 sm:hidden">
        <select
          value={provider}
          onChange={(e) => changeProvider(e.target.value as Provider)}
          className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs"
          aria-label="Provider"
        >
          {(Object.keys(PROVIDER_MODELS) as Provider[]).map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABEL[p]}
            </option>
          ))}
        </select>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value as ChatModel)}
          className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs"
          aria-label="Model"
        >
          {PROVIDER_MODELS[provider].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {/* Conversation / welcome */}
      <main
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
      >
        {!hasMessages ? (
          <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-6 text-center">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm">
              <SparkIcon className="h-6 w-6" />
            </div>
            <h2 className="mb-2 text-3xl font-serif tracking-tight text-[var(--foreground)] sm:text-4xl">
              How can I help you today?
            </h2>
            <p className="mb-8 max-w-md text-sm text-[var(--foreground-muted)]">
              Ask anything. Every assistant reply is fact-checked by three
              independent verifier agents.
            </p>

            <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                "Summarize the findings of Johnson et al. 2021 on intermittent fasting",
                "Who won the 2023 Nobel Prize in Physics, and for what?",
                "What is the population of Lisbon as of 2024?",
                "Explain the Riemann hypothesis in plain English",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => sendMessage(suggestion)}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left text-sm text-[var(--foreground)] transition hover:border-[var(--accent)]/40 hover:bg-[var(--surface-muted)]"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl bg-[var(--user-bubble)] px-4 py-3 text-[15px] leading-relaxed text-[var(--foreground)]">
                    <div className="whitespace-pre-wrap break-words">
                      {m.content}
                    </div>
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--accent)] text-[var(--accent-foreground)]">
                    <SparkIcon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    {m.provider && (
                      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
                        {m.provider} · {m.model}
                      </div>
                    )}
                    <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-[var(--foreground)]">
                      {m.content}
                    </div>
                  </div>
                </div>
              )
            )}

            {pending && (
              <div className="flex gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--accent)] text-[var(--accent-foreground)]">
                  <SparkIcon className="h-3.5 w-3.5" />
                </div>
                <div className="flex items-center gap-1.5 pt-2">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--foreground-muted)] [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--foreground-muted)] [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--foreground-muted)]" />
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-300/60 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Composer */}
      <div className="border-t border-[var(--border)] bg-background px-4 pb-4 pt-3 sm:px-6">
        <form
          onSubmit={handleSubmit}
          className="mx-auto w-full max-w-3xl"
        >
          <div className="group relative flex items-end gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 shadow-sm transition focus-within:border-[var(--accent)]/50 focus-within:shadow-md">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Reply to Hallucination Audit…"
              rows={1}
              disabled={pending}
              className="max-h-60 flex-1 resize-none bg-transparent px-1 py-2 text-[15px] leading-6 text-[var(--foreground)] placeholder:text-[var(--foreground-muted)] focus:outline-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={pending || !input.trim()}
              aria-label="Send message"
              className="mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-foreground)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <SendIcon className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-[var(--foreground-muted)]">
            Responses are audited by three independent verifier agents. Press{" "}
            <kbd className="rounded border border-[var(--border)] bg-[var(--surface)] px-1 font-mono text-[10px]">
              Enter
            </kbd>{" "}
            to send,{" "}
            <kbd className="rounded border border-[var(--border)] bg-[var(--surface)] px-1 font-mono text-[10px]">
              Shift+Enter
            </kbd>{" "}
            for newline.
          </p>
        </form>
      </div>
    </div>
  );
}
