import { cosineSimilarity } from "./retrieval.mjs";

export function createSemanticEngine({ store, embedQuery = null, annIndex = null, dimension = 384, model = null, generation = null }) {
  let lastError = null;

  function getAllowedIds() {
    if (!model && !generation) return null;
    const rows = typeof store.listEmbeddingIds === "function"
      ? store.listEmbeddingIds({ dimension, model, generation })
      : store.listEmbeddings({ dimension, model, generation });
    return new Set((rows || []).map((row) => String(row.unitId)));
  }

  return {
    async search(query, { limit = 200, filters = {} } = {}) {
      if (typeof embedQuery !== "function") return [];
      try {
        const vector = await embedQuery(query);
        if (!Array.isArray(vector) || vector.length !== dimension) throw new Error(`embedding dimension mismatch: expected ${dimension}`);
        const filterIds = (rows) => {
          const generationIds = getAllowedIds();
          const generationRows = generationIds ? rows.filter((row) => generationIds.has(String(row.unitId))) : rows;
          if (typeof store.filterUnitIds !== "function") return generationRows;
          const filtered = store.filterUnitIds(generationRows.map((row) => row.unitId), filters);
          const allowed = filtered instanceof Set ? filtered : new Set(filtered || []);
          return generationRows.filter((row) => allowed.has(String(row.unitId)));
        };
        if (annIndex) {
          const annRows = await annIndex.search(vector, limit);
          lastError = null;
          return filterIds(annRows);
        }
        const rows = filterIds(store.listEmbeddings({ dimension, model, generation }));
        const scored = rows.map((row) => ({ id: row.unitId, unitId: row.unitId, score: cosineSimilarity(vector, row.vector), engine: "ann" }))
          .filter((row) => Number.isFinite(row.score)).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, Math.min(200, Number(limit) || 200));
        lastError = null;
        return scored;
      } catch (error) {
        lastError = error;
        return [];
      }
    },
    health() {
      return { status: typeof embedQuery === "function" && !lastError ? "healthy" : "degraded", model, dimension, generation, error: lastError?.message || null, implementation: annIndex ? "generation-index" : "sqlite-vector-fallback" };
    },
  };
}
