function normalize(value) {
  return String(value ?? "").normalize("NFKC").replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/gu, "-").replace(/(\p{N})\s*[-_/]\s*(\p{N})/gu, "$1-$2").replace(/\s+/gu, " ").trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termPattern(term) {
  const normalized = normalize(term);
  if (/^[\p{Script=Hangul}]+$/u.test(normalized) && normalized.length > 1) return normalized.split("").map(escapeRegExp).join("\\s*");
  return escapeRegExp(normalized);
}

function findTerm(text, term) {
  return new RegExp(termPattern(term), "iu").exec(text);
}

function queryTerms(query) {
  const values = Array.isArray(query) ? query : extractSearchTerms(query);
  const expanded = values.flatMap((value) => {
    const normalized = normalize(value);
    const route = normalized.match(/^(\p{N}+(?:[-_]\p{N}+)*)번$/u);
    return route ? [normalized, route[1]] : [normalized];
  });
  return [...new Set(expanded.filter((value) => value.length > 0))].sort((a, b) => b.length - a.length);
}

function sentenceBounds(text, index) {
  const before = text.slice(0, Math.max(0, index));
  const after = text.slice(Math.max(0, index));
  const start = Math.max(before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"), before.lastIndexOf("。"), before.lastIndexOf("！"), before.lastIndexOf("？")) + 1;
  const endCandidates = [".", "!", "?", "。", "！", "？"].map((mark) => after.indexOf(mark)).filter((value) => value >= 0);
  const end = endCandidates.length ? index + Math.min(...endCandidates) + 1 : text.length;
  return { start, end };
}

export function buildEvidenceSnippet(context, query = "", { maxChars = 220 } = {}) {
  const text = normalize(context);
  const limit = Math.max(40, Number(maxChars) || 220);
  const matchedTerms = queryTerms(query).filter((term) => findTerm(text, term));
  if (!text || text.length <= limit) return { text, matchedTerms, truncated: false };
  if (!matchedTerms.length) return { text: `${text.slice(0, limit).trimEnd()}…`, matchedTerms, truncated: true };

  const matchIndex = matchedTerms.reduce((best, term) => {
    const index = findTerm(text, term)?.index ?? -1;
    return index >= 0 && (best < 0 || index < best) ? index : best;
  }, -1);
  const sentence = sentenceBounds(text, Math.max(0, matchIndex));
  let start = sentence.start;
  let end = sentence.end;
  if (end - start > limit) {
    const half = Math.max(1, Math.floor(limit / 2));
    start = Math.max(0, matchIndex - half);
    end = Math.min(text.length, start + limit);
  } else {
    const previousBoundary = Math.max(text.lastIndexOf(" ", start - 1), text.lastIndexOf("\n", start - 1));
    const previousWordStart = previousBoundary >= 0 ? previousBoundary + 1 : start;
    if (start > 0 && previousWordStart < start) start = previousWordStart;
  }
  let snippet = text.slice(start, end).trim();
  if (start > 0) snippet = `…${snippet}`;
  if (end < text.length) snippet = `${snippet}…`;
  return { text: snippet, matchedTerms, truncated: start > 0 || end < text.length };
}

export function highlightEvidence(context, terms = []) {
  const text = String(context ?? "");
  const safeText = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  const normalizedTerms = queryTerms(terms);
  if (!normalizedTerms.length) return safeText;
  const pattern = normalizedTerms.map(termPattern).join("|");
  const matcher = new RegExp(`(${pattern})`, "giu");
  return safeText.replace(matcher, "<mark>$1</mark>");
}

export function formatDisplayScore(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return 0;
  const percentage = value >= 0 && value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(percentage)));
}
import { extractSearchTerms } from "./query-normalization.mjs";
