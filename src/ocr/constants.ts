// Thresholds below are the proposed gates from the OCR plan. They are named so a later
// benchmark can point at the constant it justified. Do not lower them just to make a run pass.
// docs/ocr-benchmarks.md records a sandbox run; it did not change these values.
import catalog from "../../electron/ocr-models.json";

/** Fewer than this many non-whitespace characters, on a page that actually paints an image, is scan-like.
 *  Digital pages in the fixture set sit far above it; an image-only page sits at zero. */
export const SCAN_TEXT_CHAR_THRESHOLD = 20;

/** Raster scale for OCR: 300 DPI equivalent (PDF user space is 72 pt/in). */
export const OCR_RENDER_SCALE = 300 / 72;

/** Longest canvas edge. Larger pages are scaled down so a poster can't exhaust memory. */
export const OCR_MAX_EDGE_PX = 3300;

/** One page is abandoned after this long (worker is terminated). */
export const OCR_PAGE_TIMEOUT_MS = 60_000;

/** Least-recently-used cap for the IndexedDB OCR store. */
export const OCR_CACHE_BUDGET_BYTES = 200 * 1024 * 1024;

export const OCR_ENGINE_ID = "tesseract.js";
/** Must match the installed tesseract.js package. A unit test locks this. */
export const OCR_ENGINE_VERSION = "7.0.0";

export const OCR_FONT = "ocr";
/** pdf.js text-layer ascent/descent for the synthetic OCR font. The word box is reconstructed from these. */
export const OCR_ASCENT = 0.8;
export const OCR_DESCENT = -0.2;

export interface OcrModel {
  name: string;
  bundled: boolean;
  bytes: number;
  sha256: string;
  url: string;
  version: string;
}

export const OCR_MODELS = catalog as Record<string, OcrModel>;

export function modelVersion(lang: string) {
  const model = OCR_MODELS[lang];
  if (!model) return `${lang}@unknown`;
  // The hash prefix drops cached pages when a model file is replaced.
  return `${lang}@${model.version}:${model.sha256.slice(0, 12)}`;
}
