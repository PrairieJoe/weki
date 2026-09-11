const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

function providerError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function modelIdFromName(name) {
  return typeof name === "string" ? name.replace(/^models\//, "") : "";
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw providerError("external_ai_invalid_response");
  }
}

function extractJson(text) {
  if (typeof text !== "string") throw providerError("external_ai_invalid_response");
  const fenced = text.match(/^\s*```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i);
  return parseJson(fenced ? fenced[1] : text.trim());
}

function normalizeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw providerError("external_ai_invalid_response");
  const { summary, topic, keywords, visualDescriptions } = value;
  if (typeof summary !== "string" || typeof topic !== "string" || !Array.isArray(keywords) || !Array.isArray(visualDescriptions)) {
    throw providerError("external_ai_invalid_response");
  }
  if (!keywords.every((item) => typeof item === "string") || !visualDescriptions.every((item) => typeof item === "string")) {
    throw providerError("external_ai_invalid_response");
  }
  return { summary, topic, keywords, visualDescriptions };
}

function codeForStatus(status) {
  if (status === 401) return "external_ai_invalid_key";
  if (status === 403) return "external_ai_permission_denied";
  if (status === 429) return "external_ai_rate_limited";
  return "external_ai_provider_error";
}

export function createGeminiProvider({
  apiKey,
  modelId,
  fetchImpl = globalThis.fetch,
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = 30000,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");

  const request = async (path, options = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const url = `${baseUrl.replace(/\/$/, "")}${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(apiKey ?? "")}`;
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal });
      if (!response?.ok) throw providerError(codeForStatus(response?.status));
      return parseJson(await response.text());
    } catch (error) {
      if (error?.name === "AbortError" || controller.signal.aborted) throw providerError("external_ai_timeout");
      if (error?.code) throw error;
      throw providerError("external_ai_provider_error");
    } finally {
      clearTimeout(timeout);
    }
  };

  const selectedModel = () => {
    if (!modelId) throw providerError("external_ai_model_not_selected");
    return modelId;
  };

  const generate = (body) => request(`/models/${encodeURIComponent(selectedModel())}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  return {
    async listModels() {
      const response = await request("/models");
      if (!Array.isArray(response.models)) throw providerError("external_ai_invalid_response");
      return response.models
        .filter((model) => Array.isArray(model.supportedGenerationMethods) && model.supportedGenerationMethods.includes("generateContent"))
        .map((model) => ({ id: modelIdFromName(model.name), displayName: model.displayName ?? modelIdFromName(model.name), supportsGenerateContent: true }))
        .filter((model) => model.id);
    },

    async checkConnection() {
      selectedModel();
      await generate({ contents: [{ role: "user", parts: [{ text: "ping" }] }], generationConfig: { maxOutputTokens: 1 } });
      return { status: "ready", provider: "gemini", modelId };
    },

    async enrichPage({ text, images } = {}) {
      const parts = [{ text: typeof text === "string" ? text : "" }];
      for (const image of Array.isArray(images) ? images : []) {
        if (typeof image?.mimeType === "string" && typeof image?.base64 === "string") {
          parts.push({ inlineData: { mimeType: image.mimeType, data: image.base64 } });
        }
      }
      const response = await generate({
        contents: [{ role: "user", parts }],
        generationConfig: { responseMimeType: "application/json" },
      });
      const responseText = response?.candidates?.[0]?.content?.parts?.find((part) => typeof part?.text === "string")?.text;
      return normalizeMetadata(extractJson(responseText));
    },
  };
}
