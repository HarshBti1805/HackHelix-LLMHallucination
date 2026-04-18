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
| 2.1 | In `lib/agents.ts`, define three role prompts: `PROSECUTOR_PROMPT`, `DEFENDER_PROMPT`, `LITERALIST_PROMPT`. Each clearly states stance. | ✅ Prompts live in `lib/prompts/{prosecutor,defender,literalist}.ts` per ARCHITECTURE.md §2 (overrides plan's "in agents.ts"). Each enforces a distinct stance, burden of proof, and default-when-thin verdict; all share an identical JSON output schema with `cited_source_indices` (no source-text fabrication). |
| 2.2 | Define `runAgent(claim, role)` — searches (with domain scope for Literalist), then OpenAI JSON call returning `AgentReport`. | ✅ `lib/agents.ts`: `runAgent` does scoped search → numbered evidence → role prompt → JSON, maps `cited_source_indices` back to `EvidenceSource[]` server-side (no source fabrication). Smoke test: TRUE claim → all 3 verified; HALLUCINATED citation → prosecutor `likely_hallucination`, defender + literalist `unverified_plausible` (intended divergence). |
| 2.3 | Define `verifyClaim(claim)` — runs all 3 agents in parallel via `Promise.all`. | ✅ Returns `AgentReport[]` in `AGENT_ROSTER` order; 2.4 will wrap with `aggregate()` to return `ClaimAudit`. Cold-cache parallel = 10.5s vs ~15.7s sequential (~33% speedup). Smoke test surfaced 3-way disagreement on Eiffel Tower height (literalist `contradicted` on the 300m vs 330m antenna nuance). |
| 2.4 | Create `lib/aggregate.ts` — takes 3 `AgentReport`s, returns `ClaimAudit` with consensus verdict, averaged confidence, and agreement score. | ✅ Pure module: `consensusVerdict` (majority, ties → most-severe), `agreementScore`, `aggregate(claim, reports)`. `verifyClaim` updated to return `ClaimAudit`. Smoke test on `[verified, verified, contradicted]@0.90` → `verified / 0.90 / 0.50 / true` as expected. |
| 2.5 | Agreement score formula: `1 - (distinct_verdicts - 1) / 2`. All agree → 1.0. Two distinct → 0.5. Three distinct → 0.0. | ✅ `scripts/test-aggregate.ts` — 23/23 assertions pass. Covers canonical 1.0/0.5/0.0 cases, edge cases (0/1/2 agents), majority rule, tie-breaking on severity (1-1-1 → most severe), confidence clamping, and full `aggregate` assembly. |
| 2.6 | Smoke-test the full audit pipeline on a paragraph with 1 obvious truth and 1 obvious hallucination. Print the full `MessageAudit`. | ✅ Factored orchestration into `lib/audit.ts` (`auditMessage(messageId, content)`) — extract → `Promise.all` over claims → per-claim `Promise.all` over agents → summary. Smoke at `scripts/smoke-audit.ts`. End-to-end (1 extract + 2 claims × 3 verifiers + searches) cold-cache: ~21s. Truth claim: 3-way `verified`, agreement=1.0. Hallucination claim: prosecutor `likely_hallucination@0.90`, defender `unverified_plausible@0.60`, literalist `unverified_plausible@0.10`, consensus `unverified_plausible`, agreement=0.5, disagreed=true. **Consensus is below threshold for 2.7** — needs prompt tightening. |
| 2.7 | Confirm the obvious hallucination gets `likely_hallucination` or `contradicted`. If not, tighten agent prompts. | ✅ Tightened Literalist (citation claims w/ no exact author+year+venue match → `likely_hallucination` @ ≥0.85, no carve-out for "defer to prosecutor") and Defender (related-but-non-matching sources are DISCONFIRMING, not neutral, for citation claims; numerical/entity rules unchanged). Re-run: Eiffel Tower still 3-way `verified` agreement=1.0; fabricated citation now 3-way `likely_hallucination`, consensus conf=0.88, agreement=1.0. Defender reasoning genuinely shifted from "related work exists so plausible" to "search yielded related works but none confirmed the exact study → cited study is likely not real". |
| 2.8 | Confirm at least one demo prompt produces agent disagreement (different verdicts across the 3 agents). | ✅ `scripts/smoke-disagree.ts` — entity claim "Tesla was founded by Elon Musk in 2003." Truth control (Eiffel Tower) still 3-way `verified`, agreement=1.0. Tesla claim: prosecutor `contradicted@0.90`, defender `unverified_plausible@0.80` (steelman: "common misconception"), literalist `contradicted@0.90` (word-for-word against Wikipedia). Consensus `contradicted`, agreement=0.50, disagreed=true, 2 distinct verdicts. Reasoning is substantively different per agent (authority/historical-record vs charitable-common-usage vs literal-string-match), not template-similar. All 8 assertions pass. |
| 2.9 | Create `app/api/audit/route.ts` — receives a message, runs the pipeline, returns `MessageAudit`. | ✅ Thin POST handler: parses `AuditRequestBody`, validates `message_id` + `content`, calls `auditMessage`, returns `MessageAudit`. `MAX_CLAIMS_PER_MESSAGE = 6` lives in `lib/audit.ts` (sliced post-extract per ARCHITECTURE.md §5.4). Errors always return `{ error }`: 400 on bad request, 502 on `MalformedLLMJsonError`, 500 on other exceptions. `maxDuration = 60`. Live HTTP smoke: 200 OK in 3.9s for the truth+disagreement payload, all four 400 validation paths return clean error envelopes. `tsc --noEmit` clean. |
| 2.10 | **Commit: "multi-agent verification + consensus working"** | ✅ Commit `8f30778`, 13 files / +1373 -10. Branch ahead of `origin/main` by 1; not pushed (per project policy — push only on explicit request). |

**Exit criterion:** POST to `/api/audit` with an assistant response, get back a `MessageAudit` with per-claim verdicts and per-agent breakdowns.

**Critical check at 2.8:** if all 3 agents always agree, your prompts aren't diverse enough. The Prosecutor must be meaningfully more skeptical than the Defender. If they're converging, you've lost the most important signal in the project.

**Per-message cap:** if extraction returns >6 claims, audit only the first 6. Keep demos fast.

---

## Hour 1:45 — 2:20  Wire the audit into the UI

Goal: audit results render alongside chat messages, color-coded, expandable.

| # | Task | Status |
|---|---|---|
| 3.1 | After assistant response lands, client fires `/api/audit` asynchronously (don't block the chat UI). | ✅ `requestAudit(id, content)` in `app/page.tsx` is fire-and-forget — `sendMessage` calls it without `await` right after the assistant `setMessages`, so the textarea unlocks while the audit runs. Verified live: sent message N+1 while message N's audit was still in flight; chat stayed responsive. |
| 3.2 | Store audits in client state keyed by `message_id`. | ✅ Three separate maps per ARCHITECTURE.md §7: `audits: Record<string, MessageAudit>`, `pendingAudits: Set<string>`, `auditErrors: Record<string, string>`. Mutually exclusive states; functional setState updates produce new Set/Record instances so React diffs cleanly. |
| 3.3 | Below each assistant message, render a claims panel: one row per claim. | ✅ `<AuditPanel>` mounts under every assistant message; resolves to `<AuditSkeleton>` (in flight), `<AuditError>` (failed), `<AuditEmpty>` (zero verifiable claims — distinct from "still loading"), or a list of `<ClaimRow>`s. |
| 3.4 | Color-code by verdict: green / yellow / orange / red. Show confidence as a percentage. | ✅ `VERDICT_STYLES` map: emerald / amber / orange / rose, with both light and dark mode tints. Each row has a 4px left border stripe + tinted bg + colored verdict pill. Confidence rendered as `formatConfidence` (1 decimal place, clamped to [0,1]). Avoided the brand `--accent` token (also orange) to prevent collision with `contradicted`. |
| 3.5 | If `agents_disagreed`, show a ⚠ badge. | ✅ Amber pill "⚠ Agents disagreed" placed adjacent to the verdict label inside the row header. `title` attribute reads "Agents disagreed — click to see per-agent breakdown". Verified on Tesla (badge shown) vs Eiffel Tower (no badge). |
| 3.6 | Click a claim to expand: show per-agent verdicts, reasoning, and source links. | ✅ Header is a `<button aria-expanded>` with a chevron that rotates 180° (transition-transform). Local `useState<Set<claim_id>>` in `AuditPanel` allows multiple rows expanded simultaneously. Details panel renders below the header (sibling, not nested in the button — keeps source `<a>` links out of `<button>`). Shows original sentence (italic muted), then per-agent: role label, verdict pill + confidence, full untruncated reasoning, sources as `<a target="_blank" rel="noopener noreferrer">` with domain as link text and page title as subtitle + `title` attr. Empty source list renders "No sources" italic muted, never collapses. |
| 3.7 | Show a summary bar per message: "3 verified, 1 unverified, 2 hallucinations". | ✅ `<SummaryBar>` above the claim rows. Iterates `SUMMARY_CATEGORIES` in fixed order, skips zero-count entries, renders each as a verdict-colored pill with `·` separators. Reuses `VERDICT_STYLES.pill` so colors echo the rows. Verified on the 3-claim test: "1 VERIFIED · 1 CONTRADICTED · 1 LIKELY HALLUCINATION" with `unverified_plausible=0` correctly hidden. |
| 3.8 | **Commit: "audit UI wired up with expandable claim breakdowns"** | ✅ Hour 3 changes (audit fetch, panel, expansions, summary bar) committed in one shot. |

**Exit criterion:** send a message that will hallucinate (e.g., "Tell me about the 2019 Anthropic paper on recursive self-improvement"). See the audit panel populate. Click a red claim, see the 3 agents' reasoning.

**Trap:** don't try to make the UI beautiful yet. Readable is enough. Polish is hour 2:50.

---

## Hour 2:20 — 2:45  Dehallucinate loop

Goal: the closing move. User can regenerate a cleaner response using audit evidence.

| # | Task | Status |
|---|---|---|
| 4.1 | Create `lib/dehallucinate.ts` — builds a rewrite prompt string from original user message + flawed response + failed claims + gathered evidence. | ✅ `buildDehallucinatePrompt({originalUserMessage, flawedResponse, audit})` filters claims to `contradicted` ∪ `likely_hallucination`, dedupes evidence by URL across the three subagents, then sends a single JSON-mode OpenAI call. Throws `MalformedLLMJsonError` if `suggested_prompt` is missing/empty. Exports `hasFailedClaims` for the (server-side) symmetry check; the client re-derives it from `audit.summary` to keep the OpenAI SDK out of the bundle. |
| 4.2 | Create `app/api/dehallucinate/route.ts` — one OpenAI JSON call wrapping `lib/dehallucinate.ts`'s input. Returns `{ suggested_prompt: string }`. | ✅ Thin POST endpoint mirroring `/api/audit`'s shape: body validation → 400, malformed LLM JSON → 502, anything else → 500 with a real `error` message. `runtime = "nodejs"`, `maxDuration = 60`. |
| 4.3 | Prompt must: quote specific failed claims, inline the evidence, forbid fabricated citations, permit "I don't know." | ✅ `lib/prompts/dehallucinator.ts` documents input shape, requires verbatim `original_sentence` quoting, requires per-claim evidence blocks (URL+title+snippet), explicitly forbids invented citations, explicitly permits "I cannot verify this", preserves user intent, and addresses the downstream chat model directly. JSON-only output. |
| 4.4 | Add a "Regenerate without hallucinations" button to each assistant message that has any failed claims. | ✅ Rendered inside `<AuditPanel>` next to the summary bar (message-level, not claim-level). Visibility gated by `failedClaimCount(audit) > 0` — verified by sending the Johnson prompt (button appeared with "(1)") and a pure Eiffel Tower question (no button). Per-message loading + error state via `dehallucPending: Set<string>` and `dehallucErrors: Record<string, string>`. |
| 4.5 | Button opens a modal with the generated prompt in an **editable** text area. User reviews and sends. | ✅ `<DehallucinateModal>` is a top-level slot driven by `AppState.dehallucinateModal`. Backdrop click + Cancel + Esc all close cleanly; body scroll is locked while open and restored on unmount. Textarea is fully editable (verified: typed `EDITED PROMPT TEST …` and the `value` updated). Send is intentionally a placeholder this shot — `console.log`s the edited text and closes the modal; the real `/api/chat` re-issue is task 4.6. |
| 4.6 | Send path reuses `/api/chat` with the edited prompt. New response is audited automatically. | ✅ Factored `sendUserMessage(text, opts?)` out of `sendMessage` so the dehallucinate Send button calls the *exact* same chat path as the composer — no `/api/regenerate` endpoint, no duplicated POST logic. Modal closes synchronously before the network call (responsiveness). The edited textarea content is what gets sent (verified live: filled `[EDITED] Please re-answer …` and the user-message bubble rendered with that exact prefix). New `regenerates_message_id` field on `ChatMessage` (the only `types.ts` change this shot) is stamped on both the user message and the assistant reply so either side can locate the pair. |
| 4.7 | When re-audit completes, show a small before/after summary: "Original: 3 hallucinations. After: 0 hallucinations, 5 verified." | ✅ `<BeforeAfterDiff>` mounts above any assistant message whose `regenerates_message_id` is set. Reuses `<SummaryBar>` so colors/pills match exactly — no new visual language. Each side independently handles `auditing…` / `audit unavailable` / `no verifiable claims` / populated states, so the diff is visible as soon as the message renders even if the re-audit is still in flight. Total claim count shown alongside each side. No improvement-direction coloring (numbers speak for themselves, per spec). Verified Johnson: `Before: 6 total · 2 verified · 1 unverified · 2 contradicted · 1 likely hallucination → After: no verifiable claims` (model abstained). Verified Tesla: `Before: 3 total · 2 verified · 1 contradicted → After: 6 total · 6 verified`. Confirmed a normal turn (`What is the capital of France?`) sent immediately after a regeneration does NOT render the diff block. |
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