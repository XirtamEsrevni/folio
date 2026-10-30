export interface RawWord {
  text: string;
  confidence: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A word in raster pixel space (origin top-left) after reading-order assembly. */
export interface OcrWord extends RawWord {
  eol: boolean;
}

export interface OcrImage {
  width: number;
  height: number;
  scale: number;
  rotation: number;
  canvas?: HTMLCanvasElement;
}

export interface OcrEngine {
  readonly id: string;
  readonly version: string;
  recognize(image: OcrImage, lang: string, signal: AbortSignal): Promise<{ words: RawWord[] }>;
  terminate(): Promise<void>;
}

export interface PdfBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
