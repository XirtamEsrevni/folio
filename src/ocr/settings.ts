const ENABLED = "folio:ocr:enabled";
const LANG = "folio:ocr:lang";

export function ocrEnabled() {
  try {
    return localStorage.getItem(ENABLED) !== "0";
  } catch {
    return true;
  }
}

export function setOcrEnabled(on: boolean) {
  localStorage.setItem(ENABLED, on ? "1" : "0");
  notify();
}

export function ocrLanguage() {
  try {
    return localStorage.getItem(LANG) || "eng";
  } catch {
    return "eng";
  }
}

export function setOcrLanguage(lang: string) {
  localStorage.setItem(LANG, lang);
  notify();
}

export const OCR_SETTINGS_EVENT = "folio:ocr-settings";

function notify() {
  window.dispatchEvent(new Event(OCR_SETTINGS_EVENT));
}
