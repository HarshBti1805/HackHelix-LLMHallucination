import { NextRequest, NextResponse } from "next/server";
import { buildDocumentRevisions } from "@/lib/dehallucinate-document";
import {
  MalformedLLMJsonError,
  type DehallucinateDocumentRequestBody,
  type DocumentAudit,
} from "@/types";

/**
 * POST /api/dehallucinate-document
 *
 * Sibling of /api/dehallucinate (chat path). Same error envelope and same
 * malformed-LLM-JSON → 502 mapping; only the underlying lib call differs:
 *
 *   Request:  { sourceText, filename, audit: DocumentAudit }
 *   Response: DocumentRevisions
 *               = { revisions: DocumentRevision[],
 *                   unrevisable_claims: { claim_id, reason }[] }
 *
 * Per the task spec this endpoint is *additive* — the chat
 * /api/dehallucinate route is left untouched because the chat
 * dehallucinator returns a single suggested prompt, while this one
 * returns surgical per-sentence replacements suitable for in-place
 * editing of a document. See `lib/dehallucinate-document.ts` for the
 * design rationale.
 */

// Same wall-clock budget as /api/dehallucinate. The dehallucinator does
// exactly one OpenAI JSON-mode call (CLAUDE.md core rule 6), so 60s is
// generous; the ceiling exists to avoid Vercel's default 10s truncation
// on cold caches.
export const maxDuration = 60;
export const runtime = "nodejs";

// Mirror the /api/audit-document ceiling: a request can include the full
// source text again, so we cap input size for the same memory / token
// reasons. 200k chars ≈ 60–70k tokens, well past anything a normal
// upload should be.
const MAX_TEXT_CHARS = 200_000;

function isDocumentAudit(value: unknown): value is DocumentAudit {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.document_id === "string" &&
    typeof v.filename === "string" &&
    typeof v.source_text === "string" &&
    Array.isArray(v.claims) &&
    !!v.summary &&
    typeof v.summary === "object"
  );
}

export async function POST(req: NextRequest) {
  let body: DehallucinateDocumentRequestBody;
  try {
    body = (await req.json()) as DehallucinateDocumentRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Request body is not valid JSON." },
      { status: 400 },
    );
  }

  const { sourceText, filename, audit } = body ?? {};

  if (typeof sourceText !== "string" || sourceText.trim().length === 0) {
    return NextResponse.json(
      { error: "`sourceText` must be a non-empty string." },
      { status: 400 },
    );
  }
  if (sourceText.length > MAX_TEXT_CHARS) {
    return NextResponse.json(
      {
        error: `Document too long: ${sourceText.length} chars (max ${MAX_TEXT_CHARS}).`,
      },
      { status: 413 },
    );
  }
  if (typeof filename !== "string" || filename.trim().length === 0) {
    return NextResponse.json(
      { error: "`filename` must be a non-empty string." },
      { status: 400 },
    );
  }
  if (!isDocumentAudit(audit)) {
    return NextResponse.json(
      { error: "`audit` must be a DocumentAudit object." },
      { status: 400 },
    );
  }

  try {
    const result = await buildDocumentRevisions({
      sourceText,
      filename,
      audit,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MalformedLLMJsonError) {
      console.error(
        "[/api/dehallucinate-document] malformed LLM JSON:",
        err.message,
      );
      return NextResponse.json(
        {
          error: `Document dehallucinator LLM returned malformed JSON: ${err.message}`,
        },
        { status: 502 },
      );
    }
    const message =
      err instanceof Error
        ? err.message
        : "Unknown dehallucinate-document error.";
    console.error("[/api/dehallucinate-document] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
