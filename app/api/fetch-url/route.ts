import { NextRequest, NextResponse } from "next/server";
import { htmlToText } from "@/lib/html-extract";
import type { FetchUrlRequestBody } from "@/types";

/**
 * POST /api/fetch-url  (MAJOR_CHANGES.md #5 — audit a URL / webpage)
 *
 * Server-side fetch of a public web page, returned as readable text. Done on
 * the server to dodge browser CORS and to apply SSRF guards (no localhost /
 * private-range hosts). The caller then feeds the text into the auditor or
 * the citation checker.
 *
 * Request:  { url: string }
 * Response: { url, title, text }  |  { error: string }
 */

export const maxDuration = 30;
export const runtime = "nodejs";

const MAX_BYTES = 3_000_000; // 3 MB of HTML is plenty for an article.

// Block obviously-internal targets to limit SSRF blast radius. Not exhaustive
// (this is a hackathon guard), but stops the easy localhost / metadata cases.
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (
    h === "localhost" ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h.endsWith(".local") ||
    h.endsWith(".internal")
  ) {
    return true;
  }
  // IPv4 private / loopback / link-local ranges.
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true; // cloud metadata
  return false;
}

export async function POST(req: NextRequest) {
  let body: FetchUrlRequestBody;
  try {
    body = (await req.json()) as FetchUrlRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Request body is not valid JSON." },
      { status: 400 },
    );
  }

  const raw = typeof body.url === "string" ? body.url.trim() : "";
  if (!raw) {
    return NextResponse.json(
      { error: "`url` must be a non-empty string." },
      { status: 400 },
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return NextResponse.json({ error: "That doesn't look like a valid URL." }, {
      status: 400,
    });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json(
      { error: "Only http(s) URLs are supported." },
      { status: 400 },
    );
  }
  if (isBlockedHost(parsed.hostname)) {
    return NextResponse.json(
      { error: "That host is not allowed." },
      { status: 400 },
    );
  }

  let res: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    res = await fetch(parsed.toString(), {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        // Some sites 403 a header-less client; present a plain UA.
        "User-Agent":
          "Mozilla/5.0 (compatible; GroundtruthAuditor/1.0; +https://groundtruth.app)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timer);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { error: `Couldn't fetch that page: ${reason}` },
      { status: 502 },
    );
  }

  if (!res.ok) {
    return NextResponse.json(
      { error: `The page responded ${res.status}.` },
      { status: 502 },
    );
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType && !/(text\/html|application\/xhtml|text\/plain)/i.test(contentType)) {
    return NextResponse.json(
      {
        error: `Unsupported content type (${contentType.split(";")[0]}). Paste the text directly instead.`,
      },
      { status: 415 },
    );
  }

  const html = (await res.text()).slice(0, MAX_BYTES);
  const { title, text } = htmlToText(html);

  if (!text.trim()) {
    return NextResponse.json(
      { error: "No readable text found on that page." },
      { status: 422 },
    );
  }

  return NextResponse.json({
    url: parsed.toString(),
    title: title || parsed.hostname,
    text,
  });
}
