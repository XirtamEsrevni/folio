import { beforeEach, describe, expect, it, vi } from "vitest";
import { OPS, type PDFDocumentProxy } from "pdfjs-dist";
import { clearOcrCache } from "./cache";
import { folioRequest, OCR_STORE } from "../recent";
import { startOcrSession, type OcrDeps } from "./session";
import type { OcrCacheRecord } from "./cache";
import type { RawWord } from "./types";

const word: RawWord = { text: "Hello", confidence: 90, x0: 1, y0: 1, x1: 8, y1: 4 };

function fakePdf(pages: { text: string; image?: boolean; fail?: boolean }[]): PDFDocumentProxy {
  return {
    numPages: pages.length,
    getPage: async (n: number) => {
      const spec = pages[n - 1];
      return {
        getTextContent: async () => {
          if (spec.fail) throw new Error("corrupt");
          return { items: spec.text ? [{ str: spec.text }] : [], styles: {} };
        },
        streamTextContent: () => new ReadableStream({ start(controller) { controller.close(); } }),
        getOperatorList: async () => ({ fnArray: spec.image ? [OPS.paintImageXObject] : [], argsArray: [] }),
        getViewport: () => ({
          width: 30,
          height: 10,
          rotation: 0,
          scale: 1,
          convertToPdfPoint: (x: number, y: number) => [x, y],
          convertToViewportPoint: (x: number, y: number) => [x, y],
        }),
      };
    },
  } as unknown as PDFDocumentProxy;
}

function deps(recognize: OcrDeps["engine"]["recognize"], rasterize?: OcrDeps["rasterize"]): OcrDeps {
  return {
    rasterize: rasterize ?? (async () => ({ width: 40, height: 20, scale: 2, rotation: 0 })),
    engine: { id: "tesseract.js", version: "7.0.0", recognize, terminate: async () => {} },
  };
}

describe("OCR session", () => {
  beforeEach(() => clearOcrCache());

  it("does not recognize a page that already has text", async () => {
    let calls = 0;
    const session = startOcrSession({
      pdf: fakePdf([{ text: "This digital page has more than twenty characters." }]),
      docId: "digital",
      persist: true,
      deps: deps(async () => { calls += 1; return { words: [word] }; }),
    });
    await session.finished;
    expect(calls).toBe(0);
    expect(session.snapshot().scanPages).toBe(0);
    expect((await session.page(1)).kind).toBe("embedded");
  });

  it("recognizes an image page once, then reuses the cache", async () => {
    let calls = 0;
    const recognize: OcrDeps["engine"]["recognize"] = async () => { calls += 1; return { words: [word] }; };
    const first = startOcrSession({
      pdf: fakePdf([{ text: "", image: true }]),
      docId: "scan",
      persist: true,
      deps: deps(recognize),
    });
    await first.finished;
    expect(calls).toBe(1);
    expect((await first.page(1)).text).toContain("Hello");

    const second = startOcrSession({
      pdf: fakePdf([{ text: "", image: true }]),
      docId: "scan",
      persist: true,
      deps: deps(recognize),
    });
    await second.finished;
    expect(calls).toBe(1);
    expect((await second.page(1)).kind).toBe("ready");
  });

  it("does not persist a password-protected document", async () => {
    const session = startOcrSession({
      pdf: fakePdf([{ text: "", image: true }]),
      docId: "secret",
      persist: false,
      deps: deps(async () => ({ words: [word] })),
    });
    await session.finished;
    expect((await session.page(1)).kind).toBe("ready");
    const all = await folioRequest<OcrCacheRecord[]>(OCR_STORE, "readonly", (store) => store.getAll());
    expect(all).toEqual([]);
  });

  it("terminates the engine when the session is cancelled", async () => {
    let terminated = false;
    const session = startOcrSession({
      pdf: fakePdf([{ text: "", image: true }]),
      docId: "cancel",
      persist: false,
      deps: {
        rasterize: async () => ({ width: 10, height: 10, scale: 1, rotation: 0 }),
        engine: {
          id: "tesseract.js",
          version: "7.0.0",
          recognize: (_image, _lang, signal) => new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
          terminate: async () => { terminated = true; },
        },
      },
    });
    await vi.waitFor(() => {
      if (session.snapshot().phase !== "running") throw new Error(`phase ${session.snapshot().phase}`);
    });
    session.abort();
    await session.finished;
    expect(terminated).toBe(true);
    expect(session.snapshot().phase).toBe("cancelled");
  });

  it("records a page it cannot read as failed", async () => {
    let calls = 0;
    const session = startOcrSession({
      pdf: fakePdf([{ text: "", fail: true }]),
      docId: "bad",
      persist: true,
      deps: deps(async () => { calls += 1; return { words: [] }; }),
    });
    await session.finished;
    expect(calls).toBe(0);
    expect((await session.page(1)).kind).toBe("failed");
    expect(session.snapshot().phase).toBe("failed");
  });
});
