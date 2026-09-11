import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDefaultProcessingMode, normalizeProcessingSettings, resolveProcessingDefault, resolveRequestedProcessingMode } from "../src/server/processing-settings.mjs";

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

test("external AI is a permitted persisted default and legacy auto remains auto", () => {
  assert.equal(normalizeDefaultProcessingMode("external-ai"), "external-ai");
  assert.equal(normalizeDefaultProcessingMode("auto"), "auto");
  assert.equal(normalizeDefaultProcessingMode("legacy-value"), "auto");
});

test("auto never promotes itself to external AI merely because a provider is ready", () => {
  assert.equal(resolveProcessingDefault({ defaultProcessingMode: "auto" }, completeRuntime, { available: true }).effectiveDefaultMode, "local-ai");
});

test("external AI becomes effective only when the external provider is ready", () => {
  assert.equal(resolveProcessingDefault({ defaultProcessingMode: "external-ai" }, completeRuntime, { available: true }).effectiveDefaultMode, "external-ai");
});

test("external AI falls back to local AI when local runtime is ready", () => {
  assert.deepEqual(resolveRequestedProcessingMode("external-ai", {
    localAiAvailable: true,
    externalAiAvailable: false,
    externalFailureReason: "external_ai_not_configured",
  }), {
    requestedMode: "external-ai",
    effectiveMode: "local-ai",
    fallbackReason: "external_ai_not_configured",
    provider: null,
    modelId: null,
  });
});

test("external AI falls back to lightweight and preserves the external failure reason", () => {
  for (const reason of ["external_ai_not_configured", "external_ai_connection_failed"]) {
    assert.deepEqual(resolveRequestedProcessingMode("external-ai", {
      localAiAvailable: false,
      externalAiAvailable: false,
      externalFailureReason: reason,
    }), {
      requestedMode: "external-ai",
      effectiveMode: "lightweight",
      fallbackReason: reason,
      provider: null,
      modelId: null,
    });
  }
});
