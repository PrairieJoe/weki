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
    localAiAvailable: false,
    externalAiEnabled: false,
    externalAiReady: false,
    fallbackReason: "runtime_components_incomplete",
    localAiEligible: false,
    localAiEligibilityReason: "runtime_components_incomplete",
  });
  assert.equal(resolveProcessingDefault({}, { "semantic-model": applied("semantic-model") }).effectiveDefaultMode, "lightweight");
});

test("automatic processing switches new work to Local AI after all packs apply", () => {
  assert.deepEqual(resolveProcessingDefault({}, completeRuntime), {
    defaultMode: "auto",
    effectiveDefaultMode: "local-ai",
    localAiAvailable: true,
    externalAiEnabled: false,
    externalAiReady: false,
    fallbackReason: null,
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

test("requested processing modes follow the explicit external-to-local-to-lightweight order", () => {
  const cases = [
    ["lightweight", {}, { requestedMode: "lightweight", effectiveMode: "lightweight", fallbackReason: null, provider: null, modelId: null }],
    ["local-ai", { localAiAvailable: true }, { requestedMode: "local-ai", effectiveMode: "local-ai", fallbackReason: null, provider: null, modelId: null }],
    ["local-ai", {}, { requestedMode: "local-ai", effectiveMode: "lightweight", fallbackReason: "semantic_model_unavailable", provider: null, modelId: null }],
    ["external-ai", { externalAiAvailable: true, externalProvider: "gemini", externalModelId: "gemini-2.5-flash" }, { requestedMode: "external-ai", effectiveMode: "external-ai", fallbackReason: null, provider: "gemini", modelId: "gemini-2.5-flash" }],
    ["external-ai", { localAiAvailable: true, externalFailureReason: "external_ai_timeout" }, { requestedMode: "external-ai", effectiveMode: "local-ai", fallbackReason: "external_ai_timeout", provider: null, modelId: null }],
    ["external-ai", { externalFailureReason: "external_ai_invalid_response" }, { requestedMode: "external-ai", effectiveMode: "lightweight", fallbackReason: "external_ai_invalid_response", provider: null, modelId: null }],
  ];
  for (const [requestedMode, context, expected] of cases) assert.deepEqual(resolveRequestedProcessingMode(requestedMode, context), expected);
});

test("external default reports readiness separately and auto remains local-only", () => {
  const external = { configured: true, modelSelected: true, connectionStatus: "ready", provider: "gemini", modelId: "gemini-test", available: true };
  assert.deepEqual(resolveProcessingDefault({ defaultProcessingMode: "external-ai" }, completeRuntime, external), {
    defaultMode: "external-ai",
    effectiveDefaultMode: "external-ai",
    localAiAvailable: true,
    externalAiEnabled: true,
    externalAiReady: true,
    fallbackReason: null,
    localAiEligible: true,
    localAiEligibilityReason: null,
  });
  assert.equal(resolveProcessingDefault({ defaultProcessingMode: "auto" }, completeRuntime, external).effectiveDefaultMode, "local-ai");

  const globallyOff = { ...external, enabled: false };
  const offResolution = resolveProcessingDefault({ defaultProcessingMode: "external-ai" }, completeRuntime, globallyOff);
  assert.equal(offResolution.externalAiReady, false);
  assert.equal(offResolution.effectiveDefaultMode, "local-ai");
  assert.equal(offResolution.fallbackReason, "external_ai_disabled");
});
