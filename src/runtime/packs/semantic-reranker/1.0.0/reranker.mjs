export const model = "weki-local-reranker-1.0.0";

const tokenize = (value) => String(value || "")
  .toLocaleLowerCase("ko-KR")
  .normalize("NFKC")
  .split(/[^\p{L}\p{N}]+/u)
  .filter((token) => token.length > 1);

export async function rerank(query, candidates = []) {
  const queryTokens = tokenize(query);
  const querySet = new Set(queryTokens);
  return candidates.map((candidate) => {
    const text = [candidate.title, candidate.fileName, candidate.documentName, candidate.text, candidate.snippet].filter(Boolean).join(" ");
    const tokens = tokenize(text);
    const uniqueTokens = new Set(tokens);
    const matched = queryTokens.filter((token) => uniqueTokens.has(token)).length;
    const coverage = querySet.size ? matched / querySet.size : 0;
    const exactPhrase = String(text).toLocaleLowerCase("ko-KR").includes(String(query || "").toLocaleLowerCase("ko-KR").trim()) ? 0.25 : 0;
    return { unitId: candidate.unitId, score: coverage + exactPhrase };
  });
}
