import { OCR_CACHE_BUDGET_BYTES, OCR_ENGINE_ID, OCR_ENGINE_VERSION, modelVersion } from "./constants";
import { folioRequest, OCR_STORE } from "../recent";
import type { OcrWord } from "./types";

export interface OcrCacheRecord {
  id: string;
  docId: string;
  page: number;
  engineId: string;
  engineVersion: string;
  modelVersion: string;
  renderParamsHash: string;
  lang: string;
  words: OcrWord[];
  text: string;
  bytes: number;
  updatedAt: number;
}

export function renderParamsHash(params: { scale: number; width: number; height: number }) {
  return `${params.scale.toFixed(4)}:${params.width}x${params.height}`;
}

/**
 * docId is Folio's content key (SHA-256 of the first and last megabyte, plus the byte length).
 * Editing the middle of a huge file without changing its size or either end keeps the same id,
 * so a stale OCR page is possible; that is the same identity notes and Ask AI already use.
 * A changed engine, model, or render size misses this key and is recognized again.
 */
export function cacheId(docId: string, page: number, lang: string, renderHash: string) {
  return `${docId}|p${page}|${OCR_ENGINE_ID}|${OCR_ENGINE_VERSION}|${modelVersion(lang)}|${renderHash}`;
}

export async function readOcrCache(id: string): Promise<OcrCacheRecord | undefined> {
  const record = await folioRequest<OcrCacheRecord | undefined>(OCR_STORE, "readonly", (store) => store.get(id));
  if (!record) return undefined;
  void folioRequest(OCR_STORE, "readwrite", (store) => store.put({ ...record, updatedAt: Date.now() })).catch(() => {});
  return record;
}

export async function writeOcrCache(record: OcrCacheRecord) {
  await folioRequest(OCR_STORE, "readwrite", (store) => store.put(record));
  await evictOcrCache();
}

export async function ocrCacheBytes() {
  const all = await folioRequest<OcrCacheRecord[]>(OCR_STORE, "readonly", (store) => store.getAll()).catch(() => []);
  return all.reduce((sum, record) => sum + (record.bytes || 0), 0);
}

export async function clearOcrCache() {
  await folioRequest(OCR_STORE, "readwrite", (store) => store.clear());
}

async function evictOcrCache() {
  const all = await folioRequest<OcrCacheRecord[]>(OCR_STORE, "readonly", (store) => store.getAll());
  let total = all.reduce((sum, record) => sum + (record.bytes || 0), 0);
  if (total <= OCR_CACHE_BUDGET_BYTES) return;
  const oldest = [...all].sort((a, b) => a.updatedAt - b.updatedAt);
  for (const record of oldest) {
    if (total <= OCR_CACHE_BUDGET_BYTES) break;
    await folioRequest(OCR_STORE, "readwrite", (store) => store.delete(record.id));
    total -= record.bytes || 0;
  }
}

export function recordBytes(words: OcrWord[], text: string) {
  return text.length * 2 + words.length * 48 + 64;
}
