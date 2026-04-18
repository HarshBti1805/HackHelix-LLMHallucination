# Hallucination Audit Trail

A chat interface that fact-checks LLM responses in real time using a multi-agent verification pipeline. Every factual claim in an AI-generated response is traced back to a verifiable source, and the system produces an audit report distinguishing verified claims, unverified-but-plausible claims, and likely hallucinations — each with a confidence score derived from independent subagent consensus.

The user can switch the **chat model** between **OpenAI (GPT-4o)** and **Google (Gemini 2.5 Flash)** to compare which one hallucinates less on the same prompt. The **auditor** is held constant (OpenAI `gpt-4o-mini`) so the comparison measures the chat model's behavior, not auditor variance.

When hallucinations are detected, the system can generate a grounded "dehallucinate" prompt that uses the evidence already gathered to regenerate a cleaner response.

---

## What it does

1. **Chat** — user picks a provider (OpenAI or Gemini) and talks to it. Responses stream back.
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
- **Google Generative AI SDK** (`@google/generative-ai`) — chat (user-selectable)
- **Tavily** — web search / evidence retrieval
- **Tailwind CSS** — styling
- In-memory state only (no database, no persistence across refreshes)

---

## Setup

```bash
npm install
cp .env.example .env.local
# Fill in OPENAI_API_KEY, GEMINI_API_KEY, TAVILY_API_KEY
npm run dev
```

Open http://localhost:3000.

### Required environment variables

| Variable | Where to get it |
|---|---|
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys |
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
│       ├── chat/route.ts           # routes to OpenAI or Gemini based on provider
│       ├── audit/route.ts          # orchestrates extract → verify (3 agents) → aggregate
│       └── dehallucinate/route.ts  # builds grounded rewrite prompt
├── lib/
│   ├── providers/
│   │   ├── openai.ts               # OpenAI chat wrapper
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
/api/chat  ──► OpenAI or Gemini (based on selected provider)
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

---

## Future work

- Auditor diversity: mix GPT, Gemini, and Claude across subagents
- Precision/recall evaluation on a labeled set of seeded hallucinations
- Persist audit logs for longitudinal comparison between providers
- Per-claim surgical rewrite (fix one claim in place, leave the rest)