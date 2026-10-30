import { beforeEach, describe, expect, it } from "vitest";
import { cacheId, clearOcrCache, readOcrCache, renderParamsHash, writeOcrCache, type OcrCacheRecord } from "./cache";
import { OCR_CACHE_BUDGET_BYTES, OCR_ENGINE_VERSION } from "./constants";
import { folioRequest, OCR_STORE } from "../recent";

function record(id: string, updatedAt: number, bytes: number): OcrCacheRecord {
  return {
    id,
    docId: "doc",
    page: 1,
    engineId: "tesseract.js",
    engineVersion: OCR_ENGINE_VERSION,
    modelVersion: "eng@test",
    renderParamsHash: "h",
    lang: "eng",
    words: [],
    text: "hello",
    bytes,
    updatedAt,
  };
}

describe("OCR cache", () => {
  beforeEach(() => clearOcrCache());

  it("keys pages by document, engine, model, and render size", () => {
    const a = cacheId("doc", 3, "eng", renderParamsHash({ scale: 4.1667, width: 100, height: 200 }));
    expect(a).toContain(`tesseract.js|${OCR_ENGINE_VERSION}`);
    expect(a).not.toBe(cacheId("doc", 3, "spa", renderParamsHash({ scale: 4.1667, width: 100, height: 200 })));
    expect(a).not.toBe(cacheId("doc", 4, "eng", renderParamsHash({ scale: 4.1667, width: 100, height: 200 })));
    expect(a).not.toBe(cacheId("other", 3, "eng", renderParamsHash({ scale: 4.1667, width: 100, height: 200 })));
    expect(a).not.toBe(cacheId("doc", 3, "eng", renderParamsHash({ scale: 1, width: 10, height: 10 })));
  });

  it("drops the oldest records once the budget is passed", async () => {
    const half = Math.floor(OCR_CACHE_BUDGET_BYTES * 0.75);
    await writeOcrCache(record("old", 1, half));
    await writeOcrCache(record("new", 2, half));
    const all = await folioRequest<OcrCacheRecord[]>(OCR_STORE, "readonly", (store) => store.getAll());
    expect(all.map((item) => item.id)).toEqual(["new"]);
    expect(await readOcrCache("old")).toBeUndefined();
  });
});
