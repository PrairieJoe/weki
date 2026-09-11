import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = "https://gemini.test/v1beta";
const apiKey = "secret-api-key";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

async function createProvider(options = {}) {
  const { createGeminiProvider } = await import("../src/server/gemini-provider.mjs");
  return createGeminiProvider({ apiKey, baseUrl, modelId: "gemini-2.5-flash", ...options });
}

test("Gemini provider uses REST endpoints and sends only permitted page content", async () => {
  const requests = [];
  const provider = await createProvider({
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options, body: options.body && JSON.parse(options.body) });
      if (url.includes("/models?")) {
        return jsonResponse({ models: [
          { name: "models/gemini-2.5-flash", displayName: "Flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/text-embedding-004", displayName: "Embedding", supportedGenerationMethods: ["embedContent"] },
          { name: "models/no-capability", displayName: "No capability" },
        ] });
      }
      return jsonResponse({ candidates: [{ content: { parts: [{ text: '{"summary":"Short","topic":"Topic","keywords":["one"],"visualDescriptions":[{"assetName":"chart.png","description":"chart"}],"ignored":true}' }] } }] });
    },
  });

  assert.deepEqual(await provider.listModels(), [{ id: "gemini-2.5-flash", displayName: "Flash", supportsGenerateContent: true }]);
  assert.deepEqual(await provider.checkConnection(), { status: "ready", provider: "gemini", modelId: "gemini-2.5-flash" });
  assert.deepEqual(await provider.enrichPage({
    page: { id: "page-1", document: "must not leave the process" },
    text: "page text",
    images: [{ name: "chart.png", mimeType: "image/png", base64: "allowed" }],
  }), { summary: "Short", topic: "Topic", keywords: ["one"], visualDescriptions: [{ assetName: "chart.png", description: "chart" }] });

  assert.match(requests[0].url, /^https:\/\/gemini\.test\/v1beta\/models\?key=secret-api-key$/);
  assert.equal(requests[0].options.body, undefined);
  assert.deepEqual(requests[1].body.contents, [{ role: "user", parts: [{ text: "ping" }] }]);
  assert.doesNotMatch(JSON.stringify(requests[1].body), /secret-api-key|page text|document/i);
  assert.match(requests[2].body.contents[0].parts[0].text, /return JSON/i);
  assert.match(requests[2].body.contents[0].parts[0].text, /summary.*topic.*keywords.*visualDescriptions/i);
  assert.doesNotMatch(requests[2].body.contents[0].parts[0].text, /page text|document|nativeText|ocrText/i);
  assert.deepEqual(requests[2].body.contents[0].parts.slice(1), [
    { text: "page text" },
    { inlineData: { mimeType: "image/png", data: "allowed" } },
  ]);
  assert.equal(requests[2].body.generationConfig.responseMimeType, "application/json");
  const schema = requests[2].body.generationConfig.responseSchema;
  assert.deepEqual(Object.keys(schema.properties), ["summary", "topic", "keywords", "visualDescriptions"]);
  assert.deepEqual(schema.required, ["summary", "topic", "keywords", "visualDescriptions"]);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties.visualDescriptions.items.properties), ["assetName", "description"]);
  assert.equal(schema.properties.visualDescriptions.items.additionalProperties, false);
  for (const request of requests) {
    assert.doesNotMatch(JSON.stringify(request.options.headers ?? {}), /secret-api-key/i);
    assert.doesNotMatch(JSON.stringify(request.body ?? {}), /secret-api-key/i);
  }
});

test("Gemini provider safely extracts fenced structured JSON", async () => {
  const provider = await createProvider({
    fetchImpl: async () => jsonResponse({ candidates: [{ content: { parts: [{ text: "```json\n{\"summary\":\"Summary\",\"topic\":\"Topic\",\"keywords\":[\"one\"],\"visualDescriptions\":[{\"assetName\":\"image.png\",\"description\":\"image\"}],\"extra\":\"discard\"}\n```" }] } }] }),
  });

  assert.deepEqual(await provider.enrichPage({ page: {}, text: "text", images: [{ name: "image.png", mimeType: "image/png", base64: "aGVsbG8=" }] }), {
    summary: "Summary", topic: "Topic", keywords: ["one"], visualDescriptions: [{ assetName: "image.png", description: "image" }],
  });
});

