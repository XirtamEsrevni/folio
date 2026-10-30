import { describe, expect, it } from "vitest";
import { MAX_DOC_CHARS, buildDocumentText, composeDocument, instructions } from "./document-text";

const doc = () => ({});

describe("document text", () => {
  it("does not reuse a promise after the OCR generation changes", async () => {
    const holder = doc();
    const early = buildDocumentText(holder, {
      numPages: 1,
      generation: 1,
      page: async () => ({ page: 1, kind: "pending", text: "" }),
    });
    const again = buildDocumentText(holder, {
      numPages: 1,
      generation: 1,
      page: async () => ({ page: 1, kind: "ready", text: "should not replace the first generation" }),
    });
    expect(again).toBe(early);
    expect((await early).text).not.toContain("should not replace");

    const later = await buildDocumentText(holder, {
      numPages: 1,
      generation: 2,
      page: async () => ({ page: 1, kind: "ready", text: "page two is finished" }),
    });
    expect(later.text).toContain("page two is finished");
    expect(later.text).toContain("[Page 1]");
  });

  it("omits pending and failed pages, truncates at the cap, and states coverage", () => {
    const partial = composeDocument([
      { page: 1, kind: "ready", text: "seen" },
      { page: 2, kind: "pending", text: "hidden" },
      { page: 3, kind: "failed", text: "nope" },
    ]);
    expect(partial.text).toContain("seen");
    expect(partial.text).not.toContain("hidden");
    expect(partial.text).not.toContain("nope");
    expect(partial.inProgress).toBe(true);
    expect(partial.complete).toBe(false);
    const prompt = instructions("scan.pdf", partial);
    expect(prompt).toContain("OCR coverage: pages 1 processed, page 3 failed, pages 2 still processing.");
    expect(prompt).toContain("not legitimate");
    expect(prompt).not.toContain("passages the user quotes");

    const waiting = instructions("scan.pdf", composeDocument([{ page: 1, kind: "pending", text: "" }]));
    expect(waiting).toContain("still processing");
    expect(waiting).not.toContain("passages the user quotes");

    const done = instructions("scan.pdf", composeDocument([{ page: 1, kind: "ready", text: "all of it" }]));
    expect(done).toContain("whole-document answer is legitimate");

    const failed = instructions("scan.pdf", composeDocument([{ page: 1, kind: "failed", text: "" }]));
    expect(failed).toContain("page 1 failed");
    expect(failed).toContain("OCR failed");
    expect(failed).toContain("passages the user quotes");

    const digital = instructions("born.pdf", composeDocument([{ page: 1, kind: "embedded", text: "real text layer" }]));
    expect(digital).not.toContain("OCR coverage");
    expect(digital).toContain("real text layer");

    const long = composeDocument([
      { page: 1, kind: "embedded", text: "hello" },
      { page: 2, kind: "embedded", text: "x".repeat(MAX_DOC_CHARS) },
    ]);
    expect(long.truncated).toBe(true);
    expect(long.text).toContain("[Page 1]");
    expect(long.text).not.toContain("[Page 2]");
  });
});
