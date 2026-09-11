import {
  buildGeminiPageInput as capGeminiPageInput,
  GEMINI_SUPPORTED_IMAGE_MIME_TYPES,
  validateGeneratedMetadata,
} from "./gemini-provider.mjs";
import { createCanvas, loadImage } from "@napi-rs/canvas";

export { validateGeneratedMetadata };

const SAFE_ERROR_CODES = new Set([
  "external_ai_invalid_key",
  "external_ai_permission_denied",
  "external_ai_rate_limited",
  "external_ai_provider_error",
  "external_ai_timeout",
  "external_ai_invalid_response",
  "external_ai_model_not_selected",
]);

const normalizeText = (value) => String(value ?? "").replace(/\s+/gu, " ").trim();

function flattenVisualAssets(assets, output = []) {
  for (const asset of Array.isArray(assets) ? assets : []) {
    if (!asset || typeof asset !== "object") continue;
    output.push(asset);
    flattenVisualAssets(asset.embeddedAssets, output);
  }
  return output;
}

function imageBytes(asset) {
  if (Buffer.isBuffer(asset?.bytes)) return asset.bytes;
  if (asset?.bytes instanceof Uint8Array) return Buffer.from(asset.bytes.buffer, asset.bytes.byteOffset, asset.bytes.byteLength);
  return null;
}

function imageMimeType(asset) {
  return typeof asset?.mimeType === "string" ? asset.mimeType.toLowerCase() : String(asset?.mime || "").toLowerCase();
}

async function normalizeProviderAsset(asset) {
  const bytes = imageBytes(asset);
  if (!bytes) return { excludedReason: "image_bytes_missing" };
  const flatAsset = { ...asset };
  delete flatAsset.embeddedAssets;
  const mimeType = imageMimeType(asset);
  if (GEMINI_SUPPORTED_IMAGE_MIME_TYPES.includes(mimeType)) return { asset: { ...flatAsset, mimeType, bytes } };
  try {
    const image = await loadImage(bytes);
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext("2d").drawImage(image, 0, 0);
    return { asset: { ...flatAsset, mime: "image/png", mimeType: "image/png", bytes: canvas.toBuffer("image/png") } };
  } catch {
    return { excludedReason: "image_conversion_failed" };
  }
}

async function normalizeProviderAssets(page) {
  const normalized = [];
  const excludedImageReasons = [];
  for (const asset of flattenVisualAssets(page.visualAssets)) {
    const result = await normalizeProviderAsset(asset);
    if (result.asset) normalized.push(result.asset);
    else excludedImageReasons.push(result.excludedReason);
  }
  return { assets: normalized, excludedImageReasons };
}

export function buildGeminiPageInput(page = {}, { encodeImage } = {}) {
  const prioritizedAssets = flattenVisualAssets(page.visualAssets)
    .map((asset, index) => ({ asset, index, importance: Number.isFinite(Number(asset.importance)) ? Number(asset.importance) : 0 }))
    .sort((left, right) => right.importance - left.importance || left.index - right.index);
  const images = prioritizedAssets.flatMap(({ asset }) => {
    const bytes = imageBytes(asset);
    const mimeType = typeof asset.mimeType === "string" ? asset.mimeType : asset.mime;
    if (!bytes || typeof mimeType !== "string") return [];
    return [{ name: typeof asset.name === "string" ? asset.name : "", mimeType, bytes }];
  });
  return capGeminiPageInput({ page: page.page ?? page.number, text: page.text, images, ...(encodeImage ? { encodeImage } : {}) });
}

export function buildSearchAuxiliaryText(metadata) {
  if (!metadata || typeof metadata !== "object") return "";
  return [
    metadata.summary,
    metadata.topic,
    ...(Array.isArray(metadata.keywords) ? metadata.keywords : []),
    ...(Array.isArray(metadata.visualDescriptions) ? metadata.visualDescriptions.map((item) => item?.description) : []),
  ].map(normalizeText).filter(Boolean).join(" ");
}

export function stripEphemeralImageData(value) {
  if (Array.isArray(value)) return value.map(stripEphemeralImageData);
  if (!value || typeof value !== "object") return value;
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Date) return new Date(value);
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "bytes" || key === "base64") continue;
    output[key] = stripEphemeralImageData(item);
  }
  return output;
}

function safeAuditValue(value, fallback, maxLength = 128) {
  const normalized = normalizeText(value);
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

function safeErrorCode(error) {
  return SAFE_ERROR_CODES.has(error?.code) ? error.code : "external_ai_provider_error";
}

function auditFor(page, provider, payload, timestamp, status, errorCode = null) {
  const audit = {
    documentId: safeAuditValue(page?.documentId ?? page?.document?.id, null),
    page: Number(page?.page ?? page?.number) || 1,
    provider: safeAuditValue(provider?.provider ?? provider?.name, "gemini", 64),
    model: safeAuditValue(provider?.modelId ?? provider?.model, null),
    timestamp,
    status,
    errorCode,
    dataType: payload.images.length ? (payload.text ? "text+image" : "image") : "text",
    excludedImageCount: payload.excludedImageCount,
  };
  const fallback = safeAuditValue(page?.processingModeFallback, null);
  if (fallback) audit.processingModeFallback = fallback;
  if (payload.excludedImageReasons?.length) audit.excludedImageReasons = payload.excludedImageReasons.slice(0, 16);
  return audit;
}

export async function enrichPagesForSearch(pages, { provider, now = () => new Date().toISOString(), onAudit } = {}) {
  if (typeof provider?.enrichPage !== "function") throw new TypeError("provider.enrichPage is required");
  const enrichedPages = [];
  const audits = [];
  for (const page of Array.isArray(pages) ? pages : []) {
    const normalized = await normalizeProviderAssets(page);
    const payload = buildGeminiPageInput({ ...page, visualAssets: normalized.assets });
    payload.excludedImageCount += normalized.excludedImageReasons.length;
    payload.excludedImageReasons = [...normalized.excludedImageReasons, ...(payload.excludedImageReasons || [])];
    const timestamp = now();
    let nextPage = stripEphemeralImageData(page);
    let audit;
    try {
      const metadata = validateGeneratedMetadata(await provider.enrichPage(payload), { maxVisualDescriptions: payload.images.length });
      nextPage = { ...nextPage, generatedMetadata: metadata, searchAuxiliaryText: buildSearchAuxiliaryText(metadata) };
      audit = auditFor(page, provider, payload, timestamp, "success");
    } catch (error) {
      audit = auditFor(page, provider, payload, timestamp, "failed", safeErrorCode(error));
    } finally {
      for (const image of payload.images) delete image.base64;
      payload.images.length = 0;
    }
    audits.push(audit);
    if (typeof onAudit === "function") await onAudit(audit);
    enrichedPages.push(nextPage);
  }
  return { pages: enrichedPages, audits };
}
