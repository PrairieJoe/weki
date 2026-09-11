import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";

import {
  GEMINI_MAX_ASSET_NAME_CHARS,
  GEMINI_MAX_IMAGE_BYTES,
  GEMINI_MAX_KEYWORD_CHARS,
  GEMINI_MAX_SUMMARY_CHARS,
  GEMINI_MAX_TEXT_UTF16_CHARS,
  GEMINI_MAX_TOPIC_CHARS,
  GEMINI_MAX_VISUAL_DESCRIPTION_CHARS,
  validateGeneratedMetadata as providerMetadataValidator,
} from "../src/server/gemini-provider.mjs";
import { collectZipVisualAssets } from "../src/processing/visual-assets.mjs";
import { buildPdfVisualAsset } from "../src/processing/pdf-visual.mjs";
import { createSearchStore } from "../src/search/sqlite-store.mjs";
import { createSearchService } from "../src/search/service.mjs";

const image = (name, byteLength, importance) => ({ name, mime: "image/png", bytes: Buffer.alloc(byteLength, 1), importance });

test("buildGeminiPageInput caps UTF-16 text and prioritizes bounded image bytes without deleting source assets", async () => {
  const { buildGeminiPageInput } = await import("../src/server/ai-processing.mjs");
  const page = {
    page: 7,
    text: "x".repeat(GEMINI_MAX_TEXT_UTF16_CHARS + 5),
    visualAssets: [
      image("page-render.png", GEMINI_MAX_IMAGE_BYTES, 100),
      image("oversized.png", GEMINI_MAX_IMAGE_BYTES + 1, 90),
      image("chart-a.png", GEMINI_MAX_IMAGE_BYTES, 50),
      image("chart-b.png", GEMINI_MAX_IMAGE_BYTES, 50),
      image("chart-c.png", GEMINI_MAX_IMAGE_BYTES, 10),
      image("count-capped.png", 1, 1),
    ],
  };

  const input = buildGeminiPageInput(page);

  assert.equal(input.page, 7);
  assert.equal(input.text.length, GEMINI_MAX_TEXT_UTF16_CHARS);
  assert.deepEqual(input.images.map(({ name }) => name), ["page-render.png", "chart-a.png", "chart-b.png", "chart-c.png"]);
  assert.equal(input.totalImageBytes, 8 * 1024 * 1024);
  assert.equal(input.excludedImageCount, 2);
  assert.ok(input.images.every(({ base64 }) => Buffer.from(base64, "base64").byteLength <= GEMINI_MAX_IMAGE_BYTES));
  assert.equal(page.visualAssets.length, 6);
  assert.ok(page.visualAssets.every(({ bytes }) => Buffer.isBuffer(bytes)));
});

test("GeneratedMetadata uses the provider validator boundary and auxiliary text excludes original evidence", async () => {
  const { validateGeneratedMetadata, buildSearchAuxiliaryText } = await import("../src/server/ai-processing.mjs");
  assert.equal(validateGeneratedMetadata, providerMetadataValidator);
  const metadata = validateGeneratedMetadata({
    summary: "s".repeat(GEMINI_MAX_SUMMARY_CHARS + 1),
    topic: "t".repeat(GEMINI_MAX_TOPIC_CHARS + 1),
    keywords: [...Array.from({ length: 12 }, (_, index) => `keyword-${index}`), "discard"],
    visualDescriptions: [{
      assetName: "a".repeat(GEMINI_MAX_ASSET_NAME_CHARS + 1),
      description: "d".repeat(GEMINI_MAX_VISUAL_DESCRIPTION_CHARS + 1),
      ignored: "discard",
    }],
    ignored: "discard",
  });

  assert.equal(metadata.summary.length, GEMINI_MAX_SUMMARY_CHARS);
  assert.equal(metadata.topic.length, GEMINI_MAX_TOPIC_CHARS);
  assert.equal(metadata.keywords.length, 12);
  assert.ok(metadata.keywords.every((keyword) => keyword.length <= GEMINI_MAX_KEYWORD_CHARS));
  assert.deepEqual(Object.keys(metadata), ["summary", "topic", "keywords", "visualDescriptions"]);
  assert.deepEqual(Object.keys(metadata.visualDescriptions[0]), ["assetName", "description"]);
  assert.equal(metadata.visualDescriptions[0].assetName.length, GEMINI_MAX_ASSET_NAME_CHARS);
  assert.equal(metadata.visualDescriptions[0].description.length, GEMINI_MAX_VISUAL_DESCRIPTION_CHARS);
  assert.equal(buildSearchAuxiliaryText({
    summary: "Generated summary\nwith spacing",
    topic: "Generated topic",
    keywords: ["one", "two"],
    visualDescriptions: [{ assetName: "chart.png", description: "Generated chart description" }],
  }), "Generated summary with spacing Generated topic one two Generated chart description");
  assert.doesNotMatch(buildSearchAuxiliaryText(metadata), /original evidence/i);
});

