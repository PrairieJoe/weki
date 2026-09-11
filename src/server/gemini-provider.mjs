const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export const GEMINI_MAX_TEXT_UTF16_CHARS = 12_000;
export const GEMINI_MAX_IMAGES = 4;
export const GEMINI_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const GEMINI_MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024;
export const GEMINI_MAX_KEYWORDS = 12;
export const GEMINI_MAX_SUMMARY_CHARS = 2_000;
export const GEMINI_MAX_TOPIC_CHARS = 200;
export const GEMINI_MAX_KEYWORD_CHARS = 100;
export const GEMINI_MAX_VISUAL_DESCRIPTION_CHARS = 1_000;
export const GEMINI_MAX_ASSET_NAME_CHARS = 255;

const GEMINI_ENRICH_INSTRUCTION = "Return JSON with exactly these fields: summary, topic, keywords, and visualDescriptions for the supplied page.";

export const GEMINI_RESPONSE_SCHEMA = Object.freeze({
  type: "OBJECT",
  properties: {
    summary: { type: "STRING", maxLength: GEMINI_MAX_SUMMARY_CHARS },
    topic: { type: "STRING", maxLength: GEMINI_MAX_TOPIC_CHARS },
    keywords: { type: "ARRAY", maxItems: GEMINI_MAX_KEYWORDS, items: { type: "STRING", maxLength: GEMINI_MAX_KEYWORD_CHARS } },
    visualDescriptions: {
      type: "ARRAY",
      maxItems: GEMINI_MAX_IMAGES,
      items: {
        type: "OBJECT",
        properties: {
          assetName: { type: "STRING", maxLength: GEMINI_MAX_ASSET_NAME_CHARS },
          description: { type: "STRING", maxLength: GEMINI_MAX_VISUAL_DESCRIPTION_CHARS },
        },
        required: ["assetName", "description"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "topic", "keywords", "visualDescriptions"],
  additionalProperties: false,
});

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

function base64ByteLength(value) {
  const normalized = value.replace(/\s/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) return Infinity;
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.floor(normalized.length * 3 / 4) - padding;
}

export function buildGeminiPageInput({ page, text, images } = {}) {
  const sourceImages = Array.isArray(images) ? images : [];
  const selectedImages = [];
  let totalImageBytes = 0;
  let excludedImageCount = 0;
  for (const image of sourceImages) {
    const imageBytes = typeof image?.base64 === "string" && typeof image?.mimeType === "string" ? base64ByteLength(image.base64) : Infinity;
    if (
      selectedImages.length >= GEMINI_MAX_IMAGES
      || imageBytes > GEMINI_MAX_IMAGE_BYTES
      || totalImageBytes + imageBytes > GEMINI_MAX_TOTAL_IMAGE_BYTES
    ) {
      excludedImageCount += 1;
      continue;
    }
    selectedImages.push({
      name: typeof image.name === "string" ? image.name : "",
      mimeType: image.mimeType,
      base64: image.base64,
    });
    totalImageBytes += imageBytes;
  }
  const pageNumber = typeof page === "number" ? page : page?.page ?? page?.number;
  return {
    ...(typeof pageNumber === "number" ? { page: pageNumber } : {}),
    text: typeof text === "string" ? text.slice(0, GEMINI_MAX_TEXT_UTF16_CHARS) : "",
    images: selectedImages,
    excludedImageCount,
    includedImageCount: selectedImages.length,
    totalImageBytes,
  };
}

export function validateGeneratedMetadata(value, { maxVisualDescriptions = GEMINI_MAX_IMAGES } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw providerError("external_ai_invalid_response");
  const { summary, topic, keywords, visualDescriptions } = value;
  if (typeof summary !== "string" || typeof topic !== "string" || !Array.isArray(keywords) || !Array.isArray(visualDescriptions)) {
    throw providerError("external_ai_invalid_response");
  }
  if (!keywords.every((item) => typeof item === "string") || !visualDescriptions.every((item) => (
    item && typeof item === "object" && typeof item.assetName === "string" && typeof item.description === "string"
  ))) {
    throw providerError("external_ai_invalid_response");
  }
  return {
    summary: summary.slice(0, GEMINI_MAX_SUMMARY_CHARS),
    topic: topic.slice(0, GEMINI_MAX_TOPIC_CHARS),
    keywords: keywords.slice(0, GEMINI_MAX_KEYWORDS).map((keyword) => keyword.slice(0, GEMINI_MAX_KEYWORD_CHARS)),
    visualDescriptions: visualDescriptions.slice(0, maxVisualDescriptions).map(({ assetName, description }) => ({
      assetName: assetName.slice(0, GEMINI_MAX_ASSET_NAME_CHARS),
      description: description.slice(0, GEMINI_MAX_VISUAL_DESCRIPTION_CHARS),
    })),
  };
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

    async enrichPage(input = {}) {
      const payload = buildGeminiPageInput(input);
      const parts = [{ text: GEMINI_ENRICH_INSTRUCTION }, { text: payload.text }];
      for (const image of payload.images) {
        if (typeof image.mimeType === "string") {
          parts.push({ inlineData: { mimeType: image.mimeType, data: image.base64 } });
        }
      }
      try {
        const response = await generate({
          contents: [{ role: "user", parts }],
          generationConfig: { responseMimeType: "application/json", responseSchema: GEMINI_RESPONSE_SCHEMA },
        });
        const responseText = response?.candidates?.[0]?.content?.parts?.find((part) => typeof part?.text === "string")?.text;
        return validateGeneratedMetadata(extractJson(responseText), { maxVisualDescriptions: payload.images.length });
      } finally {
        payload.images.length = 0;
        for (const part of parts) {
          if (part.inlineData) delete part.inlineData.data;
        }
      }
    },
  };
}
