import { describe, expect, it } from "vitest";
import type { TextContent } from "pdfjs-dist/types/src/display/api";
import { attachOcrText, refreshOcrPage } from "./text-provider";

function harness() {
  const embedded: TextContent = { items: [{ str: "embedded text that is long enough", dir: "ltr", transform: [12, 0, 0, 12, 0, 0], width: 10, height: 12, fontName: "f", hasEOL: false }], styles: {}, lang: null };
  const page = {
    getTextContent: () => Promise.resolve(embedded),
    streamTextContent: (_params?: object) => new ReadableStream({ start(controller) { controller.close(); } }),
  };
  let released = false;
  const gate = {
    wait: Promise.resolve(),
    hold() {
      let release = () => {};
      this.wait = new Promise<void>((resolve) => { release = () => { released = true; resolve(); }; });
      return release;
    },
  };
  page.getTextContent = () => gate.wait.then(() => embedded);
  const pdf = {
    numPages: 1,
    getPage: async (_pageNumber?: number) => page,
  };
  return { pdf, embedded, gate, released: () => released };
}

describe("shared text provider", () => {
  it("serves OCR text to getTextContent and streamTextContent, and follows a new host", async () => {
    const { pdf, embedded } = harness();
    const ocr: TextContent = { items: [{ str: "recognized", dir: "ltr", transform: [10, 0, 0, 10, 1, 2], width: 8, height: 10, fontName: "ocr", hasEOL: true }], styles: {}, lang: null };
    let current: TextContent | null = null;
    attachOcrText(pdf as never, { textContentIfReady: () => current });
    const page = await pdf.getPage(1);
    expect(await page.getTextContent()).toBe(embedded);
    current = ocr;
    expect(await page.getTextContent()).toBe(ocr);
    const reader = page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }).getReader();
    expect((await reader.read()).value).toBe(ocr);

    attachOcrText(pdf as never, { textContentIfReady: () => null });
    expect(await page.getTextContent()).toBe(embedded);
  });

  it("prefers OCR text that lands while the embedded read is in flight", async () => {
    const { pdf } = harness();
    const ocr: TextContent = { items: [], styles: {}, lang: null };
    let current: TextContent | null = null;
    const slow = {
      async getTextContent(_params?: object) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { items: [{ str: "late embedded" }], styles: {} };
      },
      streamTextContent: (_params?: object) => new ReadableStream({ start(controller) { controller.close(); } }),
    };
    const doc = { numPages: 1, getPage: async (_pageNumber?: number) => slow };
    attachOcrText(doc as never, { textContentIfReady: () => current });
    const page = await doc.getPage(1);
    const pending = page.getTextContent();
    current = ocr;
    expect(await pending).toBe(ocr);
    void pdf;
  });

  it("clears find caches when a page becomes ready", () => {
    let reset: object | undefined;
    const viewer = {
      getPageView: () => ({ reset: (opts: object) => { reset = opts; } }),
      update() {},
    };
    const find = { _extractTextPromises: [1], _pageContents: [1], _pageDiffs: [1], _hasDiacritics: [1], _dirtyMatch: false };
    refreshOcrPage(viewer, 2, find);
    expect(reset).toMatchObject({ keepCanvasWrapper: true });
    expect(find._pageContents).toEqual([]);
    expect(find._dirtyMatch).toBe(true);
  });
});
