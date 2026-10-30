import { describe, expect, it } from "vitest";
import { coverageComplete, coverageStatement, type CoveragePage } from "./coverage";

describe("coverage", () => {
  it("names processed, failed, and pending ranges", () => {
    const pages: CoveragePage[] = [];
    for (let page = 1; page <= 40; page++) {
      const kind = page === 9 ? "failed" : page <= 12 ? "ready" : page <= 20 ? "embedded" : "pending";
      pages.push({ page, kind });
    }
    expect(coverageStatement(pages)).toBe("OCR coverage: pages 1-8, 10-12 processed, page 9 failed, pages 21-40 still processing.");
    expect(coverageComplete(pages)).toBe(false);
  });

  it("is null when nothing is scan-like, and complete only when every scan page succeeded", () => {
    expect(coverageStatement([{ page: 1, kind: "embedded" }, { page: 2, kind: "blank" }])).toBeNull();
    expect(coverageComplete([{ page: 1, kind: "ready" }, { page: 2, kind: "embedded" }])).toBe(true);
    expect(coverageComplete([{ page: 1, kind: "ready" }, { page: 2, kind: "failed" }])).toBe(false);
  });
});
