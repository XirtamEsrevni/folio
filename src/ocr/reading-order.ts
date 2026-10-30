import type { OcrWord, RawWord } from "./types";

/**
 * Minimal reading order: one column top-to-bottom, or two columns left then right when a clear
 * vertical gutter splits the page. Table and equation structure is intentionally not reconstructed.
 */
export function orderWords(words: RawWord[], pageWidth: number): OcrWord[] {
  const cleaned = words.filter((word) => word.text.trim().length > 0);
  if (cleaned.length === 0) return [];
  const gutter = findGutter(cleaned, pageWidth);
  if (gutter == null) return linesToWords(clusterLines(cleaned));
  const left = cleaned.filter((word) => (word.x0 + word.x1) / 2 < gutter);
  const right = cleaned.filter((word) => (word.x0 + word.x1) / 2 >= gutter);
  return [...linesToWords(clusterLines(left)), ...linesToWords(clusterLines(right))];
}

export function wordsToText(words: OcrWord[]) {
  let text = "";
  for (const word of words) text += word.text + (word.eol ? "\n" : " ");
  return text.trim();
}

function findGutter(words: RawWord[], pageWidth: number): number | null {
  if (words.length < 4 || pageWidth <= 0) return null;
  const sorted = [...words].sort((a, b) => a.x0 - b.x0);
  let best: { at: number; gap: number } | null = null;
  for (let i = 0; i < sorted.length - 1; i++) {
    const gapStart = sorted[i].x1;
    const gapEnd = sorted[i + 1].x0;
    const gap = gapEnd - gapStart;
    const mid = (gapStart + gapEnd) / 2;
    if (mid < pageWidth * 0.2 || mid > pageWidth * 0.8) continue;
    if (gap < pageWidth * 0.08) continue;
    const left = sorted.filter((word) => (word.x0 + word.x1) / 2 < mid).length;
    const right = sorted.length - left;
    if (left < 2 || right < 2) continue;
    if (!best || gap > best.gap) best = { at: mid, gap };
  }
  return best?.at ?? null;
}

function clusterLines(words: RawWord[]): RawWord[][] {
  if (words.length === 0) return [];
  const heights = words.map((word) => Math.max(1, word.y1 - word.y0)).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)];
  const tolerance = Math.max(4, median * 0.6);
  const sorted = [...words].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0);
  const lines: RawWord[][] = [];
  for (const word of sorted) {
    const y = (word.y0 + word.y1) / 2;
    const line = lines[lines.length - 1];
    if (!line) {
      lines.push([word]);
      continue;
    }
    const lineY = line.reduce((sum, item) => sum + (item.y0 + item.y1) / 2, 0) / line.length;
    if (Math.abs(y - lineY) <= tolerance) line.push(word);
    else lines.push([word]);
  }
  for (const line of lines) line.sort((a, b) => a.x0 - b.x0);
  return lines;
}

function linesToWords(lines: RawWord[][]): OcrWord[] {
  const out: OcrWord[] = [];
  for (const line of lines) {
    line.forEach((word, index) => {
      out.push({ ...word, text: word.text.trim(), eol: index === line.length - 1 });
    });
  }
  return out;
}
