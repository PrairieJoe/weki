import { normalizeSearchText } from "./query-normalization.mjs";

function normalize(value) {
  return normalizeSearchText(value);
}

function normalizedValues(values) {
  return [...new Set((Array.isArray(values) ? values : [values]).map(normalize).filter(Boolean))];
}

const suggestionStopWords = new Set(["안내", "절차", "기준", "내용", "설명", "자료", "보고서", "현황", "관련", "대한", "에서", "으로"]);
const termsFrom = (value) => normalize(value).toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];

export function validateSynonymInput({ term = "", aliases = [] } = {}) {
  const normalizedTerm = normalize(term);
  const normalizedAliases = normalizedValues(aliases);
  const errors = [];
  if (!normalizedTerm) errors.push("기준어가 필요합니다.");
  if (!normalizedAliases.length) errors.push("하나 이상의 동의어·약어가 필요합니다.");
  if (normalizedAliases.some((alias) => alias === normalizedTerm)) errors.push("기준어와 동의어가 같을 수 없습니다.");
  if (normalizedAliases.length !== (Array.isArray(aliases) ? aliases : [aliases]).map(normalize).filter(Boolean).length) errors.push("동의어가 중복됩니다.");
  return { valid: errors.length === 0, errors, term: normalizedTerm, aliases: normalizedAliases };
}

export function normalizeSynonymEntry(input = {}, { id = input.id || null } = {}) {
  const validation = validateSynonymInput(input);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  return {
    ...(id ? { id } : {}),
    term: validation.term,
    aliases: validation.aliases,
    status: input.status === "draft" || input.status === "rejected" ? input.status : input.approved === false ? "draft" : "approved",
    source: input.source === "suggested" || input.source === "auto" ? "suggested" : "manual",
  };
}

export function expandSynonymQuery(query, entries = []) {
  const normalizedQuery = normalize(query);
  const expansions = [];
  const expandedQueries = [];
  const escape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const containsTerm = (value, term) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(term)}(?![\\p{L}\\p{N}])`, "iu").test(value);
  const replaceTerm = (value, from, to) => value.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(from)}(?![\\p{L}\\p{N}])`, "giu"), to);
  for (const entry of entries || []) {
    const status = entry.status || (entry.approved ? "approved" : "draft");
    if (status !== "approved") continue;
    const term = normalize(entry.term);
    const aliases = normalizedValues(entry.aliases);
    if (!term) continue;
    if (containsTerm(normalizedQuery, term)) {
      for (const alias of aliases) if (!containsTerm(normalizedQuery, alias) && alias !== term) { expansions.push(alias); expandedQueries.push(replaceTerm(normalizedQuery, term, alias)); }
    }
    for (const alias of aliases) if (containsTerm(normalizedQuery, alias) && !containsTerm(normalizedQuery, term)) { expansions.push(term); expandedQueries.push(replaceTerm(normalizedQuery, alias, term)); }
  }
  const unique = [...new Set(expansions)];
  return { query: [normalizedQuery, ...unique].filter(Boolean).join(" "), normalized: normalizedQuery, expansions: unique, queries: [...new Set(expandedQueries)].filter(Boolean) };
}

export function suggestSynonymCandidates({ feedback = [], documents = [], existing = [], limit = 20 } = {}) {
  const existingValues = new Set((existing || []).flatMap((entry) => [entry.term, ...(entry.aliases || [])].map((value) => normalize(value).toLocaleLowerCase())));
  const documentsById = new Map((documents || []).map((document) => [document.id, document]));
  const candidates = new Map();
  for (const item of feedback || []) {
    if (!item?.helpful) continue;
    const queryTerms = termsFrom(item.query);
    const document = documentsById.get(item.documentId);
    if (!queryTerms.length || !document) continue;
    const text = (document.units || []).map((unit) => unit.text || "").join(" ");
    const textTerms = termsFrom(text);
    for (const term of queryTerms) {
      const aliases = textTerms.filter((candidate) => candidate !== term && !queryTerms.includes(candidate) && !suggestionStopWords.has(candidate) && !existingValues.has(candidate));
      if (!aliases.length) continue;
      const key = `${term}:${aliases[0]}`;
      if (!candidates.has(key)) candidates.set(key, { term, aliases: [aliases[0]], status: "draft", source: "suggested" });
    }
  }
  return [...candidates.values()].slice(0, Math.max(1, Number(limit) || 20));
}

export function normalizeSynonymCollection(entries = []) {
  return (entries || []).flatMap((entry) => {
    try {
      const normalized = normalizeSynonymEntry(entry, { id: entry.id });
      return [{ ...normalized, approved: normalized.status === "approved", ...(entry.createdAt ? { createdAt: entry.createdAt } : {}), ...(entry.updatedAt ? { updatedAt: entry.updatedAt } : {}) }];
    } catch { return []; }
  });
}
