import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { cacheId, readOcrCache, recordBytes, renderParamsHash, writeOcrCache } from "./cache";
import { classifyPage, plainText, significantChars } from "./detect";
import { SCAN_TEXT_CHAR_THRESHOLD, OCR_PAGE_TIMEOUT_MS, modelVersion } from "./constants";
import { orderWords, wordsToText } from "./reading-order";
import { ocrEnabled, ocrLanguage } from "./settings";
import { wordsToTextContent } from "./coords";
import { attachOcrText, ORIGINAL_TEXT, type OcrTextHost } from "./text-provider";
import type { PageTextSource, SourcePage } from "./document-text";
import type { OcrEngine, OcrImage, OcrWord } from "./types";
import type { TextContent } from "pdfjs-dist/types/src/display/api";

export interface OcrSnapshot {
  phase: "idle" | "disabled" | "checking" | "running" | "done" | "cancelled" | "failed";
  scanPages: number;
  classified: boolean;
  processed: number[];
  failed: number[];
  pending: number[];
  generation: number;
  lang: string;
  enabled: boolean;
}

export const IDLE_OCR: OcrSnapshot = {
  phase: "idle",
  scanPages: 0,
  classified: false,
  processed: [],
  failed: [],
  pending: [],
  generation: 0,
  lang: "eng",
  enabled: true,
};

type Record =
  | { kind: "embedded"; text: string }
  | { kind: "blank" }
  | { kind: "pending" }
  | { kind: "failed" }
  | { kind: "ready"; text: string; words: OcrWord[]; scale: number };

export interface OcrDeps {
  rasterize(page: PDFPageProxy, signal: AbortSignal): Promise<OcrImage>;
  engine: OcrEngine;
}

export interface OcrSession extends PageTextSource, OcrTextHost {
  snapshot(): OcrSnapshot;
  subscribe(listener: (snapshot: OcrSnapshot) => void): () => void;
  abort(): void;
  /** Resolves when the run finishes, fails, or is cancelled. */
  finished: Promise<void>;
}

