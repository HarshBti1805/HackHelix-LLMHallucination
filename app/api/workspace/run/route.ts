import { NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import {
  NotionNotConnectedError,
  runWorkspaceAudit,
} from "@/lib/connectors/workspace-audit";
import { CONNECTORS } from "@/lib/connectors/registry";
import { MalformedLLMJsonError, type WorkspaceRunRequestBody } from "@/types";

/**
 * POST /api/workspace/run  (MAJOR_CHANGES.md #C1)
 *
 * The agentic entry point for the /workspace page. Takes a natural-language
 * instruction + the docs the user pulled from a connector, decides what to
 * check (groundedness vs web fact-check), pulls the text, and runs the existing
 * audit engine. Returns a `WorkspaceRunResult`.
 */

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(req: Request) {
  const sid = await getSessionId();
  if (!sid) {
    return NextResponse.json(
      { error: "Connect a source (Notion) first." },
      { status: 401 },
    );
  }

  let body: WorkspaceRunRequestBody;
  try {
    body = (await req.json()) as WorkspaceRunRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Request body is not valid JSON." },
      { status: 400 },
    );
  }

  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  const prior = Array.isArray(body.prior)
    ? body.prior
        .filter(
          (p) =>
            !!p &&
            typeof p.id === "string" &&
            p.id.length > 0 &&
            typeof p.connector === "string" &&
            p.connector in CONNECTORS,
        )
        .map((p) => ({
          connector: p.connector,
          id: p.id,
          title: typeof p.title === "string" ? p.title : "",
        }))
    : [];
  if (!instruction && attachments.length === 0) {
    return NextResponse.json(
      { error: "Tell me what to check, or attach a document." },
      { status: 400 },
    );
  }

  try {
    const result = await runWorkspaceAudit(sid, instruction, attachments, prior);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof NotionNotConnectedError) {
      return NextResponse.json(
        { error: "Notion is not connected. Reconnect and try again." },
        { status: 401 },
      );
    }
    if (err instanceof MalformedLLMJsonError) {
      console.error("[/api/workspace/run] malformed LLM JSON:", err.message);
      return NextResponse.json(
        { error: `Auditor returned malformed JSON: ${err.message}` },
        { status: 502 },
      );
    }
    const message = err instanceof Error ? err.message : "Workspace audit failed.";
    console.error("[/api/workspace/run]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
