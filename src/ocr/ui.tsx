import { useEffect, useState } from "react";
import { coverageStatement } from "./coverage";
import type { OcrSnapshot } from "./session";

export function OcrStatus({ snapshot, onCancel }: { snapshot: OcrSnapshot; onCancel: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!snapshot.enabled || snapshot.phase === "idle" || snapshot.phase === "disabled") return null;
  if (snapshot.scanPages === 0 && snapshot.phase !== "failed") return null;
  const finished = snapshot.processed.length + snapshot.failed.length;
  const total = snapshot.classified ? String(snapshot.scanPages) : "…";
  const label = snapshot.phase === "cancelled"
    ? "Scan reading cancelled"
    : snapshot.phase === "failed"
      ? "Couldn't read this scan"
      : snapshot.phase === "running" || snapshot.phase === "checking"
        ? `Reading scan · ${finished} of ${total}`
        : snapshot.failed.length
          ? `Scan text ready · ${snapshot.failed.length} failed`
          : "Scan text ready";
  return (
    <div className="ocr-status">
      <button
        className="ocr-chip"
        data-ocr-phase={snapshot.phase}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      {open && (
        <div className="ocr-pop" role="dialog" aria-label="Scan reading">
          <p>Folio reads scanned pages on this computer. Ask AI sends that text only when you ask a question.</p>
          {snapshot.failed.length > 0 && <p>Couldn't read {snapshot.failed.map((page) => `page ${page}`).join(", ")}.</p>}
          {(snapshot.phase === "running" || snapshot.phase === "checking") && (
            <button className="btn ghost" onClick={() => { onCancel(); setOpen(false); }}>Cancel</button>
          )}
        </div>
      )}
    </div>
  );
}

export function ocrCoverageLine(snapshot: OcrSnapshot): string | null {
  if (!snapshot.enabled) return null;
  return coverageStatement([
    ...snapshot.processed.map((page) => ({ page, kind: "ready" as const })),
    ...snapshot.failed.map((page) => ({ page, kind: "failed" as const })),
    ...snapshot.pending.map((page) => ({ page, kind: "pending" as const })),
  ]);
}

export function ocrSearchNote(snapshot: OcrSnapshot) {
  if (!snapshot.enabled || snapshot.scanPages === 0) return "";
  if (snapshot.phase === "running" || snapshot.phase === "checking") {
    return "Some pages of this scan are still being read, so search can miss them.";
  }
  if (snapshot.phase === "failed") return "OCR couldn't read this scan, so there's no text to search.";
  if (snapshot.failed.length > 0) return "Search skips pages OCR couldn't read.";
  return "";
}
