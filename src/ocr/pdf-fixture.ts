import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(join(pdfjsRoot, "legacy/build/pdf.worker.min.mjs")).href;

const TINY_PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
));

export async function openPdf(bytes: Uint8Array) {
  return pdfjs.getDocument({
    data: bytes,
    standardFontDataUrl: pathToFileURL(`${join(pdfjsRoot, "standard_fonts")}/`).href,
  }).promise;
}

export async function makePdf(pages: { text?: string; image?: boolean; rotation?: 0 | 90 | 180 | 270 }[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const png = await doc.embedPng(TINY_PNG);
  for (const spec of pages) {
    const page = doc.addPage([612, 792]);
    if (spec.text) page.drawText(spec.text, { x: 72, y: 700, size: 12, font });
    if (spec.image) page.drawImage(png, { x: 72, y: 400, width: 80, height: 80 });
    if (spec.rotation) page.setRotation(degrees(spec.rotation));
  }
  return openPdf(new Uint8Array(await doc.save()));
}
