const MAX_CITATIONS = 5;
const MAX_CITATION_TEXT = 1200;
const MAX_TOTAL_TEXT = 6000;

export function buildContextPack({ query = "", rows = [] } = {}) {
  let total = 0;
  let truncated = false;
  const citations = [];
  for (const row of rows.slice(0, MAX_CITATIONS)) {
    const evidence = row.matchedEvidence || row.evidence?.[0];
    if (!evidence) continue;
    const rawText = String(evidence.context || row.text || "").trim();
    const remaining = Math.max(0, Math.min(MAX_CITATION_TEXT, MAX_TOTAL_TEXT - total));
    if (!remaining) { truncated = true; break; }
    const text = rawText.slice(0, remaining);
    if (text.length < rawText.length) truncated = true;
    total += text.length;
    citations.push({
      citationId: `c${citations.length + 1}`,
      documentId: row.documentId,
      documentName: row.documentName,
      format: row.format,
      sourceRange: row.sourceRange,
      evidenceIds: row.evidence?.map((item) => item.id).filter(Boolean) || [evidence.id].filter(Boolean),
      text,
      origin: evidence.origin || null,
      type: evidence.type || "text",
    });
  }
  return { query: String(query), citations, truncated };
}
