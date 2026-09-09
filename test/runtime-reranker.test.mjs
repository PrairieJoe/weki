import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRuntimeRerankerProvider } from "../src/runtime/reranker.mjs";
import { DEFAULT_RUNTIME_MANIFEST } from "../src/runtime/semantic-manifest.mjs";

test("default runtime catalog provides a distributable semantic reranker pack", () => {
  const component = DEFAULT_RUNTIME_MANIFEST.components.find((entry) => entry.id === "semantic-reranker");
  assert.ok(component);
  assert.equal(component.version, "1.0.0");
  assert.ok(component.files.some((file) => file.path === "reranker.mjs" && file.url?.startsWith("file:")));
});

test("runtime reranker is unavailable when the optional pack is missing", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "weki-reranker-missing-"));
  const provider = await createRuntimeRerankerProvider({ componentPath: directory });
  assert.equal(provider.available, false);
  assert.equal(provider.reason, "reranker_module_missing");
  await fs.rm(directory, { recursive: true, force: true });
});

test("runtime reranker delegates to the signed pack module", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "weki-reranker-ready-"));
  await fs.writeFile(path.join(directory, "reranker.mjs"), "export async function rerank(query, candidates) { return candidates.map((candidate) => ({ unitId: candidate.unitId, score: query === 'target' ? 1 : 0 })); }\n");
  const provider = await createRuntimeRerankerProvider({ componentPath: directory });
  assert.equal(provider.available, true);
  assert.deepEqual(await provider.rerank("target", [{ unitId: "u1" }]), [{ unitId: "u1", score: 1 }]);
  await fs.rm(directory, { recursive: true, force: true });
});
