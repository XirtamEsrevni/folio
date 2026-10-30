import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OCR_ENGINE_VERSION, OCR_MODELS } from "./constants";

describe("pinned OCR engine", () => {
  it("matches the installed tesseract.js and the vendored English model", () => {
    const version = createRequire(import.meta.url)("tesseract.js/package.json").version as string;
    expect(version).toBe(OCR_ENGINE_VERSION);
    expect(version).toBe("7.0.0");
    const bytes = readFileSync("vendor/ocr/eng.traineddata.gz");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    expect(sha256).toBe(OCR_MODELS.eng.sha256);
    expect(bytes.byteLength).toBe(OCR_MODELS.eng.bytes);
    expect(OCR_MODELS.eng.version).toBe("4.0.0_best_int");
  });
});
