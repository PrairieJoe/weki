import crypto from "node:crypto";

const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();

export const TEXT_SOURCES = new Set(["native", "ocr", "mixed", "vlm_generated"]);

export function resolveTextSource({ nativeText = "", ocrText = "" } = {}) {
  const hasNative = Boolean(normalize(nativeText));
  const hasOcr = Boolean(normalize(ocrText));
  if (hasNative && hasOcr) return "mixed";
  if (hasNative) return "native";
  if (hasOcr) return "ocr";
  return "native";
}

export function normalizeConfidence(value, fallback = null) {
  const number = Number(value);
  if (Number.isFinite(number)) return Math.max(0, Math.min(1, number));
  return fallback === null || fallback === undefined ? null : normalizeConfidence(fallback);
}

function stableId(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24);
}

export function buildStructuredTable(table) {
  if (!table || typeof table !== "object") return null;
  const headers = Array.isArray(table.headers) ? table.headers.map(normalize) : [];
  const rows = Array.isArray(table.rows)
    ? table.rows.map((row) => (Array.isArray(row) ? row : [row]).map(normalize))
    : [];
  if (!headers.length && !rows.some((row) => row.some(Boolean))) return null;
  const cells = rows.flatMap((row, rowIndex) => row.map((value, columnIndex) => ({
    row: rowIndex,
    column: columnIndex,
    value,
    header: headers[columnIndex] || null,
  })).filter((cell) => cell.value));
  return { headers, rows, cells };
}

export function buildStructuredChart(chart) {
  if (!chart || typeof chart !== "object") return null;
  const title = normalize(chart.title);
  const categories = Array.isArray(chart.categories) ? chart.categories.map(normalize) : [];
  const series = Array.isArray(chart.series) ? chart.series.map((item) => ({
    name: normalize(item?.name),
    values: Array.isArray(item?.values) ? item.values.map((value) => normalize(value)) : [],
    categories: Array.isArray(item?.categories) ? item.categories.map(normalize) : categories,
    unit: normalize(item?.unit),
  })) : [];
  if (!title && !categories.length && !series.length) return null;
  return { title, categories, series };
}

export function createEvidenceBlock({
  documentId,
  page,
  slide = null,
  type = "text",
  nativeText = "",
  ocrText = "",
  context = "",
  caption = "",
  sourceRef = null,
  visualAsset = null,
  table = null,
  chart = null,
  confidence = null,
  diagnostics = [],
  generatedMetadata = null,
  searchAuxiliaryText = "",
  id = null,
} = {}) {
  const normalizedNative = normalize(nativeText);
  const normalizedOcr = normalize(ocrText);
  const normalizedContext = normalize(context) || [normalizedNative, normalizedOcr].filter(Boolean).join(" ");
  const normalizedTable = buildStructuredTable(table);
  const normalizedChart = buildStructuredChart(chart);
  const normalizedSourceRef = sourceRef && typeof sourceRef === "object" ? { ...sourceRef } : null;
  const normalizedAsset = visualAsset && typeof visualAsset === "object"
    ? { name: visualAsset.name || null, mime: visualAsset.mime || visualAsset.mimeType || null, source: visualAsset.source || null }
    : null;
  const blockId = id || `${documentId || "document"}:${slide ? `s${slide}` : `p${Number(page) || 1}`}:${type}:${stableId(`${normalizedContext}:${normalizedAsset?.name || ""}`)}`;
  return {
    id: blockId,
    documentId: documentId || null,
    pageStart: Number(page) || 1,
    pageEnd: Number(page) || Number(page) || 1,
    slide: Number.isFinite(Number(slide)) ? Number(slide) : null,
    type,
    origin: resolveTextSource({ nativeText: normalizedNative, ocrText: normalizedOcr }),
    textSource: resolveTextSource({ nativeText: normalizedNative, ocrText: normalizedOcr }),
    nativeText: normalizedNative,
    ocrText: normalizedOcr,
    context: normalizedContext,
    caption: normalize(caption),
    sourceRef: normalizedSourceRef,
    visualAsset: normalizedAsset,
    table: normalizedTable,
    chart: normalizedChart,
    confidence: normalizeConfidence(confidence),
    diagnostics: Array.isArray(diagnostics) ? diagnostics.filter(Boolean).map((item) => ({ ...item })) : [],
    generatedMetadata: generatedMetadata && typeof generatedMetadata === "object" ? generatedMetadata : null,
    searchAuxiliaryText: normalize(searchAuxiliaryText),
  };
}

export function pageToEvidenceBlocks(page, { documentId = null } = {}) {
  const blocks = [];
  const pageNumber = Number(page?.page) || 1;
  const nativeText = normalize(page?.nativeText);
  const ocrText = normalize(page?.ocrText);
  const context = normalize(page?.text) || [nativeText, ocrText].filter(Boolean).join(" ");
  if (context || nativeText || ocrText) {
    blocks.push(createEvidenceBlock({
      documentId,
      page: pageNumber,
      slide: page?.slide,
      type: "text",
      nativeText,
      ocrText,
      context,
      caption: page?.caption,
      confidence: page?.ocrConfidence,
      diagnostics: page?.diagnostics,
      generatedMetadata: page?.generatedMetadata,
      searchAuxiliaryText: page?.searchAuxiliaryText,
    }));
  }
  if (page?.table) {
    blocks.push(createEvidenceBlock({ documentId, page: pageNumber, slide: page?.slide, type: "table", table: page.table, context: page.tableText, sourceRef: page.tableSourceRef, confidence: page.tableConfidence, diagnostics: page.tableDiagnostics }));
  }
  if (page?.chart) {
    blocks.push(createEvidenceBlock({ documentId, page: pageNumber, slide: page?.slide, type: "chart", chart: page.chart, context: page.chartText, caption: page.caption, sourceRef: page.chartSourceRef, confidence: page.chartConfidence, diagnostics: page.chartDiagnostics }));
  }
  for (const [index, asset] of (page?.visualAssets || []).entries()) {
    const assetText = normalize(asset?.text || asset?.ocrText);
    if (!assetText && !asset?.name) continue;
    blocks.push(createEvidenceBlock({
      documentId,
      page: pageNumber,
      slide: page?.slide,
      type: asset?.assetType === "chart" ? "chart" : asset?.assetType === "table" ? "table" : "visual",
      ocrText: assetText,
      context: [assetText, asset?.caption, asset?.nearbyText || context].filter(Boolean).join(" "),
      caption: asset?.caption,
      sourceRef: { ...(asset?.sourceRef || {}), assetIndex: index },
      visualAsset: asset,
      table: asset?.table,
      chart: asset?.chart,
      confidence: asset?.confidence,
      diagnostics: asset?.diagnostics,
    }));
  }
  return blocks;
}
