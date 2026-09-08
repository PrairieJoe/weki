const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeSearchRequest(input = {}) {
  const query = String(input.query ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  const rawFilters = input.filters && typeof input.filters === "object" ? input.filters : {};
  const formats = Array.isArray(rawFilters.format) ? rawFilters.format : rawFilters.format ? [rawFilters.format] : [];
  const format = [...new Set(formats.map((value) => String(value).toLowerCase().trim()).filter(Boolean))].sort();
  const dateCriterion = rawFilters.dateCriterion === "created" || rawFilters.dateCriterion === "accessed"
    ? rawFilters.dateCriterion : "modified";
  const from = ISO_DATE.test(String(rawFilters.from ?? "")) ? String(rawFilters.from) : null;
  const to = ISO_DATE.test(String(rawFilters.to ?? "")) ? String(rawFilters.to) : null;
  const cursor = input.cursor === undefined || input.cursor === null ? null : String(input.cursor).trim() || null;
  const sessionId = input.sessionId === undefined || input.sessionId === null ? null : String(input.sessionId).trim() || null;
  return { query, cursor, sessionId, filters: { format, dateCriterion, from, to } };
}

export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index]);
    const b = Number(right[index]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export function reciprocalRankFusion(rankings, { k = 60 } = {}) {
  const merged = new Map();
  for (const ranking of rankings || []) {
    (ranking || []).forEach((candidate, index) => {
      const id = String(candidate?.id ?? candidate?.unitId ?? "");
      if (!id) return;
      const current = merged.get(id) || { ...candidate, id, score: 0, sources: [] };
      current.score += 1 / (k + index + 1);
      current.sources.push(candidate.engine || candidate.source || "unknown");
      if (candidate?.unitId && !current.unitId) current.unitId = candidate.unitId;
      merged.set(id, current);
    });
  }
  return [...merged.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export function diversifyResults(results, { limit = 5, maxPerDocument = 2 } = {}) {
  const output = [];
  const counts = new Map();
  for (const row of results || []) {
    const documentId = String(row.documentId ?? "");
    const count = counts.get(documentId) || 0;
    if (documentId && count >= maxPerDocument) continue;
    output.push(row);
    if (documentId) counts.set(documentId, count + 1);
    if (output.length >= limit) break;
  }
  return output;
}

export function selectEvidence(results, { limit = 5, lowRelevanceThreshold = 0.25, maxPerDocument = 2 } = {}) {
  const diversified = diversifyResults(results, { limit, maxPerDocument });
  return diversified.map((row) => {
    const evidence = Array.isArray(row.evidence) ? row.evidence : [];
    const matchedEvidence = evidence[0] || null;
    return {
      ...row,
      matchedEvidence,
      lowRelevance: Number(row.score || 0) < lowRelevanceThreshold,
    };
  });
}

export function encodeCursor(offset) {
  return Buffer.from(JSON.stringify({ offset: Math.max(0, Number(offset) || 0) }), "utf8").toString("base64url");
}

export function decodeCursor(cursor) {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    return Number.isInteger(value.offset) && value.offset >= 0 ? value.offset : 0;
  } catch {
    return 0;
  }
}