test("enrichPagesForSearch preserves evidence, clears transient payloads, and emits one safe success audit", async () => {
  const { enrichPagesForSearch } = await import("../src/server/ai-processing.mjs");
  const evidence = [{ id: "doc-1:p3:text:0", pageStart: 3, pageEnd: 3, context: "original evidence" }];
  const page = {
    documentId: "doc-1",
    page: 3,
    text: "original text",
    nativeText: "native text",
    ocrText: "ocr text",
    evidence,
    visualAssets: [{ name: "chart.png", mime: "image/png", bytes: Buffer.from("chart"), ocrText: "chart OCR" }],
  };
  let retainedPayload;
  const observedAudits = [];
  const provider = {
    provider: "gemini",
    modelId: "gemini-test",
    async enrichPage(input) {
      retainedPayload = input;
      assert.equal(input.images.length, 1);
      assert.equal(Buffer.from(input.images[0].base64, "base64").toString(), "chart");
      return { summary: "summary", topic: "topic", keywords: ["keyword"], visualDescriptions: [{ assetName: "chart.png", description: "chart description" }], ignored: "discard" };
    },
  };

  const result = await enrichPagesForSearch([page], {
    provider,
    now: () => "2026-09-11T01:02:03.000Z",
    onAudit: (audit) => observedAudits.push(audit),
  });

  assert.equal(result.pages[0].text, "original text");
  assert.equal(result.pages[0].nativeText, "native text");
  assert.equal(result.pages[0].ocrText, "ocr text");
  assert.deepEqual(result.pages[0].evidence, evidence);
  assert.deepEqual(result.pages[0].generatedMetadata, {
    summary: "summary", topic: "topic", keywords: ["keyword"], visualDescriptions: [{ assetName: "chart.png", description: "chart description" }],
  });
  assert.equal(result.pages[0].searchAuxiliaryText, "summary topic keyword chart description");
  assert.equal(result.pages[0].visualAssets[0].name, "chart.png");
  assert.doesNotMatch(JSON.stringify(result.pages), /"bytes"|"base64"/u);
  assert.equal(retainedPayload.images.length, 0);
  assert.deepEqual(page.evidence, evidence);
  assert.equal(page.visualAssets[0].bytes.toString(), "chart");
  assert.equal(result.audits.length, 1);
  assert.deepEqual(observedAudits, result.audits);
  assert.deepEqual(result.audits[0], {
    documentId: "doc-1",
    page: 3,
    provider: "gemini",
    model: "gemini-test",
    timestamp: "2026-09-11T01:02:03.000Z",
    status: "success",
    errorCode: null,
    dataType: "text+image",
    excludedImageCount: 0,
  });
  assert.doesNotMatch(JSON.stringify(result.audits), /original text|native text|ocr text|chart description|base64|prompt|api.?key/i);
});

