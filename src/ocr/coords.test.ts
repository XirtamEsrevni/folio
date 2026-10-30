import { describe, expect, it } from "vitest";
import { intersectionOverUnion, pdfBoxToViewportRect, rasterBoxToPdfBox, textItemPdfBox, wordsToTextContent } from "./coords";
import { makePdf } from "./pdf-fixture";
import type { OcrWord } from "./types";

describe("OCR coordinates", () => {
  it("round-trips a known box through pdf.js at several zooms and rotations", async () => {
    const pdf = await makePdf([
      { rotation: 0 },
      { rotation: 90 },
      { rotation: 180 },
      { rotation: 270 },
    ]);
    const truth = { x0: 72, y0: 100, x1: 180, y1: 132 };
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      for (const scale of [0.75, 1, 2, 300 / 72]) {
        const raster = page.getViewport({ scale });
        const corners = [
          raster.convertToViewportPoint(truth.x0, truth.y0),
          raster.convertToViewportPoint(truth.x1, truth.y0),
          raster.convertToViewportPoint(truth.x0, truth.y1),
          raster.convertToViewportPoint(truth.x1, truth.y1),
        ];
        const xs = corners.map((point) => point[0]);
        const ys = corners.map((point) => point[1]);
        const word: OcrWord = {
          text: "Hello",
          confidence: 95,
          eol: true,
          x0: Math.min(...xs),
          y0: Math.min(...ys),
          x1: Math.max(...xs),
          y1: Math.max(...ys),
        };
        const recovered = rasterBoxToPdfBox(word, raster);
        expect(recovered.x0).toBeCloseTo(truth.x0, 1);
        expect(recovered.y0).toBeCloseTo(truth.y0, 1);
        expect(recovered.x1).toBeCloseTo(truth.x1, 1);
        expect(recovered.y1).toBeCloseTo(truth.y1, 1);

        const item = wordsToTextContent([word], raster).items[0];
        if (!("transform" in item)) throw new Error("expected a text item");
        const glyph = textItemPdfBox(item);
        expect(intersectionOverUnion(glyph, truth)).toBeGreaterThan(0.98);

        const view = page.getViewport({ scale: scale * 1.35, rotation: (page.rotate + 90) % 360 });
        const expected = pdfBoxToViewportRect(truth, view);
        const actual = pdfBoxToViewportRect(glyph, view);
        const box = (rect: { left: number; top: number; width: number; height: number }) => ({
          x0: rect.left, y0: rect.top, x1: rect.left + rect.width, y1: rect.top + rect.height,
        });
        expect(intersectionOverUnion(box(actual), box(expected))).toBeGreaterThan(0.98);
      }
    }
  });
});
