import { describe, expect, it } from "vitest";
import { orderWords, wordsToText } from "./reading-order";
import type { RawWord } from "./types";

function word(text: string, x0: number, y0: number, x1 = x0 + 40, y1 = y0 + 12): RawWord {
  return { text, confidence: 90, x0, y0, x1, y1 };
}

describe("reading order", () => {
  it("reads the left column before the right column", () => {
    const words = [
      word("BETA", 220, 10),
      word("ALPHA", 20, 10),
      word("TWO", 220, 40),
      word("ONE", 20, 40),
    ];
    const text = wordsToText(orderWords(words, 300));
    expect(text.indexOf("ALPHA")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("ALPHA")).toBeLessThan(text.indexOf("BETA"));
    expect(text.indexOf("ONE")).toBeLessThan(text.indexOf("TWO"));
    expect(text.indexOf("ALPHA")).toBeLessThan(text.indexOf("ONE"));
  });

  it("keeps a single column in top-to-bottom order", () => {
    const words = [word("SECOND", 20, 40), word("FIRST", 20, 10), word("THIRD", 20, 70)];
    expect(wordsToText(orderWords(words, 300))).toBe("FIRST\nSECOND\nTHIRD");
  });
});