test("enrichPagesForSearch records safe failure audits and preserves the existing fallback link", async () => {
  const { enrichPagesForSearch } = await import("../src/server/ai-processing.mjs");
  const page = { documentId: "doc-2", page: 8, text: "secret original full text", nativeText: "native", ocrText: "", evidence: [], processingModeFallback: "external_ai_unavailable" };
  const provider = {
    provider: "gemini",
    model: "gemini-test",
    async enrichPage() { throw Object.assign(new Error("prompt and api key leaked here"), { code: "external_ai_timeout" }); },
  };

  const result = await enrichPagesForSearch([page], { provider, now: () => "2026-09-11T02:03:04.000Z" });

  assert.equal(result.pages[0].text, page.text);
  assert.equal(result.pages[0].nativeText, page.nativeText);
  assert.equal(result.pages[0].generatedMetadata, undefined);
  assert.deepEqual(result.audits, [{
    documentId: "doc-2",
    page: 8,
    provider: "gemini",
    model: "gemini-test",
    timestamp: "2026-09-11T02:03:04.000Z",
    status: "failed",
    errorCode: "external_ai_timeout",
    dataType: "text",
    excludedImageCount: 0,
    processingModeFallback: "external_ai_unavailable",
  }]);
  assert.doesNotMatch(JSON.stringify(result.audits), /secret|prompt|api.?key|full text/i);
});

test("PDF, PPTX, and HWPX visual assets retain bytes until preprocessing", async () => {
  const pdfBytes = Buffer.from("pdf-page-png");
  assert.equal(buildPdfVisualAsset({ page: 1, bytes: pdfBytes }).bytes, pdfBytes);

  for (const [format, assetPath] of [["pptx", "ppt/media/chart.png"], ["hwpx", "Contents/BinData/chart.png"]]) {
    const zip = new JSZip();
    zip.file(assetPath, Buffer.from(`${format}-image`));
    const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: "nodebuffer" }));
    const assets = await collectZipVisualAssets(loaded, format, { recognize: async () => `${format} OCR`, preserveBytes: true });
    assert.equal(assets[0].name, "chart.png");
    assert.equal(assets[0].mimeType, "image/png");
    assert.equal(assets[0].bytes.toString(), `${format}-image`);
    assert.equal(assets[0].ocrText, `${format} OCR`);
  }
});

test("stripEphemeralImageData removes nested bytes and base64 immediately before persistence", async () => {
  const { stripEphemeralImageData } = await import("../src/server/ai-processing.mjs");
  const value = {
    text: "evidence",
    visualAssets: [{ name: "page.png", bytes: Buffer.from("page"), base64: "cGFnZQ==", embeddedAssets: [{ name: "chart.png", bytes: Buffer.from("chart") }] }],
  };

  const persistable = stripEphemeralImageData(value);

  assert.equal(persistable.text, "evidence");
  assert.equal(persistable.visualAssets[0].name, "page.png");
  assert.equal(persistable.visualAssets[0].embeddedAssets[0].name, "chart.png");
  assert.doesNotMatch(JSON.stringify(persistable), /"bytes"|"base64"/u);
  assert.equal(value.visualAssets[0].bytes.toString(), "page");
});

test("SQLite persists generated metadata separately and matches auxiliary text without changing evidence", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "weki-ai-index-"));
  const store = createSearchStore({ directory });
  t.after(async () => { store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  store.upsertDocument({ id: "doc-1", name: "evidence.pdf", format: "pdf" });
  store.upsertEvidenceFragment({ id: "evidence-1", documentId: "doc-1", pageStart: 4, pageEnd: 4, type: "text", origin: "native", context: "authoritative original evidence" });
  store.upsertKnowledgeUnit({
    id: "unit-1",
    documentId: "doc-1",
    title: "Evidence",
    text: "authoritative original evidence",
    nativeText: "authoritative native evidence",
    ocrText: "authoritative OCR evidence",
    sourceRange: 4,
    evidenceIds: ["evidence-1"],
    generatedMetadata: { summary: "rare auxiliary phrase", topic: "topic", keywords: [], visualDescriptions: [] },
    searchAuxiliaryText: "rare auxiliary phrase topic",
  });

  const matches = store.searchLexical("rare auxiliary");
  assert.equal(matches.length, 1);
  const [unit] = store.hydrateUnits([matches[0].unitId]);
  assert.equal(unit.text, "authoritative original evidence");
  assert.equal(unit.nativeText, "authoritative native evidence");
  assert.equal(unit.ocrText, "authoritative OCR evidence");
  assert.equal(unit.searchAuxiliaryText, "rare auxiliary phrase topic");
  assert.deepEqual(unit.generatedMetadata, { summary: "rare auxiliary phrase", topic: "topic", keywords: [], visualDescriptions: [] });
  assert.deepEqual(unit.evidence, [{ id: "evidence-1", pageStart: 4, pageEnd: 4, type: "text", origin: "native", assetName: null, context: "authoritative original evidence" }]);

  const service = createSearchService({ store });
  const response = await service.search({ query: "rare auxiliary", includeContext: true });
  assert.equal(response.results.length, 1);
  assert.equal(response.results[0].matchedEvidence.context, "authoritative original evidence");
  assert.equal(response.contextPack.citations[0].text, "authoritative original evidence");
  assert.doesNotMatch(JSON.stringify(response.results[0].matchedEvidence), /rare auxiliary/u);
});

