# OCR measurements

Recorded from `node scripts/ocr-bench.mjs` on 30 October 2026. These numbers are what that script printed. They are not a reason to change a threshold.

## What was measured

| | |
| --- | --- |
| Machine | This sandbox: Linux x64, Node v22.23.3. Not a mid-range 2021 laptop. |
| Engine | tesseract.js 7.0.0, LSTM only, page segmentation mode 3, `user_defined_dpi` 300 |
| Core | tesseract.js-core 7.0.0 (Apache-2.0) |
| Model | English `4.0.0_best_int`, gzip sha256 `45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91`, 2,952,873 bytes |
| Pages | Rendered with Pillow and Liberation Serif. Not scans, not skew, not photos. |

| Page | Image | Time | CER | WER |
| --- | --- | --- | --- | --- |
| clean | 1600×700, 48px | 207 ms | 0 | 0 |
| letter | 1700×2200, 36px, 28 lines | 1,713 ms | 0 | 0 |
| lowres | 800×500, 22px | 82 ms | 0 | 0 |
| columns | 1600×700, two phrases | 128 ms | 0 | 0 |

On the two-phrase page the engine's own text had "ALPHA" before "BETA". Folio still reorders words when it sees a gutter (`src/ocr/reading-order.ts`); that path is unit-tested and was not required for this particular image.

Node RSS around the four pages, after the worker was already loaded: 124,239,872 bytes before, 126,631,936 after. That is not the Electron process and not a 100-page document.

Unpacked files copied into `public/ocr` (worker, three LSTM wasm builds, English model): 23,349,323 bytes. Installer size on Windows, macOS, and Linux was not measured. Frame time, input latency, and a 100-page run were not measured.

## What was not measured

- Native Tesseract. No `tesseract` binary was available here, so there is no accuracy or speed number for it.
- Windows.Media.Ocr and Apple Vision. Neither runs on Linux, so neither can be the default engine for all three builds.
- A photographed page, a skewed page, a table, or an equation. No character-error gate is claimed for those.
- The proposed budgets in the plan (median ≤ 3 s/page on a 2021 laptop, p95 frame time, 500 MB RSS, 100-page cold start). They are unchanged. This run does not meet or relax them; it never ran on that machine.

## Why this engine

tesseract.js 7.0.0 and tesseract.js-core 7.0.0 are Apache-2.0. The English model is the `4.0.0_best_int` traineddata published for that library, Apache-2.0, and it is vendored so recognition does not download it. One worker path covers Windows, macOS, and Linux. Spanish, French, and German are the same model generation, downloaded only from the desktop shell after the size is shown, and kept only when the sha256 matches `electron/ocr-models.json`.