export function startOcrSession(options: {
  pdf: PDFDocumentProxy;
  docId: string;
  persist: boolean;
  priorityPage?: () => number;
  onReady?: (pageNumber: number) => void;
  deps?: OcrDeps;
}): OcrSession {
  const { pdf, docId, persist } = options;
  const records = new Map<number, Record>();
  const pages = new Map<number, PDFPageProxy>();
  let generation = 0;
  let classified = false;
  let stopped = false;
  const listeners = new Set<(snapshot: OcrSnapshot) => void>();
  const controller = new AbortController();
  const lang = ocrLanguage();
  const enabled = ocrEnabled();
  let engine: OcrEngine | null = options.deps?.engine ?? null;
  let broken = false;

  const host: OcrTextHost = {
    textContentIfReady(pageNumber: number): TextContent | null {
      const record = records.get(pageNumber);
      const page = pages.get(pageNumber);
      if (record?.kind !== "ready" || !page) return null;
      const viewport = page.getViewport({ scale: record.scale });
      return wordsToTextContent(record.words, viewport);
    },
  };
  attachOcrText(pdf, host);

  function snapshot(): OcrSnapshot {
    const processed: number[] = [];
    const failed: number[] = [];
    const pending: number[] = [];
    let scanPages = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      const record = records.get(n);
      if (!record) continue;
      if (record.kind === "pending") { scanPages++; pending.push(n); }
      else if (record.kind === "failed") { scanPages++; failed.push(n); }
      else if (record.kind === "ready") { scanPages++; processed.push(n); }
    }
    let phase: OcrSnapshot["phase"] = "checking";
    if (!enabled) phase = "disabled";
    else if (broken && processed.length === 0) phase = "failed";
    else if (stopped && (pending.length > 0 || !classified)) phase = "cancelled";
    else if (!classified) phase = scanPages > 0 ? "running" : "checking";
    else if (scanPages === 0) phase = "done";
    else if (pending.length > 0) phase = "running";
    else if (processed.length === 0 && failed.length > 0) phase = "failed";
    else phase = "done";
    return { phase, scanPages, classified, processed, failed, pending, generation, lang, enabled };
  }

  function emit() {
    generation++;
    const next = snapshot();
    for (const listener of listeners) listener(next);
  }

  const finished = (async () => {
    if (!enabled) {
      classified = true;
      emit();
      return;
    }
    let deps: OcrDeps;
    try {
      deps = options.deps ?? await loadDefaultDeps();
    } catch (error) {
      broken = true;
      if (!controller.signal.aborted) console.warn("OCR stopped:", error instanceof Error ? error.message : "unknown error");
      classified = true;
      emit();
      return;
    }
    engine = deps.engine;
    if (controller.signal.aborted) {
      await deps.engine.terminate();
      stopped = true;
      classified = true;
      emit();
      return;
    }
    try {
      await run(deps);
    } catch (error) {
      broken = true;
      if (!controller.signal.aborted) console.warn("OCR stopped:", error instanceof Error ? error.message : "unknown error");
    } finally {
      if (controller.signal.aborted) stopped = true;
      classified = true;
      emit();
    }
  })();

  async function run(deps: OcrDeps) {
    const order: number[] = [];
    for (let n = 1; n <= pdf.numPages; n++) order.push(n);
    // Classify and recognize one page at a time so early pages are readable quickly.
    while (order.length && !controller.signal.aborted) {
      order.sort((a, b) => rank(a) - rank(b));
      const pageNumber = order.shift()!;
      await step(deps, pageNumber);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    classified = true;
  }

  function rank(pageNumber: number) {
    const current = options.priorityPage?.() ?? 1;
    if (pageNumber === current) return 0;
    return pageNumber;
  }

  async function step(deps: OcrDeps, pageNumber: number) {
    if (controller.signal.aborted) return;
    const page = await pdf.getPage(pageNumber);
    pages.set(pageNumber, page);
    const kind = await classifyPage(page);
    if (kind === "failed") {
      records.set(pageNumber, { kind: "failed" });
      emit();
      return;
    }
    if (kind === "blank") {
      records.set(pageNumber, { kind: "blank" });
      emit();
      return;
    }
    if (kind === "embedded") {
      records.set(pageNumber, { kind: "embedded", text: await embeddedText(page) });
      emit();
      return;
    }
    records.set(pageNumber, { kind: "pending" });
    emit();
    try {
      await enqueue(() => recognize(deps, page, pageNumber));
    } catch (error) {
      if (controller.signal.aborted) return;
      records.set(pageNumber, { kind: "failed" });
      emit();
      console.warn(`OCR failed on page ${pageNumber}:`, error instanceof Error ? error.message : "unknown error");
    }
  }

  async function recognize(deps: OcrDeps, page: PDFPageProxy, pageNumber: number) {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(OCR_PAGE_TIMEOUT_MS)]);
    const image = await deps.rasterize(page, signal);
    const hash = renderParamsHash({ scale: image.scale, width: image.width, height: image.height });
    if (persist) {
      const cached = await readOcrCache(cacheId(docId, pageNumber, lang, hash)).catch(() => undefined);
      if (cached && !signal.aborted) {
        records.set(pageNumber, { kind: "ready", text: cached.text, words: cached.words, scale: image.scale });
        emit();
        options.onReady?.(pageNumber);
        return;
      }
    }
    const recognized = await deps.engine.recognize(image, lang, signal);
    const words = orderWords(recognized.words, image.width);
    const text = wordsToText(words);
    records.set(pageNumber, { kind: "ready", text, words, scale: image.scale });
    if (persist) {
      const bytes = recordBytes(words, text);
      await writeOcrCache({
        id: cacheId(docId, pageNumber, lang, hash),
        docId,
        page: pageNumber,
        engineId: deps.engine.id,
        engineVersion: deps.engine.version,
        modelVersion: modelVersion(lang),
        renderParamsHash: hash,
        lang,
        words,
        text,
        bytes,
        updatedAt: Date.now(),
      }).catch(() => {});
    }
    emit();
    options.onReady?.(pageNumber);
  }

  return {
    get numPages() { return pdf.numPages; },
    get generation() { return generation; },
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    abort() {
      if (stopped) return;
      stopped = true;
      controller.abort();
      void engine?.terminate();
      emit();
    },
    finished,
    textContentIfReady: host.textContentIfReady,
    async page(pageNumber: number): Promise<SourcePage> {
      const record = records.get(pageNumber);
      if (!record) {
        const page = await pdf.getPage(pageNumber);
        const text = await embeddedText(page);
        if (significantChars(text) >= SCAN_TEXT_CHAR_THRESHOLD) return { page: pageNumber, kind: "embedded", text };
        return { page: pageNumber, kind: broken ? "failed" : enabled ? "pending" : "blank", text: "" };
      }
      if (record.kind === "ready") return { page: pageNumber, kind: "ready", text: record.text };
      if (record.kind === "embedded") return { page: pageNumber, kind: "embedded", text: record.text };
      if (record.kind === "failed") return { page: pageNumber, kind: "failed", text: "" };
      if (record.kind === "blank") return { page: pageNumber, kind: "blank", text: "" };
      return { page: pageNumber, kind: "pending", text: "" };
    },
  };
}

async function embeddedText(page: PDFPageProxy) {
  const original = (page as PDFPageProxy & { [ORIGINAL_TEXT]?: PDFPageProxy["getTextContent"] })[ORIGINAL_TEXT];
  const content = await (original ?? page.getTextContent.bind(page))();
  return plainText(content.items).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

let chain: Promise<void> = Promise.resolve();
function enqueue(task: () => Promise<void>) {
  const run = chain.then(task, task);
  chain = run.then(() => {}, () => {});
  return run;
}

async function loadDefaultDeps(): Promise<OcrDeps> {
  const [{ createTesseractEngine }, { rasterizePage }] = await Promise.all([
    import("./tesseract-engine"),
    import("./raster"),
  ]);
  return { engine: await createTesseractEngine(), rasterize: rasterizePage };
}
