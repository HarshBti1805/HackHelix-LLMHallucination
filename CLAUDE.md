# CLAUDE.md

Guidance for Claude / Cursor when working in this repository. Read this before making changes.

---

## What this project is

A single Next.js 14 + TypeScript app (App Router) that implements a multi-agent hallucination auditor for LLM chat responses. See `README.md` for the product description, `ARCHITECTURE.md` for the full technical design (data flow, type contracts, module specs, API schemas), and `PROJECT_PLAN.md` for the 3-hour build schedule.

**Before making any change that crosses module boundaries or touches type contracts, read the relevant section of `ARCHITECTURE.md`.**

**It is not a monorepo.** One `package.json`, one repo, one app. Frontend (React components) lives in `app/`, backend logic lives in `app/api/*/route.ts` and `lib/`. They share types from `types.ts`.

---

## Core architectural rules

These are non-negotiable. Do not "refactor" them away.

1. **Separation of roles.** Three distinct LLM responsibilities, never collapsed into one call:
   - **Chat model** — the thing being audited. User-selectable (OpenAI or Gemini).
   - **Extractor** — pulls atomic claims from an assistant response. OpenAI `gpt-4o-mini`, JSON mode.
   - **Verifier subagents** — verify claims against evidence. OpenAI `gpt-4o-mini`, JSON mode, three agents run in parallel per claim.

2. **Auditor provider is fixed.** All extraction and verification uses OpenAI `gpt-4o-mini`. This is deliberate: we are measuring the chat model's hallucination rate, and varying the auditor would confound the comparison. Do not add Gemini or Claude to the auditor path.

3. **Subagents run in parallel, never sequentially.** Use `Promise.all`. Subagents must not see each other's outputs — independence is what makes consensus meaningful.

4. **Every LLM call returns structured JSON.** Use OpenAI's `response_format: { type: "json_object" }` or `json_schema` where supported. Never parse free text with regex. If a call returns malformed JSON, catch, log, and return a sentinel result — do not retry indefinitely.

5. **Evidence is gathered once, reused everywhere.** When a subagent searches and finds evidence, that evidence is attached to the claim audit object and available to the dehallucinator. Do not re-search in `/api/dehallucinate`.

6. **In-memory state only.** No database, no Redis, no persistence. Conversation history and audit results live in React state on the client, passed back to API routes as needed.

---

## File responsibilities

| File | Does | Does NOT |
|---|---|---|
| `app/page.tsx` | Chat UI, audit panel, provider switcher, dehallucinate button | Call LLM APIs directly |
| `app/api/chat/route.ts` | Route to OpenAI or Gemini based on `provider` field in request | Extract claims, verify, or audit |
| `app/api/audit/route.ts` | Orchestrate extract → parallel verify → aggregate | Talk to the chat model |
| `app/api/dehallucinate/route.ts` | Build grounded rewrite prompt from audit + evidence | Actually send the rewrite (client does that via `/api/chat`) |
| `lib/providers/openai.ts` | OpenAI chat wrapper | Any auditor logic |
| `lib/providers/gemini.ts` | Gemini chat wrapper | Any auditor logic |
| `lib/extract.ts` | Claim extraction LLM call | Verification or search |
| `lib/agents.ts` | Define 3 subagent roles; run them in parallel per claim | Extraction or aggregation |
| `lib/search.ts` | Tavily wrapper with optional domain scoping | Any LLM logic |
| `lib/aggregate.ts` | Combine 3 agent reports into a ClaimAudit; compute agreement score | Make LLM or search calls |
| `lib/dehallucinate.ts` | Build the rewrite prompt string from state | Send it |
| `lib/cache.ts` | Optional file-based cache for dev (keyed by input hash) | Be used in production |
| `types.ts` | Shared TypeScript types | Contain any logic |

---

## Type contracts (keep stable)

