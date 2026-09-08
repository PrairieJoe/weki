import { cosineSimilarity } from "./retrieval.mjs";

export function createSemanticEngine({ store, embedQuery = null, annIndex = null, dimension = 384, model = "multilingual-e5-small", generation = null }) {
  let lastError = null;
  return {
    async search(query, { limit = 200, filters = {} } = {}) {
      if (typeof embedQuery !== "function") return [];
      try {
        const vector = await embedQuery(query);
        if (!Array.isArray(vector) || vector.length !== dimension) throw new Error(`embedding dimension mismatch: expected ${dimension}`);
        if (annIndex) return await annIndex.search(vector, limit);
        const rows = store.listEmbeddings({ dimension, generation });
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
