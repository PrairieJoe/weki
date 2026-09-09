const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
import { compactKoreanSpacing, containsExactRouteCode, extractRouteCodes, extractSearchTerms, hasRequiredSearchTerms, matchesRouteConstraints, normalizeSearchText, searchTermVariants } from "./query-normalization.mjs";

export function normalizeSearchRequest(input = {}) {
  const query = normalizeSearchText(input.query);
  const rawFilters = input.filters && typeof input.filters === "object" ? input.filters : {};
  const formats = Array.isArray(rawFilters.format) ? rawFilters.format : rawFilters.format ? [rawFilters.format] : [];
  const format = [...new Set(formats.map((value) => String(value).toLowerCase().trim()).filter(Boolean))].sort();
  const dateCriterion = rawFilters.dateCriterion === "created" || rawFilters.dateCriterion === "accessed"
    ? rawFilters.dateCriterion : "modified";
  const from = ISO_DATE.test(String(rawFilters.from ?? "")) ? String(rawFilters.from) : null;
  const to = ISO_DATE.test(String(rawFilters.to ?? "")) ? String(rawFilters.to) : null;
  const cursor = input.cursor === undefined || input.cursor === null ? null : String(input.cursor).trim() || null;
  const sessionId = input.sessionId === undefined || input.sessionId === null ? null : String(input.sessionId).trim() || null;
  const requestedPageSize = Number.parseInt(input.pageSize, 10);
  const pageSize = Number.isInteger(requestedPageSize) && requestedPageSize > 0 ? Math.min(200, requestedPageSize) : null;
  const normalized = { query, cursor, sessionId, includeContext: Boolean(input.includeContext), filters: { format, dateCriterion, from, to } };
  if (pageSize) normalized.pageSize = pageSize;
  return normalized;
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

function normalizedMatchText(value) {
  return compactKoreanSpacing(normalizeSearchText(value)).toLocaleLowerCase().replace(/(\p{N}+(?:[-_][\p{N}]+)?)\s*번/gu, "$1번");
}

function normalizedQueryTerms(query) {
  return [...new Set(extractSearchTerms(query).map(normalizedMatchText).filter(Boolean))];
}

function matchingTermCount(value, terms) {
  const text = normalizedMatchText(value);
  return terms.filter((term) => {
    const routeCodes = extractRouteCodes(term);
    return routeCodes.length ? routeCodes.every((routeCode) => containsExactRouteCode(text, routeCode)) : text.includes(term);
  }).length;
}

function compactMatchSpan(value, query) {
  const text = compactKoreanSpacing(normalizeSearchText(value)).toLocaleLowerCase();
  const terms = extractSearchTerms(query).flatMap((term) => searchTermVariants(term)).map((term) => compactKoreanSpacing(term).toLocaleLowerCase()).filter(Boolean);
  const uniqueTerms = [...new Set(terms)];
  const positions = uniqueTerms.map((term) => text.indexOf(term)).filter((position) => position >= 0);
  if (!positions.length || positions.length < uniqueTerms.length) return 0;
  const ends = uniqueTerms.map((term) => text.indexOf(term) + term.length);
  return Math.max(0, Math.max(...ends) - Math.min(...positions));
}

export function evidenceProximityScore(row, query = "") {
  const values = [row?.text, row?.nativeText, row?.ocrText, ...(row?.evidence || []).map((item) => item.context)].filter(Boolean);
  const spans = values.map((value) => compactMatchSpan(value, query)).filter((span) => span > 0);
  if (!spans.length) return 0;
  return 1 / Math.min(...spans);
}

export function evidenceMatchPriority(row, query = "") {
  const terms = normalizedQueryTerms(query);
  return (row?.evidence || []).reduce((best, item) => {
    const contextMatches = matchingTermCount(item.context, terms);
    const ocrMatches = item.type === "visual" ? matchingTermCount(row.ocrText, terms) : 0;
    const priority = (ocrMatches * 100) + (contextMatches * 10) + (item.type === "visual" && contextMatches ? 1 : 0);
    return Math.max(best, priority);
  }, 0);
}

export function selectEvidence(results, { limit = 5, lowRelevanceThreshold = 0.25, maxPerDocument = 2, query = "" } = {}) {
  const diversified = diversifyResults(results, { limit, maxPerDocument });
  const terms = normalizedQueryTerms(query);
  return diversified.map((row) => {
    const evidence = Array.isArray(row.evidence) ? row.evidence : [];
    const rankedEvidence = evidence.map((item, index) => {
      const matches = matchingTermCount(item.context, terms);
      const visualOcrMatches = item.type === "visual" ? matchingTermCount(row.ocrText, terms) : 0;
      return { item, index, matches, visualOcrMatches, visualBonus: item.type === "visual" && matches ? 1 : 0 };
    }).sort((left, right) => right.visualOcrMatches - left.visualOcrMatches || right.matches - left.matches || right.visualBonus - left.visualBonus || left.index - right.index);
    const matchedEvidence = (rankedEvidence[0]?.matches || rankedEvidence[0]?.visualOcrMatches ? rankedEvidence[0].item : evidence[0]) || null;
    return {
      ...row,
      matchedEvidence,
      lowRelevance: Number(row.score || 0) < lowRelevanceThreshold,
    };
  });
}

export function filterRouteConstrainedResults(results, query = "") {
  return (results || []).filter((row) => matchesRouteConstraints(query, [row.title, row.heading, row.text, row.nativeText, row.ocrText]));
}

export function filterDirectEvidenceResults(results, query = "") {
  return (results || []).filter((row) => {
    const isVisual = (row.evidence || []).some((item) => item.type === "visual");
    const values = isVisual ? [row.title, row.heading, row.ocrText] : [row.title, row.heading, row.text, row.nativeText, row.ocrText];
    return hasRequiredSearchTerms(query, values);
  });
}

function evidencePage(row) {
  const first = (row?.evidence || [])[0];
  if (first?.pageStart !== undefined) return String(first.pageStart);
  const range = row?.sourceRange;
  if (typeof range === "number" || typeof range === "string") return String(range);
  return "";
}

export function collapseEvidenceDuplicates(results, query = "") {
  const output = [];
  for (const row of results || []) {
    const page = evidencePage(row);
    const isVisual = (row.evidence || []).some((item) => item.type === "visual");
    const duplicateIndex = page ? output.findIndex((item) => String(item.documentId || "") === String(row.documentId || "") && evidencePage(item) === page && ((item.evidence || []).some((evidence) => evidence.type === "visual") !== isVisual)) : -1;
    if (duplicateIndex < 0) { output.push(row); continue; }
    const current = output[duplicateIndex];
    const currentPriority = evidenceMatchPriority(current, query);
    const nextPriority = evidenceMatchPriority(row, query);
    if (nextPriority > currentPriority || (nextPriority === currentPriority && Number(row.score || 0) > Number(current.score || 0))) output[duplicateIndex] = row;
  }
  return output;
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
