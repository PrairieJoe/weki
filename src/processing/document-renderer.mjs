import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
          pages.push({ page: index + 1, text, nativeText: text, ocrText: "", renderedSvg, rendererStatus: "document-renderer" });
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
