import { OPS, type PDFPageProxy } from "pdfjs-dist";
import { SCAN_TEXT_CHAR_THRESHOLD } from "./constants";

const IMAGE_OPS = new Set<number>([
  OPS.paintImageXObject,
  OPS.paintImageXObjectRepeat,
  OPS.paintInlineImageXObject,
  OPS.paintInlineImageXObjectGroup,
  OPS.paintImageMaskXObject,
  OPS.paintImageMaskXObjectRepeat,
  OPS.paintImageMaskXObjectGroup,
]);

export type PageClass = "embedded" | "scan" | "blank" | "failed";

export function plainText(items: readonly unknown[]) {
  return items.map((item) => (item && typeof item === "object" && "str" in item && typeof item.str === "string" ? item.str : "")).join("");
}

export function significantChars(text: string) {
  return text.replace(/\s/g, "").length;
}

/** A real text layer wins. Image-only pages (and pages whose text is below the threshold) are scans. */
export async function classifyPage(page: PDFPageProxy): Promise<PageClass> {
  let text = "";
  try {
    const content = await page.getTextContent();
    text = plainText(content.items);
  } catch {
    return "failed";
  }
  if (significantChars(text) >= SCAN_TEXT_CHAR_THRESHOLD) return "embedded";
  try {
    const ops = await page.getOperatorList();
    const hasImage = ops.fnArray.some((fn) => IMAGE_OPS.has(fn));
    return hasImage ? "scan" : "blank";
  } catch {
    // Operator list is only a hint. A short-text page we can't inspect is safer to try than to skip.
    return "scan";
  }
}
