import { openaiJson } from "@/lib/providers/openai";
import { checkGroundedness } from "@/lib/groundedness";
import { auditDocument } from "@/lib/document-audit";
import { generateCitations } from "@/lib/connectors/citations-evidence";
import { WORKSPACE_ROUTER_PROMPT } from "@/lib/prompts/workspace-router";
import {
  connectedConnectors,
  getConnector,
} from "@/lib/connectors/registry";
import { NotionNotConnectedError } from "@/lib/connectors/notion";
import type {
  ConnectorId,
  ConnectorPageTextResponse,
  WorkspaceAttachment,
  WorkspaceMode,
  WorkspaceRunResult,
  WorkspaceUsedDoc,
} from "@/types";

export { NotionNotConnectedError };

/** A pulled doc plus which connector it came from (needed for `used` + follow-ups). */
type ResolvedDoc = ConnectorPageTextResponse & { connector: ConnectorId };

/**
 * Agentic workspace orchestrator (MAJOR_CHANGES.md #C1).
 *
 * Turns a natural-language instruction + the docs a user pulled from their
 * connector into a finished audit — WITHOUT making the user paste content or
 * choose a check type. It:
 *   1. resolves the docs (uses the attachments, or searches when none given),
 *   2. pulls their text via the connector (MCP),
 *   3. asks the locked auditor to ROUTE the request (groundedness vs factcheck)
 *      and assign doc roles — a thin orchestration step, NOT a 4th verifier,
 *   4. runs the existing audit engine UNCHANGED and returns the result.
 *
 * The auditing engines (`checkGroundedness`, `auditDocument`) are reused as-is;
 * this module only decides which to call and on what text.
 */

// Bound how much we pull/route over so latency + spend stay predictable.
const MAX_DOCS = 4;
const ROUTER_EXCERPT_CHARS = 900;
const MAX_CONTEXT_CHARS = 170_000;
const MAX_DISCOVERED = 3;

interface RouterPlan {
  mode?: WorkspaceMode;
  checked_doc_id?: string;
  source_doc_ids?: string[];
  note?: string;
}

function excerpt(text: string): string {
  return text.slice(0, ROUTER_EXCERPT_CHARS);
}

/**
 * Detects follow-up requests that clearly want two-sided citations gathered for
 * the claims already on screen. Used as a robustness override so the exact case
 * "generate citations for and against the claims" never silently degrades into
 * a fresh fact-check of the wrong doc.
 */
function looksLikeCitationsIntent(instruction: string): boolean {
  const s = instruction.toLowerCase();
  if (/\b(citations?|sources?|references?)\b/.test(s)) {
    return /\b(for and against|against|contradict|support|generate|find|gather|back)\b/.test(
      s,
    );
  }
  return /\bevidence\b/.test(s) && /\b(for and against|against|contradict|support)\b/.test(s);
}

async function pull(
  sid: string,
  connector: ConnectorId,
  id: string,
): Promise<ResolvedDoc | null> {
  try {
    const doc = await getConnector(connector).fetchPageText(sid, id);
    return { ...doc, connector };
  } catch {
    return null;
  }
}

/**
 * Resolve the docs to operate on. Precedence: explicit attachments, then the
 * previous turn's docs (so follow-ups operate on the same document), then a
 * fresh search across every connected connector. Each ref carries its connector
 * so we always pull from the right source.
 */
async function resolveDocs(
  sid: string,
  instruction: string,
  attachments: WorkspaceAttachment[],
  prior: { connector: ConnectorId; id: string; title: string }[],
): Promise<ResolvedDoc[]> {
  let refs: { connector: ConnectorId; id: string }[];
  if (attachments.length > 0) {
    refs = attachments.slice(0, MAX_DOCS).map((a) => ({ connector: a.connector, id: a.id }));
  } else if (prior.length > 0) {
    // Follow-up on the previous turn — reuse those docs instead of re-searching.
    refs = prior.slice(0, MAX_DOCS).map((p) => ({ connector: p.connector, id: p.id }));
  } else {
    // No context — search every connected source and merge the top hits.
    const conns = connectedConnectors(sid);
    const perConn = await Promise.all(
      conns.map(async (c) => {
        try {
          const hits = await c.searchPages(sid, instruction);
          return hits.slice(0, MAX_DISCOVERED).map((h) => ({ connector: c.id, id: h.id }));
        } catch {
          return [];
        }
      }),
    );
    refs = perConn.flat().slice(0, MAX_DOCS);
  }

  const docs = await Promise.all(refs.map((r) => pull(sid, r.connector, r.id)));
  return docs.filter((d): d is ResolvedDoc => !!d && d.text.trim().length > 0);
}

