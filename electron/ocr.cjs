// On-device OCR language packs. The renderer may only name a language from this catalog.
// The URL, the checksum, and the file path are chosen here. This is not a general file or network API.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { app, net } = require("electron");

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "ocr-models.json"), "utf8"));

function entry(lang) {
  if (typeof lang !== "string" || !Object.hasOwn(catalog, lang)) return null;
  const model = catalog[lang];
  if (model.bundled) return null;
  return model;
}

function modelPath(lang) {
  return path.join(app.getPath("userData"), "ocr-models", `${lang}.traineddata.gz`);
}

function readVerified(lang, model) {
  const file = modelPath(lang);
  if (!fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== model.sha256) {
    fs.rmSync(file, { force: true });
    return null;
  }
  return bytes;
}

function register(handle) {
  handle("folio:ocr-model-status", (_event, lang) => {
    const model = entry(lang);
    if (!model) return { present: false, bytes: 0 };
    const bytes = readVerified(lang, model);
    return { present: !!bytes, bytes: bytes ? bytes.length : 0 };
  });

  handle("folio:ocr-fetch-model", async (_event, lang) => {
    const model = entry(lang);
    if (!model) return { ok: false, error: "That language isn't available." };
    const existing = readVerified(lang, model);
    if (existing) return { ok: true, sha256: model.sha256, bytes: existing };
    const response = await net.fetch(model.url);
    if (!response.ok) return { ok: false, error: "The language download failed." };
    const bytes = Buffer.from(await response.arrayBuffer());
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== model.sha256 || bytes.length !== model.bytes) {
      return { ok: false, error: "The language file didn't match its checksum, so it wasn't saved." };
    }
    fs.mkdirSync(path.dirname(modelPath(lang)), { recursive: true });
    fs.writeFileSync(modelPath(lang), bytes);
    return { ok: true, sha256, bytes };
  });
}

module.exports = { register };
