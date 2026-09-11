import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { extractRenderedSvgVisualAssets } from "./visual-assets.mjs";

const decodeResult = (value) => {
  if (typeof value !== "string") return String(value ?? "");
  try { return JSON.parse(value); } catch { return value; }
};

export async function createDocumentRenderer({ componentPath }) {
  if (!componentPath) throw new Error("document-renderer component path is required");
  const modulePath = path.join(componentPath, "rhwp.js");
  const wasmPath = path.join(componentPath, "rhwp_bg.wasm");
  const renderer = await import(pathToFileURL(modulePath).href);
  await renderer.default({ module_or_path: await fs.readFile(wasmPath) });
  if (typeof renderer.HwpDocument !== "function") throw new Error("document-renderer HwpDocument export is unavailable");
  return {
    async extract(buffer, options = {}) {
      const document = new renderer.HwpDocument(new Uint8Array(buffer));
      try {
      const pageCount = document.pageCount();
      const pages = [];
      for (let index = 0; index < pageCount; index += 1) {
        const text = String(decodeResult(document.getPageText(index)) || "").replace(/\s+/g, " ").trim();
        let renderedSvg = "";
        try { renderedSvg = String(document.renderPageSvg(index) || ""); } catch { /* A text-only page remains searchable. */ }
        const embeddedAssets = extractRenderedSvgVisualAssets(renderedSvg, { page: index + 1 });
          const visualOcr = [];
          if (typeof options.recognizeVisualAsset === "function") {
            for (const asset of embeddedAssets) {
              try {
                const ocrText = String(await options.recognizeVisualAsset(asset.bytes, asset) || "").replace(/\s+/g, " ").trim();
                if (ocrText) visualOcr.push(ocrText);
              } catch { /* A damaged image remains a visual asset without searchable OCR. */ }
            }
          }
          let ocrText = visualOcr.join(" ");
          if (renderedSvg && !embeddedAssets.length && !text && typeof options.recognizeRenderedPage === "function") {
            try {
              const renderedOcrText = String(await options.recognizeRenderedPage(renderedSvg) || "").replace(/\s+/g, " ").trim();
              ocrText = [ocrText, renderedOcrText].filter(Boolean).filter((value, valueIndex, list) => list.indexOf(value) === valueIndex).join(" ");
            } catch { /* Native page text remains searchable when rendered OCR is unavailable. */ }
          }
          pages.push({ page: index + 1, text: [text, ocrText].filter(Boolean).filter((value, valueIndex, list) => list.indexOf(value) === valueIndex).join(" "), nativeText: text, ocrText, renderedSvg, rendererStatus: "document-renderer", visualAssets: (embeddedAssets.length || ocrText) && renderedSvg ? [{ name: `page-${index + 1}.svg`, mime: "image/svg+xml", mimeType: "image/svg+xml", bytes: Buffer.from(renderedSvg), importance: 100, ocrText, text: ocrText, source: "rendered-page", embeddedAssets: embeddedAssets.map((asset) => ({ ...asset, importance: asset.importance ?? 50 })) }] : [] });
          await options.onUnit?.(index + 1, pageCount);
        }
        if (!pages.length) throw new Error("renderer returned no physical pages");
        return pages;
      } finally {
        document.free?.();
      }
    },
  };
}
