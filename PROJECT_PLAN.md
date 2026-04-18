# PROJECT_PLAN.md

Hour-by-hour plan for building the Hallucination Audit Trail in a 3-hour window using Cursor. Update the "Status" column as you go — it doubles as your changelog.

Stack is fixed: **Next.js 14 + TypeScript, OpenAI + Gemini (user-switchable chat), OpenAI for auditor, Tavily for search.** Don't change the stack mid-build.

---

## Ground rules

- Commit to git after every working step. Rollback is your safety net.
- Every LLM call uses JSON mode. No regex parsing of free text.
- Test each component in isolation before wiring it into the pipeline.
- If Cursor offers the same "fix" twice in a row, stop and read the code yourself.
- When in doubt, cut scope. The demo matters more than features.

---

## Hour 0 — 0:20  Scaffold and smoke-test

Goal: a running Next.js app with a placeholder chat UI and at least one working LLM call to each provider.

| # | Task | Status |
|---|---|---|
| 0.1 | `npx create-next-app@latest hallucination-audit --ts --tailwind --app --no-src-dir` | ✅ Scaffold verified: Next 16.2.4 + React 19 + TS + Tailwind v4 + App Router, no src/ dir. |
| 0.2 | `npm install openai @google/generative-ai` | ✅ Installed openai@^6.34.0 and @google/generative-ai@^0.24.1. |
| 0.3 | Create `.env.local` with `OPENAI_API_KEY`, `GEMINI_API_KEY`, `TAVILY_API_KEY` | ✅ Created `.env.example` (committed) and `.env.local` (gitignored). Real keys must be filled in before 0.9. |
| 0.4 | Create `types.ts` with the contracts from `CLAUDE.md` | ✅ Created `types.ts` with all ARCHITECTURE.md §3 contracts + API request/response shapes + `MalformedLLMJsonError`. |
| 0.5 | Create `lib/providers/openai.ts` — single `chat(messages, model)` function | ✅ Created `openaiChat(messages, model)` with lazy-initialized shared client. JSON wrapper deferred to 1.3. |
| 0.6 | Create `lib/providers/gemini.ts` — single `chat(messages, model)` function | ✅ Created `geminiChat(messages, model)` with role normalization (`assistant` → `model`) and `systemInstruction` extraction. |
| 0.7 | Create `app/api/chat/route.ts` — dispatches by `provider` field | ✅ POST handler validates body, dispatches to `openaiChat` / `geminiChat`, returns `{ message: ChatMessage }`. |
| 0.8 | Build minimal `app/page.tsx` — input box, provider dropdown, message list, send button | ✅ Client component with provider+model dropdowns, message list, async POST to `/api/chat`, error banner. |
| 0.9 | Send a test message through each provider. Confirm responses stream back. | ⚠ Partial: OpenAI returns content end-to-end; Gemini wiring verified (request reaches Google, error surfaces cleanly) but blocked on a valid `GEMINI_API_KEY`. |
| 0.10 | **Commit: "scaffold: working chat with OpenAI and Gemini switch"** | ✅ Committed after rewriting history to evict accidental real keys from `.env.example`. |

**Exit criterion:** you can type a message, select OpenAI or Gemini, and see a response. Nothing else works yet. That's fine.

**Common traps:**
- Gemini's message format differs from OpenAI's (`role: "model"` not `"assistant"`). Handle in the provider wrapper.
- Don't bother with streaming yet. Plain `await` is fine for this hour.

---

## Hour 0:20 — 1:00  Claim extraction + search, tested in isolation

Goal: prove you can extract structured claims and find evidence for them. No UI yet.

