import type { PDFPageProxy } from "pdfjs-dist";
import { OCR_MAX_EDGE_PX, OCR_RENDER_SCALE } from "./constants";
import type { OcrImage } from "./types";

/** Renders a page at ~300 DPI with a cap on the canvas, in the page's own rotation (not the user's). */
export async function rasterizePage(page: PDFPageProxy, signal: AbortSignal): Promise<OcrImage> {
  signal.throwIfAborted();
  const base = page.getViewport({ scale: OCR_RENDER_SCALE });
  const edge = Math.max(base.width, base.height);
  const scale = edge > OCR_MAX_EDGE_PX ? OCR_RENDER_SCALE * (OCR_MAX_EDGE_PX / edge) : OCR_RENDER_SCALE;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const task = page.render({ canvas, viewport });
  const cancel = () => task.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    await task.promise;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
  signal.throwIfAborted();
  return { width: canvas.width, height: canvas.height, scale, rotation: viewport.rotation, canvas };
}
