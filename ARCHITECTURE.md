# ARCHITECTURE.md

Detailed technical architecture for the Hallucination Audit Trail. This file is the source of truth for how the system is structured. Cursor and any future contributor should read this before making changes that cross module boundaries.

For the product description, see `README.md`. For rules about how to edit this codebase, see `CLAUDE.md`. For the build order, see `PROJECT_PLAN.md`.

---

## 1. System overview

A Next.js 14 + TypeScript application (App Router, single repo, single `package.json`). The UI lives in `app/`; backend logic lives in `app/api/*/route.ts` and is supported by pure-ish modules in `lib/`. State is held entirely on the client — API routes are stateless.

Three distinct LLM responsibilities:

| Responsibility | Provider | Model | Output |
|---|---|---|---|
| **Chat** (the model being audited) | OpenAI *or* Gemini (user-selectable) | `gpt-4o` / `gemini-1.5-pro` | Free-form text |
| **Claim extraction** | OpenAI (fixed) | `gpt-4o-mini` | JSON (`Claim[]`) |
| **Claim verification** (3 subagents) | OpenAI (fixed) | `gpt-4o-mini` | JSON (`AgentReport`) |
| **Dehallucinate prompt builder** | OpenAI (fixed) | `gpt-4o-mini` | JSON (`{ suggested_prompt }`) |

Auditor is held constant to keep the chat-model comparison clean. If the auditor varied by provider, we'd be measuring auditor variance, not chat-model hallucination.

---

## 2. Directory layout

```
hallucination-audit/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                    # single-page UI: chat + audit panel
│   ├── globals.css
│   └── api/
│       ├── chat/
│       │   └── route.ts            # POST: dispatch to OpenAI or Gemini
│       ├── audit/
│       │   └── route.ts            # POST: extract → verify (parallel) → aggregate
│       └── dehallucinate/
│           └── route.ts            # POST: build grounded rewrite prompt
├── lib/
│   ├── providers/
│   │   ├── openai.ts               # chat wrapper + shared client
│   │   └── gemini.ts               # chat wrapper
│   ├── extract.ts                  # claim extraction
│   ├── agents.ts                   # 3 subagent roles + parallel runner
│   ├── search.ts                   # Tavily wrapper
│   ├── aggregate.ts                # consensus + agreement math
│   ├── dehallucinate.ts            # rewrite prompt construction
│   ├── cache.ts                    # dev-only file cache (SHA-keyed)
│   └── prompts/                    # prompt constants, one file per role
│       ├── extractor.ts
│       ├── prosecutor.ts
│       ├── defender.ts
│       ├── literalist.ts
│       └── dehallucinator.ts
├── types.ts                        # all shared types
├── .env.example
├── .env.local                      # (gitignored)
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── README.md
├── CLAUDE.md
├── ARCHITECTURE.md
└── PROJECT_PLAN.md
```

**Rules about the layout:**

- Prompts live in `lib/prompts/` as exported string constants. Never inline prompts in API routes or agent logic.
- `lib/` modules are pure: they take inputs, call external APIs, return outputs. They do not read from React state or Next.js request objects.
- API routes are thin: parse request body, call `lib/` functions, return JSON. No business logic in routes.
- Types are centralized in `types.ts`. Do not redefine `Claim` or `Verdict` inside feature modules.

---

## 3. Data model