| # | Task | Status |
|---|---|---|
| 1.1 | Create `lib/search.ts` — wrap Tavily's `/search` endpoint. Expose `search(query, { domains? })`. | ✅ Bearer-auth Tavily wrapper, maps results → `EvidenceSource`, supports `includeDomains`/`maxResults`/`searchDepth`. |
| 1.2 | Smoke-test `search` from a scratch script (`npx tsx scratch.ts`). Print results for "Eiffel Tower height". | ✅ `scripts/smoke-search.ts` returned 5 results from wikipedia/britannica/toureiffel.paris. |
| 1.3 | Create `lib/extract.ts` — one OpenAI call, JSON mode, returns `Claim[]`. Prompt lives in this file as `EXTRACTOR_PROMPT`. | ✅ Added `openaiJson<T>` wrapper (throws `MalformedLLMJsonError`). Prompt lives in `lib/prompts/extractor.ts` per ARCHITECTURE.md §2 (overrides plan's "in this file" wording). `extract.ts` validates types and ids. |
| 1.4 | Smoke-test extraction on a paragraph with obvious claims. Expect 3–6 atomic claims back. | ✅ `scripts/smoke-extract.ts`: 6 atomic claims (2 numerical, 3 entity, 1 citation) with correct entities. |
| 1.5 | Tighten the extractor prompt until it filters out opinions and predictions cleanly. | ✅ v1 prompt already filters opinion ("most beautiful city"), prediction ("By 2050…"), and definition ("algorithm is…") on first run. |
| 1.6 | Create `lib/cache.ts` — file-based cache keyed by SHA of input. Wrap both `search` and LLM calls. | ✅ `withCache(namespace, fn)` writes to `<tmpdir>/halluc-cache/<ns>/<sha>.json`, no-op in production. Wrapped `search` (4.2s→0.32s) and `openaiJson` (15.1s→0.36s). |
| 1.7 | **Commit: "extract + search working in isolation"** | ✅ |

**Exit criterion:** from a scratch script, you can pass in a paragraph, get back a list of `Claim` objects, and for each claim get 3–5 Tavily search results.

**Trap to avoid:** don't skip the cache. You'll run the same test inputs 30+ times over the next hour. File cache saves money and latency.

---

## Hour 1:00 — 1:45  Multi-agent verification + consensus

Goal: the heart of the project. Three subagents, parallel, with real reasoning diversity.

| # | Task | Status |
|---|---|---|
| 2.1 | In `lib/agents.ts`, define three role prompts: `PROSECUTOR_PROMPT`, `DEFENDER_PROMPT`, `LITERALIST_PROMPT`. Each clearly states stance. | ☐ |
| 2.2 | Define `runAgent(claim, role)` — searches (with domain scope for Literalist), then OpenAI JSON call returning `AgentReport`. | ☐ |
| 2.3 | Define `verifyClaim(claim)` — runs all 3 agents in parallel via `Promise.all`. | ☐ |
| 2.4 | Create `lib/aggregate.ts` — takes 3 `AgentReport`s, returns `ClaimAudit` with consensus verdict, averaged confidence, and agreement score. | ☐ |
| 2.5 | Agreement score formula: `1 - (distinct_verdicts - 1) / 2`. All agree → 1.0. Two distinct → 0.5. Three distinct → 0.0. | ☐ |
| 2.6 | Smoke-test the full audit pipeline on a paragraph with 1 obvious truth and 1 obvious hallucination. Print the full `MessageAudit`. | ☐ |
| 2.7 | Confirm the obvious hallucination gets `likely_hallucination` or `contradicted`. If not, tighten agent prompts. | ☐ |
| 2.8 | Confirm at least one demo prompt produces agent disagreement (different verdicts across the 3 agents). | ☐ |
| 2.9 | Create `app/api/audit/route.ts` — receives a message, runs the pipeline, returns `MessageAudit`. | ☐ |
| 2.10 | **Commit: "multi-agent verification + consensus working"** | ☐ |

**Exit criterion:** POST to `/api/audit` with an assistant response, get back a `MessageAudit` with per-claim verdicts and per-agent breakdowns.

**Critical check at 2.8:** if all 3 agents always agree, your prompts aren't diverse enough. The Prosecutor must be meaningfully more skeptical than the Defender. If they're converging, you've lost the most important signal in the project.

**Per-message cap:** if extraction returns >6 claims, audit only the first 6. Keep demos fast.

---

## Hour 1:45 — 2:20  Wire the audit into the UI

Goal: audit results render alongside chat messages, color-coded, expandable.

| # | Task | Status |
|---|---|---|
| 3.1 | After assistant response lands, client fires `/api/audit` asynchronously (don't block the chat UI). | ☐ |
| 3.2 | Store audits in client state keyed by `message_id`. | ☐ |
| 3.3 | Below each assistant message, render a claims panel: one row per claim. | ☐ |
| 3.4 | Color-code by verdict: green / yellow / orange / red. Show confidence as a percentage. | ☐ |
| 3.5 | If `agents_disagreed`, show a ⚠ badge. | ☐ |
| 3.6 | Click a claim to expand: show per-agent verdicts, reasoning, and source links. | ☐ |
| 3.7 | Show a summary bar per message: "3 verified, 1 unverified, 2 hallucinations". | ☐ |
| 3.8 | **Commit: "audit UI wired up with expandable claim breakdowns"** | ☐ |

**Exit criterion:** send a message that will hallucinate (e.g., "Tell me about the 2019 Anthropic paper on recursive self-improvement"). See the audit panel populate. Click a red claim, see the 3 agents' reasoning.

**Trap:** don't try to make the UI beautiful yet. Readable is enough. Polish is hour 2:50.

---

## Hour 2:20 — 2:45  Dehallucinate loop

Goal: the closing move. User can regenerate a cleaner response using audit evidence.

| # | Task | Status |
|---|---|---|
| 4.1 | Create `lib/dehallucinate.ts` — builds a rewrite prompt string from original user message + flawed response + failed claims + gathered evidence. | ☐ |
| 4.2 | Create `app/api/dehallucinate/route.ts` — one OpenAI JSON call wrapping `lib/dehallucinate.ts`'s input. Returns `{ suggested_prompt: string }`. | ☐ |
| 4.3 | Prompt must: quote specific failed claims, inline the evidence, forbid fabricated citations, permit "I don't know." | ☐ |
| 4.4 | Add a "Regenerate without hallucinations" button to each assistant message that has any failed claims. | ☐ |
| 4.5 | Button opens a modal with the generated prompt in an **editable** text area. User reviews and sends. | ☐ |
| 4.6 | Send path reuses `/api/chat` with the edited prompt. New response is audited automatically. | ☐ |
| 4.7 | When re-audit completes, show a small before/after summary: "Original: 3 hallucinations. After: 0 hallucinations, 5 verified." | ☐ |
| 4.8 | **Commit: "dehallucinate loop with editable grounded prompt"** | ☐ |

**Exit criterion:** full loop demo — hallucinated response → audit catches it → dehallucinate → edited prompt → cleaner response → re-audit confirms improvement.

**Non-negotiable:** the generated prompt must be shown to the user *before* sending. Do not auto-send.

---

## Hour 2:45 — 3:00  Polish, demo prep, README

| # | Task | Status |
|---|---|---|
| 5.1 | Prepare 3 demo prompts (saved as buttons or in README): one that triggers citation hallucination, one with contested numbers, one benign. | ☐ |
| 5.2 | Take a screenshot of the provider comparison (same prompt, OpenAI vs Gemini side-by-side audits) for the README. | ☐ |
| 5.3 | Quick pass on UI: spacing, typography, make the agreement ⚠ badge visible. | ☐ |
| 5.4 | Write/update "Known limitations" section of README with anything you discovered during build. | ☐ |
| 5.5 | Run the full demo once end-to-end. Time it. Should be under 90 seconds. | ☐ |
| 5.6 | **Commit: "demo-ready"** | ☐ |

---

## If things go wrong

Ordered cut list, from least painful to most:

1. **Drop the before/after improvement number.** Just show that regeneration produces a new audit.
2. **Drop Gemini.** Ship OpenAI-only, note provider-switching in "future work."
3. **Drop the Literalist agent.** Run with 2 agents (Prosecutor + Defender). Still gives meaningful consensus, weaker demo.
4. **Drop the dehallucinate loop.** The multi-agent audit alone is a complete project.

Never cut the multi-agent consensus itself. That's the project.

---

## Done criteria

You can demo in under 2 minutes:

1. Select OpenAI. Send a prompt designed to hallucinate.
2. Response appears. Audit panel populates with red/orange claims.
3. Click a claim showing agent disagreement. Explain the 3 agents' stances.
4. Click "Regenerate without hallucinations." Show the generated prompt. Edit one word. Send.
5. New response appears. Audit shows measurable improvement.
6. (Stretch) Switch provider to Gemini, re-run the original prompt, compare audits.

If all 6 work, you're done.