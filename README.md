# Hallucination Audit Trail

A chat interface that fact-checks LLM responses in real time using a multi-agent verification pipeline. Every factual claim in an AI-generated response is traced back to a verifiable source, and the system produces an audit report distinguishing verified claims, unverified-but-plausible claims, and likely hallucinations — each with a confidence score derived from independent subagent consensus.

The user can switch the **chat model** between **OpenAI (GPT-4o)**, **Anthropic (Claude Haiku 4.5)**, and **Google (Gemini 2.5 Flash)** to compare which one hallucinates less on the same prompt. The **auditor** is held constant (OpenAI `gpt-4o-mini`) so the comparison measures the chat model's behavior, not auditor variance.

When hallucinations are detected, the system can generate a grounded "dehallucinate" prompt that uses the evidence already gathered to regenerate a cleaner response.

---

## What it does

1. **Chat** — user picks a provider (OpenAI, Anthropic, or Gemini) and talks to it. Responses stream back.
2. **Audit** — each assistant response is automatically analyzed:
   - **Claim extraction** — an LLM call breaks the response into atomic factual claims (numerical, entity, citation).
   - **Multi-agent verification** — 3 independent subagents verify each claim in parallel, each with a different reasoning stance and/or evidence scope:
     - **Prosecutor** — searches general web, tries to find reasons to doubt.
     - **Defender** — searches general web, tries to steelman the claim.
     - **Literalist** — searches high-trust sources (Wikipedia, official/academic domains), verifies word-for-word.
   - **Consensus aggregation** — verdicts are combined, confidence is averaged, *disagreement is surfaced as its own signal*.
3. **Display** — claims render inline with color-coded verdicts (verified / unverified / contradicted / likely hallucination) and expandable per-agent breakdowns.
4. **Dehallucinate** — user clicks to generate a grounded follow-up prompt that uses audit evidence to request a corrected response. Re-auditing the new response shows measurable improvement (before/after diff).

---

## Stack

- **Next.js 14 + TypeScript** (App Router, single app, API routes for backend logic — not a monorepo)
- **OpenAI SDK** (`openai`) — chat (user-selectable) + all auditor agents
- **Anthropic SDK** (`@anthropic-ai/sdk`) — chat (user-selectable)
- **Google Generative AI SDK** (`@google/generative-ai`) — chat (user-selectable)
- **Tavily** — web search / evidence retrieval
- **Tailwind CSS** — styling
- In-memory state only (no database, no persistence across refreshes)

---

## Setup

```bash
npm install
cp .env.example .env.local
# Fill in OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, TAVILY_API_KEY
npm run dev
```

Open http://localhost:3000.

### Required environment variables

| Variable | Where to get it |
|---|---|
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey |
| `TAVILY_API_KEY` | https://tavily.com (instant free tier) |

---

## Architecture

Full technical detail — data flow, module specifications, type contracts, API schemas — is in [`ARCHITECTURE.md`](./ARCHITECTURE.md). Quick summary below.

```
hallucination-audit/
├── app/
│   ├── page.tsx                    # chat UI + audit panel + provider switcher
│   ├── layout.tsx
│   └── api/
│       ├── chat/route.ts           # routes to OpenAI, Anthropic, or Gemini based on provider
│       ├── audit/route.ts          # orchestrates extract → verify (3 agents) → aggregate
│       └── dehallucinate/route.ts  # builds grounded rewrite prompt
├── lib/
│   ├── providers/
│   │   ├── openai.ts               # OpenAI chat wrapper
│   │   ├── anthropic.ts            # Anthropic chat wrapper
│   │   └── gemini.ts               # Gemini chat wrapper
│   ├── agents.ts                   # subagent role definitions + runner
│   ├── extract.ts                  # claim extraction (OpenAI, JSON mode)
│   ├── search.ts                   # Tavily wrapper with domain scoping
│   ├── aggregate.ts                # consensus + agreement score
│   ├── dehallucinate.ts            # grounded prompt builder
│   └── cache.ts                    # simple file-based cache for dev
├── types.ts                        # shared types (Claim, Verdict, AgentReport, etc.)
├── .env.example
├── package.json
├── README.md
├── CLAUDE.md                       # guidance for Cursor / Claude Code
└── PROJECT_PLAN.md                 # 3-hour build plan with hour-by-hour tasks
```

### Data flow for one chat turn

