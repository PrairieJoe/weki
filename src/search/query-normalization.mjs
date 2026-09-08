const DASH_PATTERN = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/gu;

export function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(DASH_PATTERN, "-")
    .replace(/(\p{N})\s*[-_/]\s*(\p{N})/gu, "$1-$2")
    .replace(/\s+/gu, " ")
    .trim();
}

export function extractSearchTerms(value) {
  const terms = normalizeSearchText(value).match(/[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*/gu) || [];
  return [...new Set(terms.filter(Boolean))].sort((left, right) => right.length - left.length);
}

export function compactKoreanSpacing(value) {
  return normalizeSearchText(value).replace(/(?<=[\p{L}])\s+(?=[\p{L}])/gu, "");
}

export function searchTermVariants(value) {
  const term = normalizeSearchText(value);
  const variants = [term];
  if (/^[\p{L}]+$/u.test(term)) {
    const match = term.match(/^(.{2,}?)(은|는|이|가|을|를|의|에|와|과|로|으로|에서|에게|부터|까지|보다|처럼|만|도)$/u);
    if (match) variants.push(match[1]);
  }
  return [...new Set(variants.filter(Boolean))];
}

const SEARCH_FILLER_TERMS = new Set([
  "검색", "찾아", "찾아줘", "알려", "알려줘", "보여", "보여줘", "내용", "자료", "관련", "대상", "대한", "대해", "및", "또는",
]);

function normalizedCoverageText(value) {
  return compactKoreanSpacing(normalizeSearchText(value)).toLocaleLowerCase();
}

export function meaningfulSearchTerms(value) {
  const normalized = normalizeSearchText(value);
  const terms = extractSearchTerms(normalized);
  const singleSyllableOcr = terms.length >= 3 && terms.every((term) => /^[\p{Script=Hangul}]$/u.test(term));
  const compactTerms = singleSyllableOcr ? extractSearchTerms(compactKoreanSpacing(normalized)) : terms;
  return [...new Set(compactTerms.map((term) => term.toLocaleLowerCase()).filter((term) => term && !SEARCH_FILLER_TERMS.has(term)))];
}

export function hasRequiredSearchTerms(query, values = []) {
  const normalizedQuery = normalizeSearchText(query);
  const routeCodes = extractRouteCodes(normalizedQuery);
  const haystack = normalizedCoverageText(values.filter(Boolean).join(" "));
  if (routeCodes.length) return matchesRouteConstraints(normalizedQuery, values);
  const terms = meaningfulSearchTerms(normalizedQuery);
  if (!terms.length) return true;
  return terms.every((term) => searchTermVariants(term).some((variant) => haystack.includes(normalizedCoverageText(variant))));
}

export function extractRouteCodes(value) {
  const normalized = normalizeSearchText(value);
  const withSuffix = [...normalized.matchAll(/(?<![\p{L}\p{N}])(\p{N}+(?:-\p{N}+)*)\s*번/gu)].map((match) => match[1]);
  const hyphenated = [...normalized.matchAll(/(?<![\p{L}\p{N}])(\p{N}+(?:-\p{N}+)+)(?![\p{L}\p{N}-])/gu)].map((match) => match[1]);
  return [...new Set([...withSuffix, ...hyphenated])];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function containsExactRouteCode(value, routeCode) {
  const normalized = normalizeSearchText(value);
  const escaped = escapeRegExp(routeCode);
  return new RegExp(`(?<![\\p{L}\\p{N}-])${escaped}(?=\\s*번|$|[^\\p{L}\\p{N}-])`, "u").test(normalized);
}

export function matchesRouteConstraints(query, values = []) {
  const routeCodes = extractRouteCodes(query);
  if (!routeCodes.length) return true;
  const haystack = values.filter(Boolean).join(" ");
  return routeCodes.every((routeCode) => containsExactRouteCode(haystack, routeCode));
}