/** Heuristic fallback when the router LLM fails or returns something invalid. */
function fallbackPlan(docs: ConnectorPageTextResponse[]): Required<RouterPlan> {
  if (docs.length <= 1) {
    return {
      mode: "factcheck",
      checked_doc_id: docs[0]?.id ?? "",
      source_doc_ids: [],
      note: `Fact-checking "${docs[0]?.title ?? "the document"}" against the web.`,
    };
  }
  // Shortest doc is most likely the summary/draft being checked; the rest are
  // the trusted source.
  const sorted = [...docs].sort((a, b) => a.text.length - b.text.length);
  const checked = sorted[0];
  const sources = sorted.slice(1);
  return {
    mode: "groundedness",
    checked_doc_id: checked.id,
    source_doc_ids: sources.map((d) => d.id),
    note: `Checking "${checked.title}" for faithfulness to ${sources
      .map((d) => `"${d.title}"`)
      .join(", ")}.`,
  };
}

async function route(
  instruction: string,
  docs: ConnectorPageTextResponse[],
): Promise<Required<RouterPlan>> {
  const fallback = fallbackPlan(docs);

  // Robustness override: an unmistakable "citations for/against" request always
  // routes to citations on the most-likely checked doc, even if the LLM wobbles.
  const citationsForced = looksLikeCitationsIntent(instruction);

  try {
    const payload = JSON.stringify({
      INSTRUCTION: instruction,
      DOCS: docs.map((d) => ({
        id: d.id,
        title: d.title,
        excerpt: excerpt(d.text),
      })),
    });
    const plan = await openaiJson<RouterPlan>(WORKSPACE_ROUTER_PROMPT, payload);

    const ids = new Set(docs.map((d) => d.id));
    let mode: WorkspaceMode =
      plan.mode === "groundedness" ||
      plan.mode === "factcheck" ||
      plan.mode === "citations"
        ? plan.mode
        : fallback.mode;
    if (citationsForced) mode = "citations";

    const checked =
      plan.checked_doc_id && ids.has(plan.checked_doc_id)
        ? plan.checked_doc_id
        : fallback.checked_doc_id;
    const sources = (plan.source_doc_ids ?? []).filter(
      (id) => ids.has(id) && id !== checked,
    );

    // Groundedness needs at least one source; downgrade to factcheck if none.
    if (mode === "groundedness" && sources.length === 0) {
      return { ...fallback, checked_doc_id: checked };
    }
    return {
      mode,
      checked_doc_id: checked,
      source_doc_ids: mode === "groundedness" ? sources : [],
      note: plan.note?.trim() || noteFor(mode, docs, checked, fallback.note),
    };
  } catch {
    if (citationsForced) {
      return { ...fallback, mode: "citations", source_doc_ids: [] };
    }
    return fallback;
  }
}

function noteFor(
  mode: WorkspaceMode,
  docs: ConnectorPageTextResponse[],
  checkedId: string,
  fallbackNote: string,
): string {
  if (mode !== "citations") return fallbackNote;
  const title = docs.find((d) => d.id === checkedId)?.title ?? "the document";
  return `Gathering supporting and contradicting citations for the claims in "${title}".`;
}

export async function runWorkspaceAudit(
  sid: string,
  instruction: string,
  attachments: WorkspaceAttachment[],
  prior: { connector: ConnectorId; id: string; title: string }[] = [],
): Promise<WorkspaceRunResult> {
  const docs = await resolveDocs(sid, instruction, attachments, prior);
  if (docs.length === 0) {
    throw new Error(
      attachments.length > 0
        ? "Couldn't read any text from the attached document(s)."
        : "Couldn't find a matching document. Try searching for one with the search button.",
    );
  }

  const plan = await route(instruction, docs);
  const byId = new Map(docs.map((d) => [d.id, d]));
  const checked = byId.get(plan.checked_doc_id) ?? docs[0];
  const checkedUsed: WorkspaceUsedDoc = {
    connector: checked.connector,
    id: checked.id,
    title: checked.title,
    url: checked.url,
    role: "checked",
  };

  if (plan.mode === "citations") {
    const citations = await generateCitations(checked.text, checked.title);
    return { mode: "citations", note: plan.note, used: [checkedUsed], citations };
  }

  if (plan.mode === "factcheck") {
    const audit = await auditDocument(checked.text, checked.title);
    return { mode: "factcheck", note: plan.note, used: [checkedUsed], audit };
  }

  // groundedness
  const sources = plan.source_doc_ids
    .map((id) => byId.get(id))
    .filter((d): d is ResolvedDoc => !!d);
  const context = sources
    .map((d) => `# ${d.title}\n${d.text}`)
    .join("\n\n")
    .slice(0, MAX_CONTEXT_CHARS);

  const groundedness = await checkGroundedness(
    checked.text,
    context,
    checked.title,
  );
  const used: WorkspaceUsedDoc[] = [
    checkedUsed,
    ...sources.map((d) => ({
      connector: d.connector,
      id: d.id,
      title: d.title,
      url: d.url,
      role: "source" as const,
    })),
  ];
  return { mode: "groundedness", note: plan.note, used, groundedness };
}