```
User message
   │
   ▼
/api/chat  ──► OpenAI, Anthropic, or Gemini (based on selected provider)
   │
   ▼
Assistant response  ──► UI renders immediately
   │
   ▼
/api/audit (async, non-blocking)
   │
   ├─► extract.ts         returns Claim[]
   │
   ├─► for each claim, in parallel:
   │     agents.ts runs 3 subagents in parallel:
   │       • Prosecutor  (general search, skeptical prompt)
   │       • Defender    (general search, charitable prompt)
   │       • Literalist  (high-trust domain search, strict prompt)
   │     Each returns AgentReport { verdict, confidence, reasoning, sources }
   │
   ├─► aggregate.ts       returns ClaimAudit { consensus_verdict,
   │                                           consensus_confidence,
   │                                           agreement_score,
   │                                           per_agent_reports }
   │
   ▼
UI updates with audit panel; claims color-coded, expandable
```

### Dehallucinate flow

```
User clicks "Regenerate without hallucinations"
   │
   ▼
/api/dehallucinate
   │
   ├─► Collect: original user prompt, flawed response, audit results,
   │   evidence snippets gathered during verification
   │
   ├─► Prompt-builder LLM call → rewritten prompt (shown to user, editable)
   │
   ▼
User reviews, edits, sends
   │
   ▼
/api/chat (again) → new response → /api/audit (again)
   │
   ▼
UI shows before/after diff: claim counts, verification rates
```

---

## Verdict taxonomy

| Verdict | Meaning | Color |
|---|---|---|
| **Verified** | Evidence found, claim matches | green |
| **Unverified-plausible** | No direct evidence, nothing contradicts | yellow |
| **Contradicted** | Evidence found, claim disagrees | orange |
| **Likely hallucination** | Citation/entity doesn't appear to exist, or multiple contradictions | red |

**Agreement score** is reported separately from verdict confidence. A claim where all 3 agents say "verified @ 0.9" is very different from one averaging 0.9 but with one dissenter saying "false @ 0.95." The UI surfaces both.

---

## What's in scope (and what's not)

**In scope:**
- Numerical claims (percentages, dates, quantities)
- Named entities (people, orgs, events with dates)
- Citations (papers, articles, reports)

**Not in scope (by design):**
- Opinions, definitions, causal arguments, predictions
- Multimodal input (images, PDFs)
- Persistence across sessions
- Production-grade authentication or rate limiting

---

## Known limitations

- **Correlated auditor failures** — all 3 subagents use the same underlying model (`gpt-4o-mini`). Prompt diversity mitigates but doesn't eliminate shared biases. A future version would mix providers.
- **Search is noisy** — Tavily returns web results which vary in quality. The Literalist agent's domain filter helps, but a claim's verdict can still hinge on which sources happen to rank highly.
- **The dehallucinator is an LLM** — it can misrepresent the audit or introduce new errors. The UI shows the generated prompt before sending for this reason.
- **Cost and latency** — each chat turn triggers 1 extraction call + (3 agents × N claims) verification calls. A message with 5 claims = 16 LLM calls. Per-message cap defaults to first 6 claims; adjustable in `lib/agents.ts`.
- **Citation-type claims bias toward the hallucination verdict.** The Literalist agent treats absence of evidence on high-trust domains as evidence of absence, which is correct for fabricated citations like "Johnson et al. 2021" but punishes real-but-obscure papers that aren't well indexed by general web search. Documented trade-off from extractor tuning (see `PROJECT_PLAN.md` task 2.7) — we accept the false-positive rate on citations because the false-negative rate on actual fabrications is the failure mode this project exists to prevent.
- **Per-agent evidence sets can diverge.** Each subagent issues its own Tavily query with its own domain scoping, so two agents can land on disjoint source lists for the same claim. This is *intentional* — independence is what makes the consensus signal meaningful — but it does mean the "agents disagreed" badge sometimes reflects different evidence rather than different reasoning over the same evidence. Surfaced live on the Tesla Roadster claim during the demo run.
- **Regeneration sometimes produces "no verifiable claims".** When the dehallucinate prompt successfully causes the model to abstain ("I cannot verify this study's findings…"), the extractor finds no checkable atomic claims and the after-side of the diff renders `no verifiable claims`. This is the *intended* success path on fabricated-citation prompts: zero claims is strictly better than confident invention. It is not a bug or empty audit. (It is, however, a less satisfying demo visual than `0 contradicted`, so the diff component renders it explicitly rather than silently.)
- **Regeneration is not guaranteed to succeed in one shot.** On the Johnson prompt, gpt-4o sometimes re-fabricates a *different* citation in the regenerated response (e.g. inventing a study on "obese asthmatic patients" instead). The audit catches the re-fabrication and the Regenerate button appears again on the new message, but a second pass is sometimes required. There is no automatic retry — the user decides whether to regenerate again.
- **The Gemini chat uses Flash (lighter tier) rather than Pro, to keep the eval harness reliably within free-tier quota. This is a known parity limitation in the three-provider comparison.**
- **Strict date/year verification can be outvoted.** When two agents fail to locate a specific date and the third correctly contradicts it, majority-vote consensus reports the incorrect claim as `verified`. The disagreement badge surfaces this, but the top-line verdict misses it. Observed on the IRA-2021 claim in the renewable-energy test document: the Literalist correctly flagged it as `contradicted` (citing Wikipedia, which gives August 2022), but the Prosecutor and Defender both verified, and the consensus came back `verified` with `agents_disagreed=True`. Reviewers who only scan the top-line color miss the catch; reviewers who notice the disagreement badge and expand the row see it. We considered weighting the Literalist's domain-scoped sources more heavily for date/year claims, but that would entangle aggregation logic with claim-type semantics in a way that's hard to roll back — kept the simple majority vote and document the failure mode here instead. Observed twice across Phase A and Phase B: the Defender's charitable reading plus Tavily returning adjacent-topic sources can produce a false-verified verdict on a fabricated claim.
- **Citation-bias side effects on surrounding facts.** When a sentence contains a real number attached to a fabricated citation (e.g., "89% LCOE decline per Chen & Patel 2023"), both get flagged as `likely_hallucination`. The citation is correctly caught, but the real number is pulled down with it, because the extractor treats the entire sentence as one atomic claim and the verifier's "no source for this exact attribution" signal dominates. Documented trade-off from PROJECT_PLAN.md task 2.7's prompt tightening — we kept the citation-bias because the false-negative cost (missing a fabricated citation) outweighs the false-positive cost (over-flagging a real number with bad provenance).
- **Three-provider eval coverage is uneven.** Gemini's free-tier daily quota (20 requests/day on `gemini-2.5-flash`) was exhausted during the Phase B run, leaving 7 of 15 cells as errors. Full-coverage comparison is OpenAI vs Anthropic; Gemini results cover 8 of 15 cells only. See "Empirical model comparison" below for the full coverage disclosure.
- **Hallucination rate favors verbose providers.** A provider that hedges into many `unverified_plausible` claims will score lower than one that refuses (0 claims = undefined rate). The `specific-fact` and `compound-claim` categories are most comparable across providers — both reward atomic correctness and don't reward hedging volume.