```ts
// types.ts

export type Provider = "openai" | "gemini";

export type ChatModel =
  | "gpt-4o"
  | "gpt-4o-mini"
  | "gemini-1.5-pro"
  | "gemini-1.5-flash";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  provider?: Provider;      // set on assistant messages, for comparison
  model?: ChatModel;
  timestamp: number;
}

// ---- Claims and audits ----

export type ClaimType = "numerical" | "entity" | "citation";

export interface Claim {
  id: string;               // stable within a message's audit
  text: string;             // canonical claim statement
  sentence: string;         // source sentence verbatim from assistant response
  type: ClaimType;
  entities: string[];       // key nouns/numbers/dates for search
}

export type Verdict =
  | "verified"
  | "unverified_plausible"
  | "contradicted"
  | "likely_hallucination";

export interface EvidenceSource {
  url: string;
  title: string;
  snippet: string;
  domain: string;           // extracted for display + scoping
}

export type AgentRole = "prosecutor" | "defender" | "literalist";

export interface AgentReport {
  agent_role: AgentRole;
  verdict: Verdict;
  confidence: number;       // 0..1
  reasoning: string;        // one-paragraph rationale
  sources: EvidenceSource[];// what this agent actually saw
}

export interface ClaimAudit {
  claim: Claim;
  consensus_verdict: Verdict;
  consensus_confidence: number;
  agreement_score: number;  // 0..1
  agents_disagreed: boolean;
  per_agent_reports: AgentReport[];
}

export interface MessageAudit {
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

**Stability contract:** these types are imported everywhere. Before changing a field name or verdict string, check every file that imports from `types.ts`. Adding new fields is cheap; renaming is expensive.

---

## 4. Data flow — single chat turn

```
┌─────────────────────────────────────────────────────────────────┐
│ CLIENT (app/page.tsx)                                           │
│                                                                 │
│  user types → [Send]                                            │
│                                                                 │
│    POST /api/chat                                               │
│    body: { messages, provider, model }                          │
│                ↓                                                │
└────────────────┼────────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────────┐
│ SERVER /api/chat/route.ts                                       │
│                                                                 │
│  switch (provider):                                             │
│    openai → lib/providers/openai.ts  → OpenAI API               │
│    gemini → lib/providers/gemini.ts  → Google GenAI API         │
│                                                                 │
│  returns: { message: ChatMessage }                              │
└────────────────┬────────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────────┐
│ CLIENT                                                          │
│                                                                 │
│  renders assistant message immediately                          │
│                                                                 │
│  fires (non-blocking):                                          │
│    POST /api/audit                                              │
│    body: { message_id, content }                                │
└────────────────┬────────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────────┐
│ SERVER /api/audit/route.ts                                      │
│                                                                 │
│  1. extract.ts                                                  │
│       OpenAI JSON call → Claim[] (cap at 6)                     │
│                                                                 │
│  2. for each claim, in parallel:                                │
│       agents.ts verifyClaim(claim)                              │
│         ├─ Promise.all([                                        │
│         │    runAgent(claim, "prosecutor"),                     │
│         │    runAgent(claim, "defender"),                       │
│         │    runAgent(claim, "literalist"),                     │
│         │  ])                                                   │
│         │                                                       │
│         │  each runAgent:                                       │
│         │    1. search.ts (scoped domains for literalist)       │
│         │    2. OpenAI JSON call with role prompt + evidence    │
│         │    3. returns AgentReport                             │
│         │                                                       │
│         └─ aggregate.ts combine(reports) → ClaimAudit           │
│                                                                 │
│  3. build MessageAudit summary                                  │
│                                                                 │
│  returns: MessageAudit                                          │
└────────────────┬────────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────────┐
│ CLIENT                                                          │
│                                                                 │
│  stores audit in state keyed by message_id                      │
│  renders claims panel below assistant message                   │
│    - color per verdict                                          │
│    - ⚠ badge if agents_disagreed                                │
│    - click claim → expand per-agent reports                     │
└─────────────────────────────────────────────────────────────────┘
```

**Parallelism requirements:**

- The 3 subagents for a single claim run in parallel (`Promise.all`).
- Claims within a message run in parallel (another `Promise.all`, enclosing the subagent one).
- Practical ceiling: 6 claims × 3 agents = 18 concurrent OpenAI calls per message. OpenAI's default rate limits handle this; if you see 429s, add a simple concurrency limiter.

---

## 5. Module specifications

### 5.1 `lib/providers/openai.ts`

Exports:

```ts
export async function openaiChat(
  messages: { role: "user" | "assistant" | "system"; content: string }[],
  model: "gpt-4o" | "gpt-4o-mini",
): Promise<string>;

