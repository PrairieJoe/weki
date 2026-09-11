import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { collectZipVisualAssets, extractRenderedSvgVisualAssets } from "../src/processing/visual-assets.mjs";
import { buildPdfVisualAsset, hasPdfVisualContent, renderPdfPagePng } from "../src/processing/pdf-visual.mjs";

test("extracts raster image assets from a rendered page SVG", () => {
  const bytes = Buffer.from("png-bytes");
  const svg = `<svg><image x="1" y="2" width="3" height="4" href="data:image/png;base64,${bytes.toString("base64")}"/></svg>`;
  const assets = extractRenderedSvgVisualAssets(svg, { page: 4 });

  assert.equal(assets.length, 1);
  assert.equal(assets[0].name, "page-4-image-1.png");
  assert.equal(assets[0].mime, "image/png");
  assert.deepEqual(assets[0].bytes, bytes);
  assert.equal(assets[0].source, "rendered-page");
});

test("collects DOCX and HWPX embedded image assets for OCR", async () => {
  const zip = new JSZip();
  zip.file("word/media/population-chart.png", Buffer.from("png"));
  zip.file("word/media/icon.svg", Buffer.from("svg"));
  zip.file("word/document.xml", "text");
  const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: "nodebuffer" }));
  const assets = await collectZipVisualAssets(loaded, "docx", { recognize: async () => "OO시 인구" });

  assert.deepEqual(assets, [{ name: "population-chart.png", mime: "image/png", ocrText: "OO시 인구" }]);
});

test("associates DOCX embedded images with explicit logical page breaks", async () => {
  const zip = new JSZip();
  zip.file("word/document.xml", `<w:document><w:body><w:p><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:p><w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:drawing><a:blip r:embed="rId2"/></w:drawing></w:p></w:body></w:document>`);
  zip.file("word/_rels/document.xml.rels", `<Relationships><Relationship Id="rId1" Target="media/first.png"/><Relationship Id="rId2" Target="media/second.png"/></Relationships>`);
  zip.file("word/media/first.png", Buffer.from("first-image"));
  zip.file("word/media/second.png", Buffer.from("second-image"));
  const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: "nodebuffer" }));

  const assets = await collectZipVisualAssets(loaded, "docx", { pagePaths: ["word/document.xml"], preserveBytes: true });

  assert.deepEqual(assets.map(({ name, page }) => ({ name, page })), [{ name: "first.png", page: 1 }, { name: "second.png", page: 2 }]);
  assert.deepEqual(assets.map(({ bytes }) => bytes), [Buffer.from("first-image"), Buffer.from("second-image")]);
});

test("associates HWPX embedded images with referenced sections and uses stable asset-order fallback", async () => {
  const zip = new JSZip();
  zip.file("Contents/section0.xml", `<hp:section><hc:img binaryItemIDRef="chart-a"/></hp:section>`);
  zip.file("Contents/section1.xml", `<hp:section><hc:img binaryItemIDRef="chart-b"/></hp:section>`);
  zip.file("Contents/BinData/chart-a.png", Buffer.from("chart-a"));
  zip.file("Contents/BinData/chart-b.png", Buffer.from("chart-b"));
  zip.file("Contents/BinData/unreferenced.png", Buffer.from("unreferenced"));
  const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: "nodebuffer" }));

  const assets = await collectZipVisualAssets(loaded, "hwpx", { pagePaths: ["Contents/section0.xml", "Contents/section1.xml"], preserveBytes: true });

  assert.deepEqual(assets.map(({ name, page }) => ({ name, page })), [
    { name: "chart-a.png", page: 1 },
    { name: "chart-b.png", page: 2 },
    { name: "unreferenced.png", page: 1 },
  ]);
  assert.ok(assets.every(({ bytes }) => Buffer.isBuffer(bytes)));
});

test("keeps PPTX asset names compatible with the existing visual endpoint", async () => {
  const zip = new JSZip();
  zip.file("ppt/media/chart.jpg", Buffer.from("jpg"));
  const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: "nodebuffer" }));
  const assets = await collectZipVisualAssets(loaded, "pptx", { recognize: async () => "인구 추이" });

  assert.equal(assets[0].name, "chart.jpg");
  assert.equal(assets[0].mime, "image/jpeg");
  assert.equal(assets[0].ocrText, "인구 추이");
});

test("creates a PDF page visual asset for image and vector operators", () => {
  assert.equal(hasPdfVisualContent({ fnArray: [1, 85] }), true);
  assert.equal(hasPdfVisualContent({ fnArray: [pdfjs.OPS.constructPath] }), true);
  assert.equal(hasPdfVisualContent({ fnArray: [1, 2] }), false);
  assert.deepEqual(buildPdfVisualAsset({ page: 4, bytes: Buffer.from("png"), ocrText: "도표 텍스트" }), {
    name: "page-4.png",
    mime: "image/png",
    bytes: Buffer.from("png"),
    ocrText: "도표 텍스트",
    text: "도표 텍스트",
    source: "rendered-page",
  });
});

test("renders a real PDF visual page as a previewable PNG", async () => {
  const bytes = await fs.readFile(path.join(process.cwd(), "test_data", "01 시내버스 개편 방향 및 효과, 개편사항.pdf"));
  const png = await renderPdfPagePng(bytes, 4);

  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.ok(png.length > 10_000);
});
