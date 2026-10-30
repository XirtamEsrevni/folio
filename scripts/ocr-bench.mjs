// Local OCR measurement. Not part of CI. Prints JSON; it does not decide pass/fail.
// Images are drawn with Pillow (Liberation Serif) when python3 is available.
// This is not the reference laptop in the OCR plan, and these are rendered pages, not photographs.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createWorker, OEM, PSM } from "tesseract.js";
import { gunzipSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const dir = mkdtempSync(join(tmpdir(), "folio-ocr-"));
const model = join(dir, "tessdata");
spawnSync("mkdir", ["-p", model], { stdio: "inherit" });
const gz = readFileSync(resolve(root, "vendor/ocr/eng.traineddata.gz"));
const raw = gunzipSync(gz);
const { writeFileSync } = await import("node:fs");
writeFileSync(join(model, "eng.traineddata"), raw);

const py = `
from PIL import Image, ImageDraw, ImageFont
import os, sys
out = sys.argv[1]
font_path = "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf"
def page(name, size, width, height, columns, body, font_px):
    font = ImageFont.truetype(font_path, font_px)
    img = Image.new("L", (width, height), 255)
    draw = ImageDraw.Draw(img)
    if columns == 1:
        draw.multiline_text((80, 80), body, font=font, fill=0, spacing=16)
    else:
        left, right = body.split("\\n---\\n")
        draw.multiline_text((60, 80), left, font=font, fill=0, spacing=14)
        draw.multiline_text((width // 2 + 40, 80), right, font=font, fill=0, spacing=14)
    img.save(os.path.join(out, name + ".png"))
page("clean", "clean", 1600, 700, 1, "THE QUICK BROWN FOX\\nJUMPS OVER THE LAZY DOG", 48)
page("letter", "letter", 1700, 2200, 1, "\\n".join(["The quick brown fox jumps over the lazy dog."] * 28), 36)
page("lowres", "lowres", 800, 500, 1, "THE QUICK BROWN FOX\\nJUMPS OVER THE LAZY DOG", 22)
page("columns", "columns", 1600, 700, 2, "ALPHA PHRASE IN COLUMN ONE\\n---\\nBETA PHRASE IN COLUMN TWO", 42)
`;
const gen = spawnSync("python3", ["-c", py, dir], { encoding: "utf8" });
if (gen.status !== 0) {
  console.error(gen.stderr || gen.stdout);
  process.exit(1);
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = a[i - 1] === b[j - 1] ? prev : Math.min(prev, row[j - 1], row[j]) + 1;
      prev = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
}

const truth = {
  clean: "THE QUICK BROWN FOX\nJUMPS OVER THE LAZY DOG",
  letter: Array.from({ length: 28 }, () => "The quick brown fox jumps over the lazy dog.").join("\n"),
  lowres: "THE QUICK BROWN FOX\nJUMPS OVER THE LAZY DOG",
  columns: "ALPHA PHRASE IN COLUMN ONE\nBETA PHRASE IN COLUMN TWO",
};

const worker = await createWorker("eng", OEM.LSTM_ONLY, {
  langPath: model,
  gzip: false,
  cacheMethod: "none",
});
await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, user_defined_dpi: "300" });
const rssBefore = process.memoryUsage().rss;
const pages = [];
for (const name of Object.keys(truth)) {
  const started = Date.now();
  const result = await worker.recognize(join(dir, `${name}.png`));
  const ms = Date.now() - started;
  const got = result.data.text.replace(/\s+$/g, "").replace(/[ \t]+\n/g, "\n");
  const expected = truth[name];
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const gotN = norm(got);
  const expN = norm(expected);
  const cer = editDistance([...gotN], [...expN]) / Math.max(1, expN.length);
  const gotWords = gotN.split(" ").filter(Boolean);
  const expWords = expN.split(" ").filter(Boolean);
  const wer = editDistance(gotWords, expWords) / Math.max(1, expWords.length);
  pages.push({
    name,
    ms,
    cer: Number(cer.toFixed(4)),
    wer: Number(wer.toFixed(4)),
    text: got,
    columnOrder: name === "columns" ? got.indexOf("ALPHA") < got.indexOf("BETA") && got.indexOf("ALPHA") >= 0 : undefined,
  });
}
await worker.terminate();
const assets = spawnSync("du", ["-sb", resolve(root, "public/ocr")], { encoding: "utf8" });
const report = {
  engine: "tesseract.js",
  engineVersion: "7.0.0",
  coreVersion: "7.0.0",
  model: "eng 4.0.0_best_int",
  modelSha256: createHash("sha256").update(gz).digest("hex"),
  modelGzipBytes: gz.byteLength,
  oem: "LSTM_ONLY",
  psm: "3",
  dpi: 300,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  rssBytesAfter: process.memoryUsage().rss,
  rssBytesBefore: rssBefore,
  publicOcrBytes: assets.stdout ? Number(assets.stdout.split(/\s+/)[0]) : null,
  note: "Sandbox measurement of rendered pages, not a 2021 laptop and not a photographed scan. Frame time and installer size were not measured.",
  pages,
};
console.log(JSON.stringify(report, null, 2));
rmSync(dir, { recursive: true, force: true });
