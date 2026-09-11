import assert from "node:assert/strict";
import test from "node:test";

test("Gemini provider sends safe model, connection, and enrich payloads", async () => {
  const { createGeminiProvider, buildGeminiPageInput } = await import("../src/providers/gemini-provider.mjs");
  const requests = [];
  const provider = createGeminiProvider({ apiKey: "secret", modelId: "gemini-2.5-flash", fetch: async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ models: [{ name: "models/gemini-2.5-flash" }] }), { status: 200 });
  }});
  await provider.listModels();
  await provider.checkConnection();
  await provider.enrich({ text: "page text", images: [{ mimeType: "image/png", data: "allowed" }, { mimeType: "image/png", data: "drop" }] });
  assert.equal(requests[0].body, undefined);
  assert.equal(requests[1].body.contents[0].parts[0].text, "ping");
  assert.deepEqual(requests[2].body.contents[0].parts, [{ text: "page text" }, { inlineData: { mimeType: "image/png", data: "allowed" } }]);
  assert.deepEqual(buildGeminiPageInput({ text: "page text", images: [{ mimeType: "image/png", data: "allowed" }] }), { text: "page text", images: [{ mimeType: "image/png", data: "allowed" }] });
});

test("Gemini provider maps HTTP and malformed JSON errors to safe error codes", async () => {
  const { createGeminiProvider } = await import("../src/providers/gemini-provider.mjs");
  for (const response of [new Response("not-json", { status: 502 }), new Response("{", { status: 200 })]) {
    const provider = createGeminiProvider({ apiKey: "secret", fetch: async () => response });
    await assert.rejects(() => provider.listModels(), (error) => ["external_ai_http_error", "external_ai_invalid_response"].includes(error.code));
  }
});
