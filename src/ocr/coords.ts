import type { TextContent, TextItem } from "pdfjs-dist/types/src/display/api";
import { OCR_ASCENT, OCR_DESCENT, OCR_FONT } from "./constants";
import type { OcrWord, PdfBox } from "./types";

export interface PointMapper {
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportPoint(x: number, y: number): number[];
}

/** OCR boxes are raster pixels, origin top-left. PDF user space is origin bottom-left, rotation included. */
export function rasterBoxToPdfBox(word: Pick<OcrWord, "x0" | "y0" | "x1" | "y1">, viewport: PointMapper): PdfBox {
  const [xBottomLeft, yBottomLeft] = viewport.convertToPdfPoint(word.x0, word.y1);
  const [xTopRight, yTopRight] = viewport.convertToPdfPoint(word.x1, word.y0);
  return {
    x0: Math.min(xBottomLeft, xTopRight),
    y0: Math.min(yBottomLeft, yTopRight),
    x1: Math.max(xBottomLeft, xTopRight),
    y1: Math.max(yBottomLeft, yTopRight),
  };
}

export function pdfBoxToViewportRect(box: PdfBox, viewport: PointMapper) {
  const [ax, ay] = viewport.convertToViewportPoint(box.x0, box.y0);
  const [bx, by] = viewport.convertToViewportPoint(box.x1, box.y1);
  const left = Math.min(ax, bx);
  const top = Math.min(ay, by);
  return { left, top, width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

export function wordsToTextContent(words: OcrWord[], viewport: PointMapper): TextContent {
  const items: TextItem[] = words.map((word) => {
    const box = rasterBoxToPdfBox(word, viewport);
    const height = Math.max(0.1, box.y1 - box.y0);
    // Baseline sits `descent` below the box bottom so the reconstructed glyph box matches the OCR box.
    const fontSize = height / (OCR_ASCENT - OCR_DESCENT);
    const baseline = box.y0 - OCR_DESCENT * fontSize;
    return {
      str: word.text + (word.eol ? "" : " "),
      dir: "ltr",
      transform: [fontSize, 0, 0, fontSize, box.x0, baseline],
      width: Math.max(0.1, box.x1 - box.x0),
      height: fontSize,
      fontName: OCR_FONT,
      hasEOL: word.eol,
    };
  });
  return {
    items,
    styles: {
      [OCR_FONT]: {
        ascent: OCR_ASCENT,
        descent: OCR_DESCENT,
        vertical: false,
        fontFamily: "sans-serif",
      },
    },
    lang: null,
  };
}

/** Glyph rectangle implied by a text item, in PDF user space. */
export function textItemPdfBox(item: TextItem): PdfBox {
  const fontSize = item.transform[3];
  const left = item.transform[4];
  const baseline = item.transform[5];
  return {
    x0: left,
    y0: baseline + OCR_DESCENT * fontSize,
    x1: left + item.width,
    y1: baseline + OCR_ASCENT * fontSize,
  };
}

export function intersectionOverUnion(a: PdfBox, b: PdfBox) {
  const x0 = Math.max(a.x0, b.x0);
  const y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1);
  const y1 = Math.min(a.y1, b.y1);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const areaA = Math.max(0, a.x1 - a.x0) * Math.max(0, a.y1 - a.y0);
  const areaB = Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
  const union = areaA + areaB - inter;
  return union <= 0 ? 0 : inter / union;
}