```ts
type Provider = "openai" | "gemini";

type ClaimType = "numerical" | "entity" | "citation";

interface Claim {
  id: string;
  text: string;              // the claim as stated in the response
  sentence: string;          // the original sentence it came from
  type: ClaimType;
  entities: string[];        // key nouns/numbers for search
}

type Verdict =
  | "verified"
  | "unverified_plausible"
  | "contradicted"
  | "likely_hallucination";

interface AgentReport {
  agent_role: "prosecutor" | "defender" | "literalist";
  verdict: Verdict;
  confidence: number;        // 0..1
  reasoning: string;         // one-paragraph
  sources: { url: string; title: string; snippet: string }[];
}

interface ClaimAudit {
  claim: Claim;
  consensus_verdict: Verdict;
  consensus_confidence: number;     // averaged
  agreement_score: number;          // 0..1, how much agents agreed
  agents_disagreed: boolean;        // derived flag for UI
  per_agent_reports: AgentReport[];
}

interface MessageAudit {
  message_id: string;
  claims: ClaimAudit[];
  summary: {
    total_claims: number;
    verified: number;
    unverified_plausible: number;
    contradicted: number;
    likely_hallucination: number;
  };
}
```

Before editing these, check every file that imports from `types.ts`.

---

## Prompt design guidance

Prompts are 80% of this project's quality. When editing them:

- Keep them in `lib/` files as exported constants (`EXTRACTOR_PROMPT`, `PROSECUTOR_PROMPT`, etc.), not inline in API routes.
- Each subagent prompt must clearly state its role and reasoning stance. "Prosecutor" should actually be skeptical; "Defender" should actually try to steelman. If two agents produce similar-sounding reasoning, the prompts are too close — fix the prompts, don't add more agents.
- Always tell the model: "If you do not have sufficient evidence, return `unverified_plausible`, not `verified`." Models over-claim verification otherwise.
- Always tell the extractor: "Do not extract opinions, definitions, or predictions. Only extract claims that could be checked against an external source."
- The dehallucinator prompt must explicitly forbid invented citations and must require the model to abstain when uncertain.

---

## Rules for doing work in this repo

**Do:**
- Read `PROJECT_PLAN.md` before starting a new task. Tasks are ordered deliberately.
- Build end-to-end before adding features. A working ugly pipeline beats three half-built pretty ones.
- Commit after every working step. Small, frequent commits.
- Test each LLM call in isolation (e.g., via a temporary script) before wiring it into the pipeline.
- Cache LLM and search responses to disk during development — you will re-run the same inputs dozens of times.
- Use structured outputs on every LLM call. Full stop.

**Don't:**
- Don't introduce a vector database, Redis, Postgres, or any persistence layer.
- Don't convert this into a monorepo or split frontend/backend into separate services.
- Don't add a fourth subagent without a clear new role. Three is the target.
- Don't let subagents see each other's outputs.
- Don't chain "fixes" when a test fails. If a fix doesn't work the first time, re-read the code — the bug is probably architectural, not local.
- Don't auto-send the dehallucinate prompt. User must review and edit first.
- Don't skip writing an entry in `PROJECT_PLAN.md`'s "status" section when a task completes.

---

## When tests or runs fail

1. Read the actual error. Do not guess.
2. Check the last LLM call's raw output — usually the problem is malformed JSON or an unexpected verdict string.
3. If multiple components are failing at once, `git diff` and consider reverting. Something got broken silently.
4. When stuck for more than 10 minutes on the same bug, stop and re-read the relevant file top-to-bottom. Don't keep patching.

---

## Demo priorities (what must work for the demo)

In order of importance:

1. **A prompt that reliably triggers a hallucination** — e.g., "Summarize the findings of Johnson et al. 2021 on intermittent fasting." The model will fabricate a citation. The auditor must catch it.
2. **Visible agent disagreement** — at least one demo claim should show the 3 subagents returning different verdicts. This is the most interesting thing the system does.
3. **Dehallucinate loop** — click button → see generated prompt → edit → send → new response is measurably cleaner in the re-audit.
4. **Provider comparison** — same prompt through OpenAI and Gemini, side-by-side audit results. This can be a saved screenshot in the README if it's not working live.

If the demo is in trouble, cut in reverse order: drop (4) first, then (3). Never cut (1) or (2).