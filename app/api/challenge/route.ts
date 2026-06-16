import { NextRequest, NextResponse } from "next/server";
import { challengeClaim } from "@/lib/challenge";
import {
  MalformedLLMJsonError,
  type ChallengeRequestBody,
} from "@/types";

/**
 * POST /api/challenge  (B1 — Challenge the verdict with your own source)
 *
 * Thin HTTP wrapper around `lib/challenge.challengeClaim`. Re-judges a single
 * claim against the reviewer's OWN pasted evidence — no web search (CLAUDE.md
 * rule 5), no mutation of the stored audit. Advisory result only.
 *
 * Request shape (`ChallengeRequestBody`):
 *   { claim_audit: ClaimAudit, user_evidence: string, source_url?: string }
 * Response shape:  ChallengeResponseBody  |  { error: string }
 */

export const maxDuration = 60;
export const runtime = "nodejs";

const MAX_EVIDENCE_CHARS = 20_000;

export async function POST(req: NextRequest) {
  let body: ChallengeRequestBody;
  try {
    body = (await req.json()) as ChallengeRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Request body is not valid JSON." },
      { status: 400 },
    );
  }

  const { claim_audit, user_evidence, source_url } = body;

  if (typeof user_evidence !== "string" || user_evidence.trim().length === 0) {
    return NextResponse.json(
      { error: "`user_evidence` must be a non-empty string." },
      { status: 400 },
    );
  }
  if (user_evidence.length > MAX_EVIDENCE_CHARS) {
    return NextResponse.json(
      {
        error: `Evidence too long (${user_evidence.length} chars, max ${MAX_EVIDENCE_CHARS}).`,
      },
      { status: 413 },
    );
  }
  if (
    !claim_audit ||
    typeof claim_audit !== "object" ||
    !claim_audit.claim ||
    !Array.isArray(claim_audit.per_agent_reports)
  ) {
    return NextResponse.json(
      { error: "`claim_audit` must be a valid ClaimAudit object." },
      { status: 400 },
    );
  }

  try {
    const result = await challengeClaim(
      claim_audit,
      user_evidence.trim(),
      typeof source_url === "string" && source_url.trim()
        ? source_url.trim()
        : undefined,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MalformedLLMJsonError) {
      console.error("[/api/challenge] malformed LLM JSON:", err.message);
      return NextResponse.json(
        { error: `Auditor LLM returned malformed JSON: ${err.message}` },
        { status: 502 },
      );
    }
    const message =
      err instanceof Error ? err.message : "Unknown challenge error.";
    console.error("[/api/challenge] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