---

## Document audit findings

Manual test of the document audit pipeline (IMPROVEMENTS.md Phase A) on two seeded fixtures:

On `test-docs/renewable-energy-brief.md` (4 planted errors: two fabricated citations, the Germany-67.2%-renewable claim, the IRA-signed-in-2021 claim), the audit caught **2 of 4 at top-line consensus** (both fabricated citations as `likely_hallucination` with conf ≥0.85) and a **3rd partially via the agent-disagreement badge** (Germany — Prosecutor returned `contradicted` citing Fraunhofer ISE, but the consensus diluted to `unverified_plausible`). The IRA-2021 claim was caught only by the Literalist and missed at consensus level — see the "Strict date/year verification can be outvoted" limitation above. **No false-positive `contradicted` or `likely_hallucination` verdicts on the 4 uncontroversial facts** (IEA 510 GW, China >200 GW, $139/kWh lithium-ion, IEA 90% capacity expansion). On the secondary fixture `test-docs/us-economy-conservative-view.md` (a partisan opinion piece interleaving real and near-real statistics), the extractor cleanly skipped every rhetorical / interpretive sentence and pulled only numerical claims (15 of 25 cap, all `type: "numerical"`), and **13 of 15 claims came back with `agents_disagreed=True`** — partisan-flavored numbers consistently triggered Prosecutor/Literalist skepticism that the Defender pushed back against. We read this as signal, not noise: contested figures are surfaced via the disagreement badge rather than flattened into a verdict-of-convenience. The fabricated-style "Tax Foundation Hendricks and Walsh (2023)" citation was caught at top-line as `likely_hallucination` (conf 0.82); two other real-organization citations with hard-to-verify specific figures landed at `unverified_plausible` with Prosecutor `likely_hallucination` dissents.

---

## Empirical model comparison

Three efficient-tier chat models — OpenAI `gpt-4o`, Anthropic `claude-haiku-4-5`, Google `gemini-2.5-flash` — were each prompted with the same 15 prompts spread across five categories (`fabricated-citation`, `specific-fact`, `contested-claim`, `compound-claim`, `open-research`; 3 prompts each). Every response was audited by the fixed OpenAI auditor pipeline (extractor + 3 verifier subagents on `gpt-4o-mini`). The hallucination rate reports `(contradicted + likely_hallucination) / total_claims` per provider per category. Full per-prompt detail and raw response text are committed at `eval/results.md` and `eval/results.json`.

