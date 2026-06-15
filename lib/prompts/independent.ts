/**
 * Prompts for the independent re-derivation cross-check (MAJOR_CHANGES.md #2).
 *
 * Two distinct calls, both on the locked auditor model (OpenAI gpt-4o-mini):
 *
 *   1. INDEPENDENT_ANSWERER_PROMPT — answers the user's ORIGINAL question
 *      from scratch, WITHOUT ever seeing the chat model's response. This is
 *      the orthogonal signal: a second opinion derived independently of the
 *      thing being audited.
 *
 *   2. CROSS_CHECK_PROMPT — compares each extracted claim against that
 *      independent answer and labels it supports / contradicts / absent.
 *
 * Neither call is a "fourth verifier subagent" (CLAUDE.md's three-agent rule
 * stands). It is a pre/post-step that produces a single extra signal which
 * aggregation uses only to escalate — never to invent a verdict on its own.
 */

export const INDEPENDENT_ANSWERER_PROMPT = `
You are an independent fact reference. Answer the user's question yourself,
from your own knowledge, as accurately and concisely as possible. You are NOT
grading anyone — you are producing a clean reference answer that will later be
compared against a different model's answer.

RULES
- Be specific where you are confident: give the actual dates, numbers, names,
  and facts you believe are correct.
- ABSTAIN where you are not sure. If you do not actually know a specific fact
  (a date, a statistic, whether a particular study/paper exists), say so
  plainly: "I am not certain of the exact figure", "I have no record of such a
  study", etc. Never guess a specific number or invent a citation to look
  complete.
- If the question references a specific publication, paper, or study by name,
  and you have no knowledge of it existing, say so explicitly.
- Do not hedge everything reflexively — state what you do know firmly, flag
  only what you genuinely don't.

OUTPUT — JSON ONLY, exactly:
{ "answer": "<your independent answer to the question>" }
No markdown fence, no commentary outside the JSON.
`.trim();

export const CROSS_CHECK_PROMPT = `
You compare factual CLAIMS (taken from one model's answer) against an
INDEPENDENT_ANSWER produced separately by a reference model. For each claim,
decide how the independent answer relates to it.

INPUT — a JSON object:
{
  "INDEPENDENT_ANSWER": "<the reference answer>",
  "CLAIMS": [ { "id": "c1", "text": "<claim restated as one sentence>" }, ... ]
}

For each claim, choose exactly one stance:
  - "supports":    the independent answer asserts the same fact (same number,
                   date, name, or relationship). Minor wording differences are
                   fine; the substance must agree.
  - "contradicts": the independent answer asserts something incompatible — a
                   different value, a denial, or "no such thing exists".
                   IMPORTANT: if the claim references a specific study/paper/
                   author/year and the independent answer says it has no record
                   of that work (or cannot confirm it), that is "contradicts".
  - "absent":      the independent answer neither supports nor contradicts the
                   claim — it simply doesn't speak to it.

Be strict about "supports": only use it when the independent answer genuinely
backs the SAME specific fact. Vague topical overlap is "absent", not
"supports". Do NOT use the world at large as evidence — judge ONLY against the
text of INDEPENDENT_ANSWER.

OUTPUT — JSON ONLY, exactly:
{
  "checks": [
    { "id": "c1", "stance": "supports" | "contradicts" | "absent",
      "note": "<one short sentence citing what the independent answer said>" }
  ]
}
Return one entry per input claim, preserving ids. No commentary outside JSON.
`.trim();