export async function openaiJson<T>(
  systemPrompt: string,
  userPrompt: string,
  model?: "gpt-4o-mini",
): Promise<T>;  // uses response_format: { type: "json_object" }
```

`openaiJson` is the workhorse for extraction and verification. It must throw on malformed JSON, never silently return partial data.

### 5.2 `lib/providers/gemini.ts`

Exports:

```ts
export async function geminiChat(
  messages: { role: "user" | "assistant"; content: string }[],
  model: "gemini-1.5-pro" | "gemini-1.5-flash",
): Promise<string>;
```

Gemini-specific notes:
- Gemini uses `"model"` as the assistant role; normalize in this wrapper.
- Gemini's SDK separates system instructions from messages; if needed, extract and pass via `systemInstruction`.
- Only exposes chat. No JSON-mode variant — Gemini is never used by the auditor.

### 5.3 `lib/search.ts`

Exports:

```ts
export async function search(
  query: string,
  opts?: { includeDomains?: string[]; maxResults?: number },
): Promise<EvidenceSource[]>;
```

- Wraps Tavily's `/search` endpoint.
- `includeDomains` maps to Tavily's `include_domains` parameter; used by the Literalist agent to constrain to high-trust sources.
- Extracts `domain` from `url` for display.
- Caches via `lib/cache.ts` when `NODE_ENV !== "production"`.

### 5.4 `lib/extract.ts`

Exports:

```ts
export async function extractClaims(
  assistantText: string,
): Promise<Claim[]>;
```

- Single OpenAI JSON call using `EXTRACTOR_PROMPT` from `lib/prompts/extractor.ts`.
- Must filter out opinions, predictions, definitions, hedged statements.
- Must produce atomic claims: "X grew 23% in 2023 per McKinsey" is two claims, not one.
- Caller is responsible for capping the list length (e.g., `.slice(0, 6)`).

### 5.5 `lib/agents.ts`

Exports:

```ts
export async function runAgent(
  claim: Claim,
  role: AgentRole,
): Promise<AgentReport>;

