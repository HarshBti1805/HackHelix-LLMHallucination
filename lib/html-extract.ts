/**
 * Minimal, dependency-free HTML → readable-text extractor (MAJOR_CHANGES.md #5).
 *
 * Not a full Readability implementation — just enough to turn a fetched web
 * page into clean prose the claim extractor can work with:
 *   - drop <script>, <style>, <noscript>, <svg>, <head>, nav/footer chrome,
 *   - convert block tags to newlines so paragraphs survive,
 *   - strip remaining tags, decode common entities, collapse whitespace.
 *
 * Kept tiny and synchronous on purpose; the goal is "good enough text", not
 * perfect article parsing. The auditor caps claims anyway.
 */

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&mdash;": "—",
  "&ndash;": "–",
  "&hellip;": "…",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&rdquo;": "”",
  "&ldquo;": "“",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : "";
}

export function htmlToText(html: string): { title: string; text: string } {
  const title = extractTitle(html);

  let s = html;
  // Remove whole non-content regions.
  s = s.replace(
    /<(script|style|noscript|svg|head|nav|footer|header|aside|form|iframe)[\s\S]*?<\/\1>/gi,
    " ",
  );
  // Block-level tags → newlines so paragraph/sentence boundaries survive.
  s = s.replace(
    /<\/(p|div|section|article|li|ul|ol|h[1-6]|br|tr|table|blockquote)>/gi,
    "\n",
  );
  s = s.replace(/<br\s*\/?>/gi, "\n");
  // Strip all remaining tags.
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  // Collapse whitespace; keep paragraph breaks.
  s = s
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title, text: s };
}
