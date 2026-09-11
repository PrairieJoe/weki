import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";

const IMAGE_OPERATORS = new Set([
  pdfjs.OPS.paintImageMaskXObject,
  pdfjs.OPS.paintImageMaskXObjectRepeat,
  pdfjs.OPS.paintSolidColorImageMask,
  pdfjs.OPS.paintImageXObject,
  pdfjs.OPS.paintInlineImageXObject,
  pdfjs.OPS.paintImageXObjectRepeat,
  pdfjs.OPS.paintInlineImageXObjectGroup,
]);

const VECTOR_OPERATORS = new Set([
  pdfjs.OPS.constructPath,
  pdfjs.OPS.closePath,
  pdfjs.OPS.stroke,
  pdfjs.OPS.closeStroke,
  pdfjs.OPS.fill,
  pdfjs.OPS.eoFill,
  pdfjs.OPS.fillStroke,
  pdfjs.OPS.eoFillStroke,
  pdfjs.OPS.shadingFill,
]);

export function hasPdfVisualContent(operatorList) {
  return (operatorList?.fnArray || []).some((operator) => IMAGE_OPERATORS.has(operator) || VECTOR_OPERATORS.has(operator));
}

export function buildPdfVisualAsset({ page, bytes, ocrText = "" }) {
  const normalizedOcr = String(ocrText || "").replace(/\s+/gu, " ").trim();
  const imageBytes = bytes instanceof Uint8Array ? bytes : Buffer.from(bytes || []);
  return { name: `page-${Number(page) || 1}.png`, mime: "image/png", bytes: imageBytes, ocrText: normalizedOcr, text: normalizedOcr, source: "rendered-page" };
}

export async function renderPdfPagePng(buffer, pageNumber, { scale = 1.5 } = {}) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true }).promise;
  try {
    const page = await pdf.getPage(Number(pageNumber));
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    return canvas.toBuffer("image/png");
  } finally {
    pdf.cleanup?.();
    await pdf.destroy?.();
  }
}