test("Gemini provider caps serialized text and image payloads and reports excluded images", async () => {
  const { buildGeminiPageInput, GEMINI_MAX_TEXT_UTF16_CHARS, GEMINI_MAX_IMAGES, GEMINI_MAX_IMAGE_BYTES, GEMINI_MAX_TOTAL_IMAGE_BYTES } = await import("../src/server/gemini-provider.mjs");
  const requests = [];
  const provider = await createProvider({
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return jsonResponse({ candidates: [{ content: { parts: [{ text: '{"summary":"ok","topic":"ok","keywords":[],"visualDescriptions":[]}' }] } }] });
    },
  });
  assert.equal(GEMINI_MAX_TEXT_UTF16_CHARS, 12_000);
  assert.equal(GEMINI_MAX_IMAGES, 4);
  assert.equal(GEMINI_MAX_IMAGE_BYTES, 2 * 1024 * 1024);
  assert.equal(GEMINI_MAX_TOTAL_IMAGE_BYTES, 8 * 1024 * 1024);
  const maxText = GEMINI_MAX_TEXT_UTF16_CHARS;
  const maxImageBytes = GEMINI_MAX_IMAGE_BYTES;
  const image = (name, byteLength) => ({ name, mimeType: "image/png", base64: Buffer.alloc(byteLength, 1).toString("base64") });
  const images = [
    image("too-large.png", maxImageBytes + 1),
    image("one.png", maxImageBytes),
    image("two.png", maxImageBytes),
    image("three.png", maxImageBytes),
    image("four.png", maxImageBytes),
    image("excluded-by-count.png", 1),
  ];
  const input = buildGeminiPageInput({ page: { id: "page-1" }, text: "x".repeat(maxText + 5), images });
  assert.equal(input.text.length, maxText);
  assert.equal(input.images.length, 4);
  assert.equal(input.excludedImageCount, 2);

  await provider.enrichPage({ page: { id: "page-1" }, text: "x".repeat(maxText + 5), images });
  const parts = requests[0].body.contents[0].parts;
  assert.equal(parts[1].text.length, maxText);
  const serializedImages = parts.slice(2).map((part) => part.inlineData.data);
  assert.equal(serializedImages.length, 4);
  assert.ok(serializedImages.every((data) => Buffer.from(data, "base64").byteLength <= maxImageBytes));
  assert.equal(serializedImages.reduce((total, data) => total + Buffer.from(data, "base64").byteLength, 0), GEMINI_MAX_TOTAL_IMAGE_BYTES);
  assert.doesNotMatch(JSON.stringify(requests[0].body), /secret-api-key/);
});

test("Gemini provider exports the single metadata validator boundary", async () => {
  const { validateGeneratedMetadata } = await import("../src/server/gemini-provider.mjs");
  assert.deepEqual(validateGeneratedMetadata({
    summary: "Summary", topic: "Topic", keywords: ["one"],
    visualDescriptions: [{ assetName: "image.png", description: "image" }], extra: "discard",
  }), {
    summary: "Summary", topic: "Topic", keywords: ["one"],
    visualDescriptions: [{ assetName: "image.png", description: "image" }],
  });
});

test("Gemini provider bounds oversized fields at the shared normalization boundary", async () => {
  const {
    createGeminiProvider,
    GEMINI_MAX_SUMMARY_CHARS,
    GEMINI_MAX_TOPIC_CHARS,
    GEMINI_MAX_KEYWORD_CHARS,
    GEMINI_MAX_VISUAL_DESCRIPTION_CHARS,
    GEMINI_MAX_ASSET_NAME_CHARS,
  } = await import("../src/server/gemini-provider.mjs");
  const provider = createGeminiProvider({
    apiKey,
    baseUrl,
    modelId: "gemini-2.5-flash",
    fetchImpl: async () => jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      summary: "s".repeat(GEMINI_MAX_SUMMARY_CHARS + 10),
      topic: "t".repeat(GEMINI_MAX_TOPIC_CHARS + 10),
      keywords: ["k".repeat(GEMINI_MAX_KEYWORD_CHARS + 10)],
      visualDescriptions: [{
        assetName: "a".repeat(GEMINI_MAX_ASSET_NAME_CHARS + 10),
        description: "d".repeat(GEMINI_MAX_VISUAL_DESCRIPTION_CHARS + 10),
      }],
    }) }] } }] }),
  });

  const metadata = await provider.enrichPage({ page: {}, text: "page", images: [{ mimeType: "image/png", base64: "aA==" }] });
  assert.equal(metadata.summary.length, GEMINI_MAX_SUMMARY_CHARS);
  assert.equal(metadata.topic.length, GEMINI_MAX_TOPIC_CHARS);
  assert.equal(metadata.keywords[0].length, GEMINI_MAX_KEYWORD_CHARS);
  assert.equal(metadata.visualDescriptions[0].assetName.length, GEMINI_MAX_ASSET_NAME_CHARS);
  assert.equal(metadata.visualDescriptions[0].description.length, GEMINI_MAX_VISUAL_DESCRIPTION_CHARS);
});

test("Gemini provider maps provider failures to safe error codes without credential leakage", async () => {
  const cases = [[401, "external_ai_invalid_key"], [403, "external_ai_permission_denied"], [429, "external_ai_rate_limited"], [500, "external_ai_provider_error"]];
  for (const [status, code] of cases) {
    const provider = await createProvider({ fetchImpl: async () => new Response("response includes secret-api-key", { status }) });
    await assert.rejects(() => provider.listModels(), (error) => error.code === code && !String(error.message).includes(apiKey) && !String(error.stack).includes(apiKey));
  }
});

test("Gemini provider maps malformed responses and timeouts to safe codes", async () => {
  const malformed = await createProvider({ fetchImpl: async () => new Response("{", { status: 200 }) });
  await assert.rejects(() => malformed.listModels(), { code: "external_ai_invalid_response" });

  const timeout = await createProvider({ timeoutMs: 1, fetchImpl: (_url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))) });
  await assert.rejects(() => timeout.listModels(), { code: "external_ai_timeout" });
});

test("Gemini provider rejects a missing selected model without making a request", async () => {
  let called = false;
  const provider = await createProvider({ modelId: "", fetchImpl: async () => { called = true; return jsonResponse({}); } });
  await assert.rejects(() => provider.checkConnection(), { code: "external_ai_model_not_selected" });
  assert.equal(called, false);
});