export async function verifyClaim(
  claim: Claim,
): Promise<ClaimAudit>;  // runs all 3 in parallel, then aggregates
```

Agent roles:

| Role | Prompt stance | Search scope |
|---|---|---|
| **Prosecutor** | Adversarial. Actively searches for disconfirming evidence. Defaults to skepticism when evidence is thin. | General web (no domain filter) |
| **Defender** | Charitable. Steelmans the claim. Looks for corroborating evidence. Defaults to `unverified_plausible` when evidence is thin, not `verified`. | General web (no domain filter) |
| **Literalist** | Strict. Checks wording exactly as stated — dates, numbers, names must match sources verbatim. | High-trust domains only: `wikipedia.org`, `nature.com`, `arxiv.org`, `*.gov`, `semanticscholar.org`, etc. Configurable in `lib/agents.ts` as `LITERALIST_DOMAINS`. |

**Design rule:** the three agents must produce meaningfully different outputs on ambiguous claims. If they always agree, the prompts are too similar. This is the main thing to iterate on during development.

### 5.6 `lib/aggregate.ts`

Exports:

```ts
export function aggregate(
  claim: Claim,
  reports: AgentReport[],
): ClaimAudit;
```

Rules:

- **Consensus verdict:** majority vote across the 3 agents. Ties broken by the most severe verdict (`likely_hallucination` > `contradicted` > `unverified_plausible` > `verified`). This biases toward caution — a 1-1-1 split surfaces as the more alarming label, with `agents_disagreed: true`.
- **Consensus confidence:** mean of per-agent confidences.
- **Agreement score:** `1 - (distinctVerdicts - 1) / 2`. All same → 1.0. Two distinct → 0.5. Three distinct → 0.0.
- **agents_disagreed:** `true` when `distinctVerdicts > 1`.

This module is pure — no I/O, no async. Unit-testable in isolation.

### 5.7 `lib/dehallucinate.ts`

Exports:

```ts
export async function buildDehallucinatePrompt(input: {
  originalUserMessage: string;
  flawedResponse: string;
  audit: MessageAudit;
}): Promise<{ suggested_prompt: string }>;
```

- Collects failed claims (`contradicted` or `likely_hallucination`) and their aggregated evidence.
- Dedupes sources across agents per claim.
- Sends to OpenAI with `DEHALLUCINATOR_PROMPT`.
- Returns a suggested rewrite prompt for the user to review and edit.
- Does NOT send the rewrite; the client opens a modal with the suggestion and reuses `/api/chat` when the user confirms.

### 5.8 `lib/cache.ts`

File-based cache keyed by SHA-256 of the input. Dev-mode only. Implementation:

```
/tmp/halluc-cache/<sha256-of-input>.json
```

Wraps any async `(input: T) => Promise<R>` into a cached version. Used for `search` and all LLM calls during development. Disabled automatically in production to avoid stale results.

---

## 6. API contracts

### POST `/api/chat`

Request:
```json
{
  "messages": [{ "role": "user", "content": "..." }],
  "provider": "openai" | "gemini",
  "model": "gpt-4o" | "gpt-4o-mini" | "gemini-1.5-pro" | "gemini-1.5-flash"
}
```

Response:
```json
{ "message": ChatMessage }
```

### POST `/api/audit`

Request:
```json
{ "message_id": "msg_abc", "content": "the full assistant response text" }
```

Response:
```json
MessageAudit
```

### POST `/api/dehallucinate`

Request:
```json
{
  "originalUserMessage": "...",
  "flawedResponse": "...",
  "audit": MessageAudit
}
```

Response:
```json
{ "suggested_prompt": "..." }
```

---

## 7. Client state shape

Single page, useReducer-style state (use a plain `useState` with a typed object; don't reach for Redux):

```ts
interface AppState {
  provider: Provider;
  model: ChatModel;
  messages: ChatMessage[];
  audits: Record<string, MessageAudit>;   // keyed by message_id
  pendingAudits: Set<string>;             // message_ids currently being audited
  dehallucinateModal: {
    open: boolean;
    messageId: string | null;
    suggestedPrompt: string | null;
    editedPrompt: string;
  };
}
```

Audits are fetched non-blocking after each assistant message appears. The message renders immediately; its audit panel shows a skeleton until the audit resolves.

---

## 8. Prompt architecture

Prompts are the highest-leverage code in this project. They live in `lib/prompts/`, one file per role, each exporting a single string constant.

Required elements for every prompt:

- **Role statement** — one sentence, concrete.
- **Task statement** — what to produce.
- **Output schema** — inline JSON example with all fields.
- **Abstention clause** — explicit permission to return `unverified_plausible` or "I don't know."
- **Anti-fabrication clause** — for the dehallucinator and extractor, explicit prohibition on inventing citations or facts.

Prompts should be edited frequently during hour 1:00–1:45 of the build. The prompts shipped at scaffold time are starting points, not final versions.

---

## 9. Concurrency, caching, and cost

**Per-message worst case:**
- 1 extraction call
- Up to 6 claims × 3 agents × (1 search + 1 LLM call) = 18 searches + 18 LLM calls
- Plus the original chat call

At `gpt-4o-mini` rates, this is cents per message. Acceptable for demo. Tavily free tier limits: respect them during development by using the cache aggressively.

**Caching strategy:**
- Dev: everything cached to disk by input hash.
- Production (if ever deployed): disable cache for searches (freshness matters for fact-checking); keep cache for LLM calls if desired.

**Rate-limit guard:**
- If OpenAI returns 429, retry once with 2s backoff. After that, return a partial audit with an error flag on the affected claim. Never block the UI indefinitely.

---

## 10. Error handling philosophy

- **API routes:** return `{ error: string, partial?: PartialResult }` on failure. Never 500 without a message.
- **lib/ functions:** throw typed errors. API routes catch and serialize.
- **LLM JSON parsing:** on malformed JSON, throw `MalformedLLMJsonError` with the raw response attached. Do not silently default values.
- **Search failures:** return `[]`. An agent with no evidence should produce `unverified_plausible` with low confidence, not crash.
- **Client:** render a small error banner per affected message. Keep the chat usable.

---

## 11. What this architecture deliberately excludes

- No database. No Redis. No persistence layer.
- No authentication. Local dev only; if deployed, front with basic auth on the hosting provider.
- No streaming. Chat responses arrive in full. Adding SSE streaming is future work and should not block the demo.
- No vector DB, no embeddings, no RAG. "Retrieval" here means Tavily web search per claim.
- No multi-user or collaboration features.
- No observability stack. `console.log` is fine for a 3-hour build.

Anything in this list should not be added without a corresponding update to `PROJECT_PLAN.md` and `CLAUDE.md`.

---

## 12. Extension points (future work)

Designed-in seams where later contributors can extend cleanly:

- **New agent role:** add a file under `lib/prompts/`, add the role to `AgentRole`, extend `verifyClaim` to include it. Aggregate formula generalizes to N agents.
- **New provider:** add `lib/providers/<name>.ts`, extend `Provider` union, add a case in `/api/chat`.
- **Provider-diverse auditor:** swap `openaiJson` inside `runAgent` for a provider chosen per agent role. Acknowledge this weakens the chat-model comparison.
- **Persistence:** introduce a `lib/storage.ts` module and swap client in-memory state for it. The type contracts don't need to change.