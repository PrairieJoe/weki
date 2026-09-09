export const DEFAULT_PROCESSING_MODE = "auto";
export const PROCESSING_DEFAULT_MODES = new Set(["auto", "lightweight", "local-ai"]);
export const RUNTIME_COMPONENT_IDS = ["semantic-model", "semantic-reranker", "document-renderer"];

export function normalizeProcessingSettings(settings = {}) {
  const defaultProcessingMode = PROCESSING_DEFAULT_MODES.has(settings.defaultProcessingMode)
    ? settings.defaultProcessingMode
    : DEFAULT_PROCESSING_MODE;
  return { defaultProcessingMode };
}

function isApplied(component) {
  return component?.status === "ready" && component?.applied === true;
}

export function resolveProcessingDefault(settings = {}, components = {}) {
  const normalized = normalizeProcessingSettings(settings);
  const semanticModelReady = isApplied(components["semantic-model"]);
  const localAiEligible = RUNTIME_COMPONENT_IDS.every((id) => isApplied(components[id]));
  let effectiveDefaultMode = "lightweight";
  let localAiEligibilityReason = localAiEligible ? null : "runtime_components_incomplete";

  if (normalized.defaultProcessingMode === "lightweight") {
    localAiEligibilityReason = "configured_lightweight";
  } else if (normalized.defaultProcessingMode === "local-ai") {
    if (semanticModelReady) effectiveDefaultMode = "local-ai";
    else localAiEligibilityReason = "semantic_model_unavailable";
  } else if (localAiEligible) {
    effectiveDefaultMode = "local-ai";
    localAiEligibilityReason = null;
  }

  return {
    defaultMode: normalized.defaultProcessingMode,
    effectiveDefaultMode,
    localAiEligible,
    localAiEligibilityReason,
  };
}