function bmpFixture() {
  const bytes = Buffer.alloc(58);
  bytes.write("BM", 0, "ascii");
  bytes.writeUInt32LE(58, 2);
  bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(1, 18);
  bytes.writeInt32LE(1, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28);
  bytes.writeUInt32LE(4, 34);
  bytes.writeUInt32LE(2835, 38);
  bytes.writeUInt32LE(2835, 42);
  bytes[54] = 255;
  return bytes;
}

function tiffFixture() {
  const bytes = Buffer.alloc(195);
  bytes.writeUInt16LE(0x4949, 0);
  bytes.writeUInt16LE(42, 2);
  bytes.writeUInt32LE(8, 4);
  bytes.writeUInt16LE(13, 8);
  const entries = [
    [256, 3, 1, 1],
    [257, 3, 1, 1],
    [258, 3, 3, 170],
    [259, 3, 1, 1],
    [262, 3, 1, 2],
    [273, 4, 1, 192],
    [277, 3, 1, 3],
    [278, 4, 1, 1],
    [279, 4, 1, 3],
    [282, 5, 1, 176],
    [283, 5, 1, 184],
    [284, 3, 1, 1],
  ];
  for (const [index, [tag, type, count, value]] of entries.entries()) {
    const offset = 10 + index * 12;
    bytes.writeUInt16LE(tag, offset);
    bytes.writeUInt16LE(type, offset + 2);
    bytes.writeUInt32LE(count, offset + 4);
    if (type === 3 && count === 1) bytes.writeUInt16LE(value, offset + 8);
    else bytes.writeUInt32LE(value, offset + 8);
  }
  bytes.writeUInt32LE(0, 166);
  bytes.writeUInt16LE(8, 170);
  bytes.writeUInt16LE(8, 172);
  bytes.writeUInt16LE(8, 174);
  bytes.writeUInt32LE(72, 176);
  bytes.writeUInt32LE(1, 180);
  bytes.writeUInt32LE(72, 184);
  bytes.writeUInt32LE(1, 188);
  bytes[192] = 255;
  return bytes;
}

