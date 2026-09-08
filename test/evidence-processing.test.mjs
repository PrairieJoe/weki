import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEvidenceFragments, chunkText, mergeNativeAndOcr } from "../src/processing/evidence.mjs";
import { createDocumentRenderer } from "../src/processing/document-renderer.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("document renderer returns physical HWPX pages with rendered provenance", async () => {
  const renderer = await createDocumentRenderer({ componentPath: path.join(projectRoot, "node_modules", "@rhwp", "core") });
  const pages = await renderer.extract(await import("node:fs/promises").then((fs) => fs.readFile(path.join(projectRoot, "test_data", "전남광주통합특별시_대전환의_길_교통.hwpx"))));
  assert.equal(pages.length, 22);
  assert.equal(pages[0].page, 1);
  assert.equal(pages[4].rendererStatus, "document-renderer");
  assert.match(pages[4].renderedSvg, /^<svg/);
});

test("document renderer exposes rendered pages as visual OCR evidence when requested", async () => {
  const renderer = await createDocumentRenderer({ componentPath: path.join(projectRoot, "node_modules", "@rhwp", "core") });
  const pages = await renderer.extract(await import("node:fs/promises").then((fs) => fs.readFile(path.join(projectRoot, "test_data", "전남광주통합특별시_대전환의_길_교통.hwpx"))), {
    recognizeRenderedPage: async (svg) => svg.startsWith("<svg") ? "OO시 인구" : "",
  });

  assert.equal(pages[0].visualAssets[0].name, "page-1.svg");
  assert.equal(pages[0].visualAssets[0].ocrText, "OO시 인구");
});

test("document renderer OCRs embedded rendered-page images as visual evidence", async () => {
  const renderer = await createDocumentRenderer({ componentPath: path.join(projectRoot, "node_modules", "@rhwp", "core") });
  const pages = await renderer.extract(await import("node:fs/promises").then((fs) => fs.readFile(path.join(projectRoot, "test_data", "전남광주통합특별시_대전환의_길_교통.hwpx"))), {
    recognizeVisualAsset: async (_bytes, metadata) => metadata.page === 4 ? "노선도 변경구간" : "",
  });

  const pageWithVisual = pages.find((page) => page.page === 4);
  assert.ok(pageWithVisual.visualAssets.some((asset) => asset.ocrText === "노선도 변경구간"));
  assert.match(pageWithVisual.text, /노선도 변경구간/);
});

test("merges native and OCR text without duplicating identical content", () => {
  assert.equal(mergeNativeAndOcr("광화문 버스", "광화문 버스"), "광화문 버스");
  assert.equal(mergeNativeAndOcr("광화문 버스", "광화문 버스 노선"), "광화문 버스 광화문 버스 노선");
});

test("chunks long page text with bounded size and overlap", () => {
  const chunks = chunkText(Array.from({ length: 800 }, (_, index) => `token${index}`).join(" "), { maxTokens: 384, overlapTokens: 64 });
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((chunk) => chunk.tokens <= 384));
  assert.equal(chunks[0].text.split(" ").at(-64), chunks[1].text.split(" ")[0]);
});

test("builds text, table and visual evidence with provenance and asset hash", () => {
  const fragments = buildEvidenceFragments({
    documentId: "d1", page: 4, nativeText: "제목 본문", ocrText: "도표 OCR",
    table: { headers: ["항목", "값"], rows: [["버스", "10"]] },
    visualAssets: [{ name: "image.png", mime: "image/png", bytes: Buffer.from("image"), ocrText: "차트" }],
  });
  assert.equal(fragments.find((item) => item.type === "text").pageStart, 4);
  assert.match(fragments.find((item) => item.type === "table").context, /항목/);
  assert.match(fragments.find((item) => item.type === "visual").assetHash, /^[a-f0-9]{64}$/);
});
