A. Meet users where they work (distribution)
1. Browser extension that audits ChatGPT / Claude / Gemini in their native web UIs. This is your headline idea and the biggest reach unlock. A content script scrapes each new assistant message from chat.openai.com, claude.ai, and gemini.google.com, sends the text to your existing /api/audit (hosted), and overlays verdict highlights + a side panel inline. The key architectural win: your auditor is already provider-agnostic and text-only (PROJECT_PLAN 5.5 / B.5 confirm "the audit sees only response text, not provenance"), so no per-provider auditor logic is needed — you only need per-site DOM adapters. Ship the dehallucinate button as a "copy grounded re-prompt to clipboard" action since you can't call their APIs.

2. "Independent re-derivation" verdict mode (your stronger-catch idea). Right now a claim is judged against retrieved evidence. Add a second, orthogonal signal: take the user's original prompt and have the auditor independently answer it from scratch (locked auditor, no access to the chat model's response), then compare the chat model's claims against the auditor's independent answer. Divergence between "what the model said" and "what an independent model + search concludes" is a powerful hallucination signal that doesn't depend on Tavily finding the exact claim. This fits cleanly as a fourth signal feeding aggregate.ts without breaking the 3-subagent rule (it's a pre-step, not a 4th verifier).

3. VS Code / Cursor extension and a CLI. Audit AI-generated text in docs, PRDs, commit messages, or docstrings. You already have scripts/eval.ts proving the pipeline runs headless via tsx — wrap auditDocument in a npx groundtruth audit <file> CLI and a thin VS Code command. Low effort, high "use it while working" value.

