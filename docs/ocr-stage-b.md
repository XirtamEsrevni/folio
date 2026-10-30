# Stage B: search, selection, and highlights

Gate G2 asked for one integration path, not a second text cache.

Folio patches `PDFDocumentProxy.getPage` (`src/ocr/text-provider.ts`). For a scan page whose recognition has finished, both of pdf.js's readers return the same OCR text:

- `getTextContent`, which `PDFFindController` and the search snippets use
- `streamTextContent`, which draws the text layer used for selection, copy, and highlights

Until that page is ready, both calls keep the embedded text (empty on a pure scan). A find that starts before recognition finishes is checked again when the embedded read returns, so it does not keep the empty layer. When a page becomes ready, Folio resets that page view (keeping the canvas and annotations) and clears the find controller's extracted-text cache.

Words are mapped from raster pixels back through the same pdf.js viewport that drew the page (`rasterBoxToPdfBox`). The synthetic text item uses a fixed ascent and descent so the glyph box matches that PDF rectangle. `src/ocr/coords.test.ts` checks the round trip against pdf.js `convertToViewportPoint` / `convertToPdfPoint` at scales 0.75, 1, 2, and 300/72, for page rotations 0, 90, 180, and 270, and again at a different zoom plus a further 90 degrees of view rotation. The overlap required there is an intersection-over-union above 0.98.

A later session on the same document replaces the host. Pages patched earlier follow the new host.

What this does not prove: an Electron smoke test that selects an OCR span and asserts a highlight. The existing smoke test still covers a digital PDF only. Running OCR inside that smoke would add a WASM recognition wait to every platform job; it is not wired in yet.
