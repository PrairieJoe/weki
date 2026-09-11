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
      return jsonResponse({ candidates: [{ content: { parts: [{ text: '{"summary":"Short","topic":"Topic","keywords":["one"],"visualDescriptions":["chart"],"ignored":true}' }] } }] });
    },
  });

  assert.deepEqual(await provider.listModels(), [{ id: "gemini-2.5-flash", displayName: "Flash", supportsGenerateContent: true }]);
  assert.deepEqual(await provider.checkConnection(), { status: "ready", provider: "gemini", modelId: "gemini-2.5-flash" });
  assert.deepEqual(await provider.enrichPage({
    page: { id: "page-1", document: "must not leave the process" },
    text: "page text",
    images: [{ name: "chart.png", mimeType: "image/png", base64: "allowed" }],
  }), { summary: "Short", topic: "Topic", keywords: ["one"], visualDescriptions: ["chart"] });

  assert.match(requests[0].url, /^https:\/\/gemini\.test\/v1beta\/models\?key=secret-api-key$/);
  assert.equal(requests[0].options.body, undefined);
  assert.deepEqual(requests[1].body.contents, [{ role: "user", parts: [{ text: "ping" }] }]);
  assert.doesNotMatch(JSON.stringify(requests[1].body), /secret-api-key|page text|document/i);
  assert.deepEqual(requests[2].body.contents[0].parts, [
    { text: "page text" },
    { inlineData: { mimeType: "image/png", data: "allowed" } },
  ]);
  assert.equal(requests[2].body.generationConfig.responseMimeType, "application/json");
  for (const request of requests) {
    assert.doesNotMatch(JSON.stringify(request.options.headers ?? {}), /secret-api-key/i);
    assert.doesNotMatch(JSON.stringify(request.body ?? {}), /secret-api-key/i);
  }
});

test("Gemini provider safely extracts fenced structured JSON", async () => {
  const provider = await createProvider({
    fetchImpl: async () => jsonResponse({ candidates: [{ content: { parts: [{ text: "```json\n{\"summary\":\"Summary\",\"topic\":\"Topic\",\"keywords\":[\"one\"],\"visualDescriptions\":[\"image\"],\"extra\":\"discard\"}\n```" }] } }] }),
  });

  assert.deepEqual(await provider.enrichPage({ page: {}, text: "text", images: [] }), {
    summary: "Summary", topic: "Topic", keywords: ["one"], visualDescriptions: ["image"],
  });
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
