/**
 * Type shim for pdf-parse's inner module. The package ships `@types/pdf-parse`
 * for the top-level entry only, but we import the inner module directly
 * (`pdf-parse/lib/pdf-parse.js`) to avoid the entry's bundler-breaking debug
 * block. This declares just the bit we use.
 */
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    version: string;
  }
  function pdfParse(
    data: Buffer | Uint8Array,
    options?: Record<string, unknown>,
  ): Promise<PdfParseResult>;
  export default pdfParse;
}