test("real Gemini enrichment sends only supported raster MIME types after converting or excluding SVG/BMP/TIFF", async () => {
  const { createGeminiProvider } = await import("../src/server/gemini-provider.mjs");
  const { enrichPagesForSearch } = await import("../src/server/ai-processing.mjs");
  const requests = [];
  const provider = createGeminiProvider({
    apiKey: "secret-api-key",
    modelId: "gemini-test",
    baseUrl: "https://gemini.test/v1beta",
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"summary":"ok","topic":"topic","keywords":[],"visualDescriptions":[]}' }] } }] }));
    },
  });
  const page = {
    documentId: "doc-raster",
    page: 1,
    text: "source text",
    nativeText: "source native",
    ocrText: "source OCR",
    evidence: [{ id: "source-evidence", pageStart: 1, pageEnd: 1, context: "source evidence" }],
    visualAssets: [
      { name: "diagram.svg", mime: "image/svg+xml", bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>') },
      { name: "pixel.bmp", mime: "image/bmp", bytes: bmpFixture() },
      { name: "scan.tiff", mime: "image/tiff", bytes: tiffFixture() },
    ],
  };
  const originalAssets = page.visualAssets.map((asset) => ({ name: asset.name, bytes: Buffer.from(asset.bytes) }));

  const result = await enrichPagesForSearch([page], { provider, now: () => "2026-09-11T03:04:05.000Z" });

  const inlineImages = requests[0].contents[0].parts.filter((part) => part.inlineData).map((part) => part.inlineData);
  assert.equal(inlineImages.length, 2);
  assert.ok(inlineImages.every(({ mimeType }) => ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"].includes(mimeType)));
  assert.ok(inlineImages.every(({ mimeType, data }) => mimeType !== "image/png" || Buffer.from(data, "base64").subarray(0, 8).toString("hex") === "89504e470d0a1a0a"));
  assert.deepEqual(page.visualAssets.map((asset) => ({ name: asset.name, bytes: asset.bytes })), originalAssets);
  assert.deepEqual(result.pages[0].visualAssets.map(({ name }) => name), ["diagram.svg", "pixel.bmp", "scan.tiff"]);
  assert.equal(result.audits[0].model, "gemini-test");
  assert.ok(result.audits[0].excludedImageCount >= 1);
  assert.ok(result.audits[0].excludedImageReasons.includes("image_conversion_failed"));
  assert.doesNotMatch(JSON.stringify(requests[0]), /image\/svg\+xml|image\/bmp|image\/tiff/u);
});

test("real Gemini provider identity is immutable and is retained in success and failure audits", async () => {
  const { createGeminiProvider } = await import("../src/server/gemini-provider.mjs");
  const { enrichPagesForSearch } = await import("../src/server/ai-processing.mjs");
  const provider = createGeminiProvider({
    apiKey: "secret-api-key",
    modelId: "gemini-test",
    baseUrl: "https://gemini.test/v1beta",
    fetchImpl: async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"summary":"ok","topic":"topic","keywords":[],"visualDescriptions":[]}' }] } }] })),
  });

  assert.equal(provider.provider, "gemini");
  assert.equal(provider.modelId, "gemini-test");
  assert.equal(Object.isFrozen(provider), true);
  const success = await enrichPagesForSearch([{ documentId: "doc", page: 1, text: "text" }], { provider, now: () => "2026-09-11T04:05:06.000Z" });
  const failure = await enrichPagesForSearch([{ documentId: "doc", page: 2, text: "text" }], {
    provider: Object.freeze({ ...provider, async enrichPage() { throw Object.assign(new Error("provider failure"), { code: "external_ai_timeout" }); } }),
    now: () => "2026-09-11T04:05:07.000Z",
  });
  assert.equal(success.audits[0].model, "gemini-test");
  assert.equal(failure.audits[0].model, "gemini-test");
});

test("buildGeminiPageInput encodes only assets selected by byte and count caps", async () => {
  const { buildGeminiPageInput } = await import("../src/server/ai-processing.mjs");
  let encoded = 0;
  const page = {
    page: 9,
    text: "text",
    visualAssets: [
      image("too-large.png", GEMINI_MAX_IMAGE_BYTES + 1, 100),
      image("one.png", GEMINI_MAX_IMAGE_BYTES, 90),
      image("two.png", GEMINI_MAX_IMAGE_BYTES, 80),
      image("three.png", GEMINI_MAX_IMAGE_BYTES, 70),
      image("four.png", GEMINI_MAX_IMAGE_BYTES, 60),
      image("excluded-by-count.png", 1, 50),
    ],
  };

  const input = buildGeminiPageInput(page, { encodeImage: (bytes) => { encoded += 1; return bytes.toString("base64"); } });

  assert.equal(encoded, 4);
  assert.deepEqual(input.images.map(({ name }) => name), ["one.png", "two.png", "three.png", "four.png"]);
  assert.equal(input.excludedImageCount, 2);
  assert.equal(input.totalImageBytes, 8 * 1024 * 1024);
});
