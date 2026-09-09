import crypto from "node:crypto";

function normalize(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

export function mergeNativeAndOcr(nativeText, ocrText) {
  const native = normalize(nativeText);
  const ocr = normalize(ocrText);
  if (!native) return ocr;
  if (!ocr || native === ocr) return native;
  return `${native} ${ocr}`.trim();
}

export function chunkText(value, { maxTokens = 384, overlapTokens = 64 } = {}) {
  const tokens = normalize(value).split(/\s+/u).filter(Boolean);
  const max = Math.max(1, Number(maxTokens) || 384);
  const overlap = Math.min(max - 1, Math.max(0, Number(overlapTokens) || 0));
  if (!tokens.length) return [];
  const chunks = [];
  let start = 0;
  while (start < tokens.length) {
    const hardEnd = Math.min(tokens.length, start + max);
    let end = hardEnd;
    const minimumBoundary = Math.min(hardEnd, start + Math.max(2, Math.floor(max * 0.35)));
    for (let candidate = hardEnd - 1; candidate >= minimumBoundary; candidate -= 1) {
      if (/[.!?。！？]$/u.test(tokens[candidate])) { end = candidate + 1; break; }
    }
    const next = tokens.slice(start, end);
    chunks.push({ text: next.join(" "), tokens: next.length, startToken: start, endToken: start + next.length - 1 });
    if (end >= tokens.length) break;
    start += Math.max(1, next.length - overlap);
  }
  return chunks;
}

function hashAsset(asset) {
  if (asset?.bytes) return crypto.createHash("sha256").update(asset.bytes).digest("hex");
  return crypto.createHash("sha256").update(`${asset?.name || ""}:${asset?.mime || ""}`).digest("hex");
}

export function buildEvidenceFragments({ documentId, page, nativeText = "", ocrText = "", table = null, visualAssets = [], maxTokens = 384, overlapTokens = 64 }) {
  const merged = mergeNativeAndOcr(nativeText, ocrText);
  const fragments = [];
  const origin = nativeText && ocrText ? "merged" : nativeText ? "native" : "ocr";
  chunkText(merged, { maxTokens, overlapTokens }).forEach((chunk, index) => {
    fragments.push({ id: `${documentId}:p${page}:text:${index}`, documentId, pageStart: Number(page) || 1, pageEnd: Number(page) || 1, type: "text", origin, context: chunk.text });
  });
  if (table) {
    const headers = Array.isArray(table.headers) ? table.headers.map(normalize).filter(Boolean) : [];
    const rows = Array.isArray(table.rows) ? table.rows : [];
    const tableText = [headers.join(" | "), ...rows.map((row) => (Array.isArray(row) ? row : [row]).map(normalize).join(" | "))].filter(Boolean).join("\n");
    if (tableText) fragments.push({ id: `${documentId}:p${page}:table:0`, documentId, pageStart: Number(page) || 1, pageEnd: Number(page) || 1, type: "table", origin: "native", context: tableText });
  }
  for (const [index, asset] of (visualAssets || []).entries()) {
    const context = [asset.ocrText, asset.caption, asset.nearbyText].map(normalize).filter(Boolean).join(" ");
    if (!context && !asset.name) continue;
    fragments.push({ id: `${documentId}:p${page}:visual:${index}`, documentId, pageStart: Number(page) || 1, pageEnd: Number(page) || 1, type: "visual", origin: asset.ocrText ? "ocr" : "native", assetName: asset.name || null, assetHash: hashAsset(asset), context });
  }
  return fragments;
}