B. Make it a real product surface (depth)
4. Public hosted API + API keys. Expose /api/audit and /api/audit-document as a documented, authenticated service so the extension, CLI, and third parties all consume one backend. This is the prerequisite that makes 1, 3, and 9 possible. Requires the first real departure from "in-memory only" (you'll need at least API-key storage) — call it out explicitly against CLAUDE.md.

5. Streaming + incremental audit results. ARCHITECTURE §11 lists streaming as deferred, and README currently claims responses "stream back" while the code does plain await — so this both fixes a doc inconsistency and improves UX. Stream the chat reply, then stream claim verdicts in as each Promise.all resolves rather than waiting for the whole MessageAudit. For a 6-claim, 18-call message this is the difference between "feels broken" and "feels alive."

6. Persistent audit history + shareable report links. A lightweight store (the one persistence exception worth making) so users can revisit audits, build a personal "hallucination log," and share a read-only report URL. Pairs naturally with the document path — audited docs become permalinks you can send to a reviewer.

7. Source quality & trust scoring upgrade. Today Tavily results "vary in quality" (README known limitation) and the Literalist leans on a hardcoded domain list. Add a per-source credibility score (domain reputation, primary-vs-secondary, recency) and surface it in the UI. This directly attacks your two most-documented failure modes: adjacent-topic false-verifies and noisy search.

C. New use cases / verticals (where this assists)
8. Citation & reference checker for researchers/students. Your single most reliable behavior is catching fabricated citations (caught cleanly across Phase A and B). Lean into it: a mode that takes a bibliography or a draft with inline citations and verifies each reference actually exists (cross-check Crossref / Semantic Scholar / arXiv, not just Tavily). This is a sharply-defined, high-demand niche where you already win.

9. Journalism / fact-checking & compliance workspace. Newsrooms, legal, finance, and healthcare teams need to fact-check AI-drafted copy before publishing. The /document two-column highlight view is already the right interface — add team workflows: assign claims, mark "human-verified," export an audit trail. The eval harness becomes a selling point: "here's measured hallucination rates per model."

10. RAG / chatbot output guardrail (B2B SDK). Companies running their own LLM chatbots can pipe outputs through your auditor as a guardrail before showing them to end users. This is the most monetizable framing — sell the auditor as middleware. Add a "groundedness" mode that checks claims against the customer's own provided context/knowledge base instead of (or in addition to) web search.

11. Continuous model-comparison dashboard (productize the eval harness). Turn scripts/eval.ts + eval/results.md into a living leaderboard: scheduled runs across providers/models on a growing labeled prompt set, with per-category hallucination trends over time. This is genuinely useful content (people love model comparisons) and doubles as marketing. Fixes the current N=15 / uneven-Gemini-coverage caveats by growing the set.

12. "Confidence-aware" writing assistant / rewrite-in-place. Future-work item in your README ("per-claim surgical rewrite"). Instead of regenerating the whole response, let users accept fixes claim-by-claim: each flagged claim gets an inline suggestion grounded in the gathered evidence, applied in place. This is the natural evolution of the dehallucinate loop into an everyday editing tool.

Quick prioritization view
Highest leverage / signature feature: #1 (browser extension) + #2 (independent verdict) — exactly what you described, and your text-only auditor makes the extension unusually cheap to build.
Unlocks everything else: #4 (hosted API) and #5 (streaming).
Sharpest standalone product: #8 (citation checker) and #10 (RAG guardrail SDK).
Best marketing-as-feature: #11 (model-comparison dashboard).
A few of these cross lines CLAUDE.md currently forbids (persistence in #4/#6, the "no new auditor signal" spirit in #2). Those are fine to break deliberately, but they'd need a matching update to CLAUDE.md / ARCHITECTURE.md per your own sync rule.

Want me to go deeper on a specific subset? I can turn the ones you pick into a concrete, sequenced implementation plan.

---

## Implementation status

- [x] **#2 Independent re-derivation** — `lib/independent.ts` + `lib/prompts/independent.ts`. Wired into the shared audit pipeline (`lib/audit.ts`) as an opt-in pre/post-step (NOT a 4th subagent). The locked auditor answers the original prompt from scratch; each claim is cross-checked and verdicts escalate when the independent answer contradicts. Toggle in the chat header ("Cross-check", on by default); surfaced per-claim in `ClaimRow` (violet "Cross-check escalated" badge + detail panel).
- [x] **#10 RAG / chatbot output guardrail** — `lib/groundedness.ts` + `lib/prompts/groundedness.ts` + `POST /api/guardrail` + `/guardrail` page. Grades each claim in an answer for faithfulness to operator-provided context (no web search). New `GroundingVerdict` axis.
- [x] **#8 Citation & reference checker** — `lib/citations.ts` + `lib/bib.ts` (Crossref + Semantic Scholar) + `lib/prompts/citation.ts` + `POST /api/check-citations`. Extracts references and verifies each against structured scholarly indices; fabricated citations surface as "Not found". UI now lives on the combined `/verify` page (see #5).
- [x] **#9 Journalism / compliance review workspace** — `components/document/ReviewWorkspace.tsx` on the `/document` report. Assign reviewers, record human sign-off (verified / rejected / needs-review), leave notes, export a timestamped audit trail (JSON + CSV). In-memory per CLAUDE.md; the export is the durable artifact.

### Second batch (user-facing)

- [x] **#1 One-line TL;DR** — `auditHeadline()` in `components/audit/verdict.ts` + `components/audit/AuditHeadlineBar.tsx`. Pure/deterministic (no LLM call); rendered at the top of the chat audit panel, the `/document` report, and the `/verify` audit results. Phrasing + color adapt to the worst verdict present.
- [x] **#5 Audit a URL / webpage** — `lib/html-extract.ts` (dependency-free HTML→text) + `POST /api/fetch-url` (SSRF-guarded server fetch). Merged with the citation checker into one page: **`/verify`** — paste text or fetch a URL, then choose "Audit claims" (full multi-agent audit via `/api/audit-document`) or "Check citations". The standalone `/citations` page was removed; nav now links to **Verify**.
- [x] **#6 PDF + Word in Documents** — `POST /api/extract-file` (pdf-parse@1.1.1 for PDF, mammoth for .docx/.doc) wired into `DocumentDropzone`. PDFs/Word route through the server for text extraction; `.txt/.md` still parse client-side. Dropzone `accept` + labels updated.

Docs synced: `CLAUDE.md` file-responsibilities table + sanctioned-extensions note updated. Env (all optional): `CROSSREF_CONTACT_EMAIL`, `SEMANTIC_SCHOLAR_API_KEY`. New runtime deps: `mammoth`, `pdf-parse@1.1.1` (pinned — v2 pulls native `@napi-rs/canvas` and breaks bundling).
