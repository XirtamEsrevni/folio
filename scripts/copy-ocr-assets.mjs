// Copies the on-device OCR runtime into public/ocr (gitignored; rebuilt by `npm run assets`).
// English traineddata is vendored. The worker is patched: tesseract.js 7.0.0's initialize()
// uses Lang.data (the file bytes) as the language name instead of Lang.code, so a worker
// created with { code, data } looks for a file named after the bytes and fails.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dest = resolve(root, "public/ocr");
const coreDest = resolve(dest, "core");
rmSync(dest, { recursive: true, force: true });
mkdirSync(coreDest, { recursive: true });

const coreNames = [
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-lstm.wasm",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm",
];
const coreSrc = resolve(root, "node_modules/tesseract.js-core");
for (const name of coreNames) cpSync(resolve(coreSrc, name), resolve(coreDest, name));

const from = 'return"string"==typeof t?t:t.data';
const worker = readFileSync(resolve(root, "node_modules/tesseract.js/dist/worker.min.js"), "utf8");
if (worker.split(from).length - 1 !== 1) {
  throw new Error("tesseract.js worker patch did not match. Check initialize() in worker.min.js before shipping OCR.");
}
writeFileSync(resolve(dest, "worker.min.js"), worker.replace(from, 'return"string"==typeof t?t:t.code'));
cpSync(resolve(root, "vendor/ocr/eng.traineddata.gz"), resolve(dest, "eng.traineddata.gz"));
