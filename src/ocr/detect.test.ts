import { describe, expect, it } from "vitest";
import { OPS } from "pdfjs-dist";
import { SCAN_TEXT_CHAR_THRESHOLD } from "./constants";
import { classifyPage, significantChars } from "./detect";
import { makePdf } from "./pdf-fixture";

describe("page classification", () => {
  it("leaves a real text layer alone and treats an image-only page as a scan", async () => {
    expect(SCAN_TEXT_CHAR_THRESHOLD).toBe(20);
    const pdf = await makePdf([
      { text: "Hello digital document with plenty of characters" },
      { image: true },
      { text: "Hi" },
      {},
      { text: "Hello digital document with plenty of characters", image: true },
    ]);
    expect(await classifyPage(await pdf.getPage(1))).toBe("embedded");
    expect(await classifyPage(await pdf.getPage(2))).toBe("scan");
    expect(await classifyPage(await pdf.getPage(3))).toBe("blank");
    expect(await classifyPage(await pdf.getPage(4))).toBe("blank");
    expect(await classifyPage(await pdf.getPage(5))).toBe("embedded");
    expect(significantChars("a b")).toBe(2);
  });

  it("marks a page failed when its text cannot be read", async () => {
    const page = {
      getTextContent: async () => { throw new Error("corrupt"); },
      getOperatorList: async () => ({ fnArray: [OPS.paintImageXObject] }),
    };
    expect(await classifyPage(page as never)).toBe("failed");
  });
});
