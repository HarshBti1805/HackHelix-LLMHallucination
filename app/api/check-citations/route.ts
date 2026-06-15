import { NextRequest, NextResponse } from "next/server";
import { checkCitations } from "@/lib/citations";
import {
  MalformedLLMJsonError,
  type CheckCitationsRequestBody,
} from "@/types";

/**
 * POST /api/check-citations  (MAJOR_CHANGES.md #8 — citation/reference checker)
 *
 * Thin HTTP wrapper around `lib/citations.checkCitations`. Extracts scholarly
 * references from `text` and verifies each against Crossref + Semantic Scholar.
 *
 * Request shape (`CheckCitationsRequestBody`):  { text: string }
 * Response shape:  CitationReport  |  { error: string }
 */

export const maxDuration = 60;
export const runtime = "nodejs";

const MAX_CHARS = 200_000;

export async function POST(req: NextRequest) {
  let body: CheckCitationsRequestBody;
  try {
    body = (await req.json()) as CheckCitationsRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Request body is not valid JSON." },
      { status: 400 },
    );
  }

  const { text } = body;
  if (typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json(
      { error: "`text` must be a non-empty string." },
      { status: 400 },
    );
  }
  if (text.length > MAX_CHARS) {
    return NextResponse.json(
      { error: `Text too long: ${text.length} chars (max ${MAX_CHARS}).` },
      { status: 413 },
    );
  }

  try {
    const report = await checkCitations(text);
    return NextResponse.json(report);
  } catch (err) {
    if (err instanceof MalformedLLMJsonError) {
      console.error("[/api/check-citations] malformed LLM JSON:", err.message);
      return NextResponse.json(
        { error: `Auditor LLM returned malformed JSON: ${err.message}` },
        { status: 502 },
      );
    }
    const message =
      err instanceof Error ? err.message : "Unknown citation-check error.";
    console.error("[/api/check-citations] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
