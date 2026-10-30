import { createWorker, OEM, PSM, type Worker } from "tesseract.js";
import { OCR_ENGINE_ID, OCR_ENGINE_VERSION, OCR_MODELS } from "./constants";
import type { OcrEngine, OcrImage, RawWord } from "./types";

/**
 * tesseract.js 7 (Apache-2.0) in a worker. The default English model is fetched from this app's
 * own files and checked before use. Other languages come from bytes the desktop shell already
 * checksummed. Nothing here contacts a network host.
 */
export async function createTesseractEngine(): Promise<OcrEngine> {
  let worker: Worker | null = null;
  let loadedLang = "";

  const ensure = async (lang: string, signal: AbortSignal) => {
    signal.throwIfAborted();
    if (worker && loadedLang === lang) return worker;
    if (worker) {
      await worker.terminate();
      worker = null;
    }
    const data = await modelBytes(lang);
    signal.throwIfAborted();
    const base = new URL(import.meta.env.BASE_URL, window.location.href);
    const created = await createWorker([{ code: lang, data }], OEM.LSTM_ONLY, {
      // worker.min.js is patched at build time: tesseract.js 7.0.0 names a {code,data} language
      // from `.data` (the bytes) instead of `.code`. See scripts/copy-ocr-assets.mjs.
      workerPath: new URL("ocr/worker.min.js", base).href,
      corePath: new URL("ocr/core", base).href,
      cacheMethod: "none",
      workerBlobURL: true,
      gzip: true,
      logger: () => {},
    });
    signal.throwIfAborted();
    await created.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      user_defined_dpi: "300",
    });
    worker = created;
    loadedLang = lang;
    return created;
  };

  return {
    id: OCR_ENGINE_ID,
    version: OCR_ENGINE_VERSION,
    async recognize(image: OcrImage, lang: string, signal: AbortSignal) {
      if (!image.canvas) throw new Error("OCR needs a rendered page.");
      const current = await ensure(lang, signal);
      const abort = () => { void current.terminate(); worker = null; loadedLang = ""; };
      signal.addEventListener("abort", abort, { once: true });
      try {
        signal.throwIfAborted();
        const result = await Promise.race([
          current.recognize(image.canvas, {}, { text: true, blocks: true }),
          abortError(signal),
        ]);
        signal.throwIfAborted();
        return { words: wordsFrom(result.data) };
      } finally {
        signal.removeEventListener("abort", abort);
      }
    },
    async terminate() {
      const current = worker;
      worker = null;
      loadedLang = "";
      if (current) await current.terminate();
    },
  };
}

async function modelBytes(lang: string) {
  const model = OCR_MODELS[lang];
  if (!model) throw new Error(`Folio doesn't have an OCR model for "${lang}".`);
  if (model.bundled) {
    const response = await fetch(new URL(`ocr/${lang}.traineddata.gz`, new URL(import.meta.env.BASE_URL, window.location.href)));
    if (!response.ok) throw new Error("The English OCR model is missing from this copy of Folio.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (await sha256(bytes) !== model.sha256) throw new Error("The English OCR model failed its checksum and was not used.");
    return bytes;
  }
  const desktop = window.folioDesktop?.ocr;
  if (!desktop) throw new Error("Extra OCR languages download in the desktop app.");
  const fetched = await desktop.fetchModel(lang);
  if (!fetched.ok) throw new Error(fetched.error);
  if (await sha256(fetched.bytes) !== model.sha256) throw new Error("That OCR language failed its checksum and was not used.");
  return fetched.bytes;
}

function abortError(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    else signal.addEventListener("abort", () => reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError")), { once: true });
  });
}

async function sha256(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function wordsFrom(data: { blocks: { paragraphs: { lines: { words: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] }[] }[] }[] | null; text: string }): RawWord[] {
  const words: RawWord[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          const text = word.text?.trim();
          if (!text) continue;
          words.push({
            text,
            confidence: word.confidence,
            x0: word.bbox.x0,
            y0: word.bbox.y0,
            x1: word.bbox.x1,
            y1: word.bbox.y1,
          });
        }
      }
    }
  }
  if (words.length === 0 && data.text?.trim()) {
    // The engine returned a string but no boxes. Keep the string; geometry stays best-effort.
    words.push({ text: data.text.trim(), confidence: 0, x0: 0, y0: 0, x1: 1, y1: 1 });
  }
  return words;
}
