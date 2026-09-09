import { performance } from "node:perf_hooks";
import crypto from "node:crypto";
import {
  decodeCursor,
  collapseEvidenceDuplicates,
  diversifyResults,
  evidenceMatchPriority,
  evidenceProximityScore,
  filterDirectEvidenceResults,
  filterRouteConstrainedResults,
  normalizeSearchRequest,
  reciprocalRankFusion,
  selectEvidence,
} from "./retrieval.mjs";
import { buildEvidenceSnippet, formatDisplayScore } from "./evidence-display.mjs";
import { buildContextPack } from "./context-pack.mjs";

export const RANKING_VERSION = "v2-lexical-rrf60-rerank-ready";

function resultIdFor(unitId, rankingVersion = RANKING_VERSION) {
  return crypto.createHash("sha256").update(`${rankingVersion}:${unitId}`).digest("hex").slice(0, 24);
}

export function createSearchService({ store, semanticSearch = null, reranker = null, pageSize = 5, now = () => performance.now() }) {
  return {
    async search(input = {}) {
      const request = normalizeSearchRequest(input);
      const sessionId = request.sessionId || crypto.randomUUID();
      const timings = {};
      const started = now();
      if (!request.query) return { sessionId, results: [], nextCursor: null, hasMore: false, engines: store.health(), timings: { totalMs: 0 }, rankingVersion: RANKING_VERSION };

      const lexicalStarted = now();
      const lexical = store.searchLexical(request.query, { limit: 200, filters: request.filters });
      timings.lexicalMs = now() - lexicalStarted;
      const rankings = [lexical];
      let semantic = [];
      if (typeof semanticSearch === "function") {
        const semanticStarted = now();
        try { semantic = (await semanticSearch(request.query, { limit: 200, filters: request.filters })) || []; } catch { semantic = []; }
        timings.semanticMs = now() - semanticStarted;
        if (semantic.length) rankings.push(filterRouteConstrainedResults(semantic, request.query).map((row) => ({ ...row, engine: "ann" })));
      }
      const fusedStarted = now();
      const fused = reciprocalRankFusion(rankings, { k: 60 }).slice(0, 200);
      const scoreScale = fused[0]?.score || 1;
      timings.fusionMs = now() - fusedStarted;
      const hydrateStarted = now();
      const hydratedById = new Map(store.hydrateUnits(fused.slice(0, 100).map((row) => row.id || row.unitId)).map((row) => [row.unitId, row]));
      timings.hydrateMs = now() - hydrateStarted;
      const materialized = fused.map((row) => {
        const unitId = row.id || row.unitId;
        const unit = hydratedById.get(unitId);
        if (!unit) return null;
        return { ...unit, id: unitId, score: row.score / scoreScale, evidence: unit.evidence || [] };
      }).filter(Boolean);
      const directMaterialized = collapseEvidenceDuplicates(filterDirectEvidenceResults(materialized, request.query), request.query)
        .sort((left, right) => evidenceProximityScore(right, request.query) - evidenceProximityScore(left, request.query) || evidenceMatchPriority(right, request.query) - evidenceMatchPriority(left, request.query) || right.score - left.score || String(left.unitId).localeCompare(String(right.unitId)));
      if (typeof reranker === "function" && directMaterialized.length) {
        const rerankStarted = now();
        try {
          const reranked = await reranker(request.query, directMaterialized.slice(0, 50));
          const scores = new Map((reranked || []).map((row) => [String(row.unitId), Number(row.score)]).filter(([, score]) => Number.isFinite(score)));
          if (scores.size) directMaterialized.sort((left, right) => (scores.get(String(right.unitId)) ?? -Infinity) - (scores.get(String(left.unitId)) ?? -Infinity) || right.score - left.score || String(left.unitId).localeCompare(String(right.unitId)));
          timings.rerankerMs = now() - rerankStarted;
        } catch {
          timings.rerankerMs = now() - rerankStarted;
        }
      }
      const offset = decodeCursor(request.cursor);
      const window = directMaterialized.slice(offset, offset + pageSize + 1);
      const hasMore = window.length > pageSize;
      const page = selectEvidence(window.slice(0, pageSize), { limit: pageSize, maxPerDocument: 2, query: request.query });
      const results = page.map((row, index) => ({
        resultId: resultIdFor(row.unitId),
        documentId: row.documentId,
        unitId: row.unitId,
        matchedEvidence: row.matchedEvidence ? (() => {
          const snippet = buildEvidenceSnippet(row.matchedEvidence.context, request.query);
          return { ...row.matchedEvidence, snippet: snippet.text, matchedTerms: snippet.matchedTerms, truncated: snippet.truncated };
        })() : null,
        sourceRange: row.sourceRange,
        relevanceScore: row.score,
        displayScore: formatDisplayScore(row.score),
        lowRelevance: row.lowRelevance,
        rank: offset + index + 1,
        title: row.title,
        documentName: row.documentName,
        format: row.format,
        sourceStatus: row.sourceStatus,
        cloudOriginalFile: row.cloudOriginalFile || null,
      }));
      timings.totalMs = now() - started;
      store.recordSearch?.({ sessionId, query: request.query, results, rankingVersion: RANKING_VERSION });
      const response = {
        sessionId,
        results,
        nextCursor: hasMore ? Buffer.from(JSON.stringify({ offset: offset + pageSize }), "utf8").toString("base64url") : null,
        hasMore,
        engines: { ...store.health(), lexical: "healthy", semantic: semantic.length ? "healthy" : "degraded" },
        timings,
        rankingVersion: RANKING_VERSION,
      };
      if (request.includeContext) response.contextPack = buildContextPack({ query: request.query, rows: page });
      return response;
    },
  };
}
