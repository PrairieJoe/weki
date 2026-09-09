import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProcessingSettings, resolveProcessingDefault } from "../src/server/processing-settings.mjs";

const applied = (id) => ({ id, status: "ready", applied: true });
const completeRuntime = {
  "semantic-model": applied("semantic-model"),
  "semantic-reranker": applied("semantic-reranker"),
  "document-renderer": applied("document-renderer"),
};

test("processing settings default to automatic lightweight processing until all packs apply", () => {
  assert.deepEqual(normalizeProcessingSettings(), { defaultProcessingMode: "auto" });
  assert.deepEqual(resolveProcessingDefault(), {
    defaultMode: "auto",
    effectiveDefaultMode: "lightweight",
    localAiEligible: false,
    localAiEligibilityReason: "runtime_components_incomplete",
  });
  assert.equal(resolveProcessingDefault({}, { "semantic-model": applied("semantic-model") }).effectiveDefaultMode, "lightweight");
});

test("automatic processing switches new work to Local AI after all packs apply", () => {
  assert.deepEqual(resolveProcessingDefault({}, completeRuntime), {
    defaultMode: "auto",
    effectiveDefaultMode: "local-ai",
    localAiEligible: true,
    localAiEligibilityReason: null,
  });
});

test("explicit processing preferences remain stable and explain fallbacks", () => {
  assert.equal(resolveProcessingDefault({ defaultProcessingMode: "lightweight" }, completeRuntime).effectiveDefaultMode, "lightweight");
  assert.equal(resolveProcessingDefault({ defaultProcessingMode: "lightweight" }, completeRuntime).localAiEligibilityReason, "configured_lightweight");
  assert.equal(resolveProcessingDefault({ defaultProcessingMode: "local-ai" }, { "semantic-model": applied("semantic-model") }).effectiveDefaultMode, "local-ai");
  assert.equal(resolveProcessingDefault({ defaultProcessingMode: "local-ai" }).effectiveDefaultMode, "lightweight");
  assert.equal(resolveProcessingDefault({ defaultProcessingMode: "local-ai" }).localAiEligibilityReason, "semantic_model_unavailable");
});
