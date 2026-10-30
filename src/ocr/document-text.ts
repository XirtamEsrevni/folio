import { coverageComplete, coverageStatement, type CoveragePage, type PageKind } from "./coverage";

export const MAX_DOC_CHARS = 400_000;

export interface SourcePage {
  page: number;
  kind: PageKind;
  text: string;
}

export interface PageTextSource {
  numPages: number;
  readonly generation: number;
  page(pageNumber: number): Promise<SourcePage>;
}

export interface DocumentText {
  text: string;
  truncated: boolean;
  /** Null when the document has no scan-like pages. */
  coverage: string | null;
  hasText: boolean;
  /** True while any scan page is still pending. */
  inProgress: boolean;
  /** True once every scan page succeeded. False when there is nothing to OCR. */
  complete: boolean;
  failed: boolean;
  scan: boolean;
}

const cache = new WeakMap<object, { generation: number; promise: Promise<DocumentText> }>();

/** Same document object, new generation: the previous promise is not reused. */
export function buildDocumentText(doc: object, source: PageTextSource): Promise<DocumentText> {
  const hit = cache.get(doc);
  if (hit && hit.generation === source.generation) return hit.promise;
  const promise = compose(source);
  cache.set(doc, { generation: source.generation, promise });
  return promise;
}

export function composeDocument(pages: SourcePage[]): DocumentText {
  const coveragePages: CoveragePage[] = pages.map(({ page, kind }) => ({ page, kind }));
  const coverage = coverageStatement(coveragePages);
  const scan = coverage != null;
  const inProgress = pages.some((page) => page.kind === "pending");
  const failed = pages.some((page) => page.kind === "failed");
  const complete = coverageComplete(coveragePages);
  let text = "";
  let truncated = false;
  for (const page of pages) {
    if (page.kind !== "embedded" && page.kind !== "ready") continue;
    const body = page.text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    const block = `[Page ${page.page}]\n${body}\n\n`;
    if (text.length + block.length > MAX_DOC_CHARS) {
      truncated = true;
      break;
    }
    text += block;
  }
  const hasText = text.replace(/\[Page \d+\]/g, "").trim().length > 0;
  return { text, truncated, coverage, hasText, inProgress, complete, failed, scan };
}

async function compose(source: PageTextSource) {
  const pages: SourcePage[] = [];
  for (let n = 1; n <= source.numPages; n++) pages.push(await source.page(n));
  return composeDocument(pages);
}

export function instructions(name: string, doc: DocumentText) {
  const lead = `You are the reading assistant in Folio, a PDF reader. The user is reading "${name}".`;
  const rules = [
    "Guidelines:",
    "- Answer from the document. If it doesn't contain the answer, say so plainly; you may add general knowledge if it helps, clearly labeled as such.",
    "- Cite page numbers like (p. 12) when you use specific information from the document.",
    "- When the user quotes a passage, focus on that passage and use the rest of the document as context.",
    "- Be concise. Use short paragraphs, and bullet lists where they help. Use only light Markdown: **bold**, lists, and `code`.",
  ];
  if (doc.scan && doc.coverage) {
    const honesty = doc.complete
      ? "OCR coverage is complete and no page failed, so a whole-document answer is legitimate. Still cite pages."
      : "A whole-document answer is not legitimate yet. If an answer may depend on a failed page or a page that is still processing, say so instead of presenting a partial read as knowledge of the whole document.";
    const body = doc.hasText
      ? `Text below between <document> tags mixes the PDF's own text layer and on-device OCR, with [Page N] markers.${doc.truncated ? " The document is long, so only the beginning is included; say so if a question may depend on later pages." : ""}`
      : doc.failed && !doc.inProgress
        ? "No page text is available. On-device OCR failed or is unavailable, so you can only answer from the passages the user quotes."
        : "No page text is available yet.";
    return [
      lead,
      doc.coverage,
      honesty,
      body,
      ...rules,
      "",
      doc.hasText ? `<document>\n${doc.text}</document>` : "",
    ].join("\n");
  }
  if (!doc.hasText) {
    const why = doc.failed
      ? "This PDF has no extractable text, and on-device OCR failed or is unavailable, so you can only answer from the passages the user quotes."
      : "This PDF has no extractable text (it may be scanned images), so you can only answer from the passages the user quotes.";
    return [lead, why, ...rules, ""].join("\n");
  }
  return [
    lead,
    `Its extracted text is below between <document> tags, with [Page N] markers.${doc.truncated ? " The document is long, so only the beginning is included; say so if a question may depend on later pages." : ""}`,
    ...rules,
    "",
    `<document>\n${doc.text}</document>`,
  ].join("\n");
}