**Coverage disclosure.** Gemini exhausted its free-tier daily quota (20 requests/day on `gemini-2.5-flash`) mid-run. 7 of 15 Gemini cells failed — specifically all 3 `compound-claim` cells, all 3 `open-research` cells, and the third `contested-claim` cell. Gemini results below cover only the 8 cells that completed before the quota wall; full-coverage cross-provider comparison is between OpenAI and Anthropic. The errored cells are preserved in `eval/results.json` with their full SDK error payloads for transparency.

| Category | Provider | Claims | Hallucination rate |
|---|---|---|---|
| fabricated-citation | OpenAI gpt-4o | 5 | 20.0% |
| fabricated-citation | Gemini 2.5 Flash | 10 | 40.0% |
| fabricated-citation | Anthropic Haiku 4.5 | 6 | 33.3% |
| specific-fact | OpenAI gpt-4o | 5 | 0.0% |
| specific-fact | Gemini 2.5 Flash | 5 | 0.0% |
| specific-fact | Anthropic Haiku 4.5 | 9 | 0.0% |
| contested-claim | OpenAI gpt-4o | 5 | 20.0% |
| contested-claim | Gemini 2.5 Flash | 11 | 27.3% |
| contested-claim | Anthropic Haiku 4.5 | 21 | 4.8% |
| compound-claim | OpenAI gpt-4o | 16 | 0.0% |
| compound-claim | Gemini 2.5 Flash | —† | —† |
| compound-claim | Anthropic Haiku 4.5 | 13 | 0.0% |
| open-research | OpenAI gpt-4o | 23 | 4.3% |
| open-research | Gemini 2.5 Flash | —† | —† |
| open-research | Anthropic Haiku 4.5 | 25 | 4.0% |

† Insufficient data — provider quota exhausted; see coverage disclosure above.

**Qualitative findings.** Four observations the headline rates don't capture on their own:

1. *`specific-fact` was 0% across all three providers.* Every JWST-launch-date / Marie-Curie / Fahrenheit claim verified cleanly. This is the strongest signal in the run that the auditor pipeline is reliable when ground truth is unambiguous — a 0% rate where the extractor pulled 5–9 claims per provider is hard to fake.

2. *Refusal vs. fabrication on impossible-to-verify prompts is invisible to the rate metric.* On `cite-02` and `cite-03` (a fictitious 2024 Ramirez & Okonkwo paper and a chronologically-impossible "MIT 2022 longitudinal ChatGPT study"), OpenAI explicitly refused — *"I'm sorry, but I can't provide details on specific papers published after my last update…"* — producing 0 atomic claims and therefore an undefined per-prompt hallucination rate. Anthropic hedged ("I don't have access to specific details…") but still produced 1 atomic claim per prompt. Gemini fabricated confidently in both cases. This epistemic-behavior axis is visible only by reading the per-prompt claim counts and response text in `eval/results.md`, not in the headline rates.

3. *Anthropic's low rates partly reflect verbose hedging, not fewer real errors.* Anthropic produced 74 total atomic claims (vs OpenAI's 54, vs Gemini's 26 across 8 cells) by responding in bulleted multi-section format. Many were "some studies show X, others show Y" claims that pile up in `unverified_plausible` (27 of its 74). The result is a deflated per-claim hallucination rate even where the underlying epistemic behavior is similar to OpenAI's. **`specific-fact` and `compound-claim` are the fairest cross-provider comparisons** — both reward atomic correctness and don't reward hedging volume.

4. *Gemini's `cite-03` response was the second observed case of "consensus verifies a fabrication when Tavily returns adjacent-topic sources."* The first was the IRA-2021 claim in the Phase A renewable-energy document, documented under "Strict date/year verification can be outvoted" above. On `cite-03`, Gemini produced 3 claims about a non-existent MIT longitudinal study; the Defender agent took generic ChatGPT-in-education sources (which exist) as supporting the specific fabricated study, and majority vote landed on a false-verified verdict. This is a documented auditor limit, not a Gemini-specific one — the same trap would catch any provider that fabricates near a real research area.

**Methodology.** The eval compares `gpt-4o` vs `claude-haiku-4-5` vs `gemini-2.5-flash` — a consistent efficient-tier comparison chosen for rate-limit reliability and per-token cost, since the eval issues hundreds of upstream calls. Results are suggestive, not a ranking of flagship models.

---

## Future work

- Auditor diversity: mix GPT, Gemini, and Claude across subagents
- Precision/recall evaluation on a labeled set of seeded hallucinations
- Persist audit logs for longitudinal comparison between providers
- Per-claim surgical rewrite (fix one claim in place, leave the rest)