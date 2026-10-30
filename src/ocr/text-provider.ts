import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { TextContent } from "pdfjs-dist/types/src/display/api";

const PATCHED = Symbol("folioOcrPatched");
const HOST = Symbol("folioOcrHost");
export const ORIGINAL_TEXT = Symbol("folioOriginalGetTextContent");

export interface OcrTextHost {
  /** OCR text for a scan page whose recognition has finished; null to keep the embedded layer. */
  textContentIfReady(pageNumber: number): TextContent | null;
}

type PatchedDoc = PDFDocumentProxy & { [PATCHED]?: boolean; [HOST]?: OcrTextHost };
type PatchedPage = PDFPageProxy & { [PATCHED]?: boolean; [ORIGINAL_TEXT]?: PDFPageProxy["getTextContent"] };

/**
 * Stage B mechanism: one host feeds pdf.js's own consumers.
 * PDFFindController calls getTextContent. The text layer (selection and highlights) calls
 * streamTextContent. Search snippets call getTextContent. Ask AI reads the same host.
 * A later session on the same document replaces the host; pages already patched follow it.
 */
export function attachOcrText(pdf: PDFDocumentProxy, host: OcrTextHost) {
  const doc = pdf as PatchedDoc;
  doc[HOST] = host;
  if (doc[PATCHED]) return;
  doc[PATCHED] = true;
  const originalGetPage = pdf.getPage.bind(pdf);
  pdf.getPage = async (pageNumber: number) => {
    const page = await originalGetPage(pageNumber) as PatchedPage;
    if (page[PATCHED]) return page;
    page[PATCHED] = true;
    const originalGetText = page.getTextContent.bind(page);
    const originalStream = page.streamTextContent.bind(page);
    page[ORIGINAL_TEXT] = originalGetText;
    page.getTextContent = async (params) => {
      const ready = doc[HOST]?.textContentIfReady(pageNumber);
      if (ready) return ready;
      const embedded = await originalGetText(params);
      // Recognition can finish while the embedded read is in flight. Prefer the OCR text then,
      // so a find pass that started early doesn't cache the empty layer.
      return doc[HOST]?.textContentIfReady(pageNumber) ?? embedded;
    };
    page.streamTextContent = (params) => {
      const ready = doc[HOST]?.textContentIfReady(pageNumber);
      if (!ready) return originalStream(params);
      return new ReadableStream({
        start(controller) {
          controller.enqueue(ready);
          controller.close();
        },
      });
    };
    return page;
  };
}

/** Drop the cached text layer so the next draw reads streamTextContent again, and forget find's copy. */
export function refreshOcrPage(viewer: object | null, pageNumber: number, findController: object | null) {
  const viewHost = viewer as { getPageView?(index: number): { reset?(opts: object): void } | null; update?(): void } | null;
  const view = viewHost?.getPageView?.(pageNumber - 1);
  try {
    view?.reset?.({
      keepAnnotationLayer: true,
      keepAnnotationEditorLayer: true,
      keepXfaLayer: true,
      keepCanvasWrapper: true,
    });
    viewHost?.update?.();
  } catch {
    /* a page that was never drawn has nothing to reset */
  }
  const find = findController as FindCache | null;
  if (find) {
    find._extractTextPromises = [];
    find._pageContents = [];
    find._pageDiffs = [];
    find._hasDiacritics = [];
    find._dirtyMatch = true;
  }
}

export interface FindCache {
  _extractTextPromises: unknown[];
  _pageContents: unknown[];
  _pageDiffs: unknown[];
  _hasDiacritics: unknown[];
  _dirtyMatch: boolean;
}
