import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAnnIndex } from "../src/search/ann-index.mjs";

test("ANN index promotes a verified generation atomically and restores it", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "weki-ann-"));
  const index = createAnnIndex({ directory, dimension: 3 });
  const generation = await index.build([{ unitId: "u1", vector: [1, 0, 0] }, { unitId: "u2", vector: [0, 1, 0] }]);
  assert.equal((await index.search([1, 0, 0], 2))[0].unitId, "u1");
  const health = await index.health();
  assert.equal(health.generation, generation);
  assert.ok(["usearch", "json-fallback"].includes(health.engine));
  await index.close();
  const restored = createAnnIndex({ directory, dimension: 3 });
  assert.equal((await restored.search([0, 1, 0], 2))[0].unitId, "u2");
  await restored.close();
  await fs.rm(directory, { recursive: true, force: true });
});
