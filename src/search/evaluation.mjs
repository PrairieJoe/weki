function setOf(values) { return new Set((values || []).map(String).filter(Boolean)); }

export async function evaluateSearchCases({ cases = [], search, k = 5 } = {}) {
  if (typeof search !== "function") throw new TypeError("search must be a function");
  const limit = Math.max(1, Number(k) || 5);
  let recalled = 0;
  let reciprocalRankTotal = 0;
  let evidenceHits = 0;
  let returnedEvidence = 0;
  for (const item of cases) {
    const relevantUnits = setOf(item.relevantUnitIds);
    const relevantEvidence = setOf(item.relevantEvidenceIds);
    const response = await search(item.query, item);
    const results = Array.isArray(response?.results) ? response.results.slice(0, limit) : [];
    const unitIndex = results.findIndex((row) => relevantUnits.has(String(row.unitId)));
    if (unitIndex >= 0) { recalled += 1; reciprocalRankTotal += 1 / (unitIndex + 1); }
    for (const row of results) {
      const evidenceId = row.matchedEvidence?.id || row.matchedEvidence?.evidenceId;
      if (!evidenceId) continue;
      returnedEvidence += 1;
      if (relevantEvidence.has(String(evidenceId))) evidenceHits += 1;
    }
  }
  const count = cases.length;
  return {
    cases: count,
    k: limit,
    recallAtK: count ? recalled / count : 0,
    mrr: count ? reciprocalRankTotal / count : 0,
    evidencePrecision: returnedEvidence ? evidenceHits / returnedEvidence : 0,
  };
}
