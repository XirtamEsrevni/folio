export type PageKind = "embedded" | "blank" | "pending" | "failed" | "ready";

export interface CoveragePage {
  page: number;
  kind: PageKind;
}

/** "pages 1-12 processed, page 9 failed, pages 13-40 still processing" */
export function coverageStatement(pages: CoveragePage[]): string | null {
  const scan = pages.filter((page) => page.kind === "ready" || page.kind === "failed" || page.kind === "pending");
  if (scan.length === 0) return null;
  const parts: string[] = [];
  const processed = formatRanges(scan.filter((page) => page.kind === "ready").map((page) => page.page));
  const failed = formatRanges(scan.filter((page) => page.kind === "failed").map((page) => page.page));
  const pending = formatRanges(scan.filter((page) => page.kind === "pending").map((page) => page.page));
  if (processed) parts.push(`pages ${processed} processed`);
  if (failed) parts.push(`${failed.includes("-") || failed.includes(",") ? "pages" : "page"} ${failed} failed`);
  if (pending) parts.push(`pages ${pending} still processing`);
  return `OCR coverage: ${parts.join(", ")}.`;
}

export function coverageComplete(pages: CoveragePage[]) {
  const scan = pages.filter((page) => page.kind !== "embedded" && page.kind !== "blank");
  return scan.length > 0 && scan.every((page) => page.kind === "ready");
}

function formatRanges(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const page of sorted.slice(1)) {
    if (page === prev + 1) {
      prev = page;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = page;
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
  return ranges.join(", ");
}
