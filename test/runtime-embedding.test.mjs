import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeEmbeddingProvider } from "../src/runtime/embedding.mjs";

test("runtime embedding provider reports unavailable cleanly when optional ONNX packages are absent", async () => {
  const provider = await createRuntimeEmbeddingProvider({ componentPath: "C:/missing-weki-model" });
  assert.equal(provider.available, false);
  await assert.rejects(() => provider.embed("query"));
});
