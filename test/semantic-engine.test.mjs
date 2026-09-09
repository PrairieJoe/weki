import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSearchStore } from "../src/search/sqlite-store.mjs";
import { createSemanticEngine } from "../src/search/semantic-engine.mjs";

test("semantic engine searches stored embeddings and degrades on unavailable model", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "weki-semantic-"));
  const store = createSearchStore({ directory });
  store.upsertDocument({ id: "d1", name: "semantic.pdf", format: "pdf" });
  store.upsertKnowledgeUnit({ id: "u1", documentId: "d1", text: "one" });
  store.upsertKnowledgeUnit({ id: "u2", documentId: "d1", text: "two" });
  store.upsertEmbedding({ unitId: "u1", vector: [1, 0, 0], model: "test", dimension: 3 });
  store.upsertEmbedding({ unitId: "u2", vector: [0, 1, 0], model: "test", dimension: 3 });
  const engine = createSemanticEngine({ store, embedQuery: async () => [1, 0, 0], dimension: 3 });
  assert.equal((await engine.search("query", { limit: 2 }))[0].unitId, "u1");
  assert.equal(engine.health().status, "healthy");
  const degraded = createSemanticEngine({ store, dimension: 3 });
  assert.equal((await degraded.search("query")).length, 0);
  assert.equal(degraded.health().status, "degraded");
  store.close();
  await fs.rm(directory, { recursive: true, force: true });
});

test("semantic engine applies document filters before returning ANN candidates", async () => {
  const store = {
    listEmbeddings: () => [
      { unitId: "pdf-unit", vector: [1, 0, 0], dimension: 3, model: "model-a", generation: "gen-a" },
      { unitId: "docx-unit", vector: [0.99, 0.01, 0], dimension: 3, model: "model-a", generation: "gen-a" },
    ],
    filterUnitIds: (unitIds, filters) => filters.format?.includes("pdf") ? new Set(unitIds.filter((id) => id === "pdf-unit")) : new Set(unitIds),
  };
  const engine = createSemanticEngine({ store, embedQuery: async () => [1, 0, 0], dimension: 3, model: "model-a", generation: "gen-a" });
  const rows = await engine.search("query", { limit: 10, filters: { format: ["pdf"] } });
  assert.deepEqual(rows.map((row) => row.unitId), ["pdf-unit"]);
});

test("semantic engine excludes embeddings from another model generation", async () => {
  const store = {
    listEmbeddings: ({ model, generation }) => [
      { unitId: "active", vector: [1, 0, 0], dimension: 3, model, generation },
    ],
  };
  const engine = createSemanticEngine({ store, embedQuery: async () => [1, 0, 0], dimension: 3, model: "model-a", generation: "gen-a" });
  assert.equal((await engine.search("query", { limit: 10 })).length, 1);
});
