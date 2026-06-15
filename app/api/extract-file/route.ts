import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";
// pdf-parse's package entry runs a debug block that reads a sample file when
// bundled, which crashes under Next/Turbopack. Import the inner module
// directly to bypass it.
import pdfParse from "pdf-parse/lib/pdf-parse.js";

/**
 * POST /api/extract-file  (MAJOR_CHANGES.md #6 — PDF / Word support)
 *
 * Server-side text extraction for binary documents the browser can't read as
 * plain text. Accepts a multipart/form-data upload with a single `file`
 * field and returns its extracted text.
 *
 *   - .pdf            → pdf-parse
 *   - .docx / .doc    → mammoth (raw text)
 *   - .txt / .md      → decoded directly (also handled client-side; here as a
 *                       fallback so any accepted file flows through one path)
 *
 * Response: { filename: string, text: string }  |  { error: string }
 */

export const maxDuration = 30;
export const runtime = "nodejs";

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB upload ceiling.

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected a multipart/form-data upload." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "No `file` field in the upload." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (${(file.size / 1e6).toFixed(1)} MB, max 20 MB).` },
      { status: 413 },
    );
  }

  const name = file.name || "upload";
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    let text = "";
    if (ext === "pdf") {
      const data = await pdfParse(buffer);
      text = data.text ?? "";
    } else if (ext === "docx" || ext === "doc") {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value ?? "";
    } else {
      // txt / md / unknown-but-textual
      text = buffer.toString("utf-8");
    }

    text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

    if (!text) {
      return NextResponse.json(
        {
          error:
            "Couldn't extract any text — the file may be scanned/image-only or empty.",
        },
        { status: 422 },
      );
    }

    return NextResponse.json({ filename: name, text });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    console.error("[/api/extract-file] error:", reason);
    return NextResponse.json(
      { error: `Couldn't parse ${name}: ${reason}` },
      { status: 422 },
    );
  }
}
