export const DEFAULT_PROCESSING_MODE = "auto";
export const PROCESSING_DEFAULT_MODES = new Set(["auto", "lightweight", "local-ai", "external-ai"]);
export const RUNTIME_COMPONENT_IDS = ["semantic-model", "semantic-reranker", "document-renderer"];

const SAFE_EXTERNAL_FAILURE_REASONS = new Set([
  "external_ai_not_configured",
  "external_ai_model_not_selected",
  "external_ai_connection_failed",
  "external_ai_invalid_key",
  "external_ai_permission_denied",
  "external_ai_rate_limited",
  "external_ai_provider_error",
  "external_ai_timeout",
  "external_ai_invalid_response",
]);

export function normalizeDefaultProcessingMode(value) {
  return PROCESSING_DEFAULT_MODES.has(value) ? value : DEFAULT_PROCESSING_MODE;
}

export function normalizeProcessingSettings(settings = {}) {
  return { defaultProcessingMode: normalizeDefaultProcessingMode(settings.defaultProcessingMode) };
}

function isApplied(component) {
  return component?.status === "ready" && component?.applied === true;
}

function externalFailureReason(externalStatus = {}) {
  const requested = externalStatus.failureReason ?? externalStatus.errorCode;
  if (SAFE_EXTERNAL_FAILURE_REASONS.has(requested)) return requested;
  if (externalStatus.configured === false) return "external_ai_not_configured";
  if (externalStatus.modelSelected === false) return "external_ai_model_not_selected";
  if (externalStatus.connectionStatus === "failed" || externalStatus.lastConnection?.status === "failed") return "external_ai_connection_failed";
  return "external_ai_connection_failed";
}

function externalProviderValue(externalProvider) {
  if (typeof externalProvider === "string") return externalProvider || null;
  return externalProvider?.provider || externalProvider?.name || null;
}

function externalModelValue(externalModelId, externalProvider) {
  return externalModelId || externalProvider?.modelId || externalProvider?.model || null;
}

export function resolveRequestedProcessingMode(requestedMode, {
  localAiAvailable = false,
  externalAiAvailable = false,
  externalProvider = null,
  externalModelId = null,
  externalFailureReason: requestedExternalFailureReason,
} = {}) {
  const normalizedRequestedMode = normalizeDefaultProcessingMode(requestedMode);
  const localAvailable = Boolean(localAiAvailable);
  const externalAvailable = Boolean(externalAiAvailable);
  const safeExternalReason = SAFE_EXTERNAL_FAILURE_REASONS.has(requestedExternalFailureReason)
    ? requestedExternalFailureReason
    : requestedExternalFailureReason ? "external_ai_connection_failed" : null;
  if (normalizedRequestedMode === "lightweight") {
    return { requestedMode: normalizedRequestedMode, effectiveMode: "lightweight", fallbackReason: null, provider: null, modelId: null };
  }
  if (normalizedRequestedMode === "local-ai") {
    return {
      requestedMode: normalizedRequestedMode,
      effectiveMode: localAvailable ? "local-ai" : "lightweight",
      fallbackReason: localAvailable ? null : "semantic_model_unavailable",
      provider: null,
      modelId: null,
    };
  }
  if (normalizedRequestedMode === "external-ai") {
    if (externalAvailable) {
      return {
        requestedMode: normalizedRequestedMode,
        effectiveMode: "external-ai",
        fallbackReason: null,
        provider: externalProviderValue(externalProvider),
        modelId: externalModelValue(externalModelId, externalProvider),
      };
    }
    const fallbackReason = safeExternalReason || "external_ai_connection_failed";
    return {
      requestedMode: normalizedRequestedMode,
      effectiveMode: localAvailable ? "local-ai" : "lightweight",
      fallbackReason,
      provider: null,
      modelId: null,
    };
  }
  // `auto` is deliberately a local policy. Provider readiness never promotes it.
  return {
    requestedMode: "auto",
    effectiveMode: localAvailable ? "local-ai" : "lightweight",
    fallbackReason: localAvailable ? null : "runtime_components_incomplete",
    provider: null,
    modelId: null,
  };
}

export function resolveProcessingDefault(settings = {}, components = {}, externalStatus = {}) {
  const normalized = normalizeProcessingSettings(settings);
  const semanticModelReady = isApplied(components["semantic-model"]);
  const localAiEligible = RUNTIME_COMPONENT_IDS.every((id) => isApplied(components[id]));
  const localAiAvailable = semanticModelReady;
  const externalAiEnabled = normalized.defaultProcessingMode === "external-ai";
  const connectionReady = externalStatus.connectionStatus === "ready"
    || externalStatus.lastConnection?.status === "ready"
    || externalStatus.connection?.status === "ready";
  const externalAiReady = Boolean(
    externalStatus.available
      || externalStatus.ready
      || (externalStatus.configured !== false && externalStatus.modelSelected !== false && connectionReady),
  );
  const externalReason = externalFailureReason(externalStatus);
  let resolved;
  if (normalized.defaultProcessingMode === "external-ai") {
    resolved = resolveRequestedProcessingMode("external-ai", {
      localAiAvailable,
      externalAiAvailable: externalAiReady,
      externalProvider: externalStatus.provider,
      externalModelId: externalStatus.modelId,
      externalFailureReason: externalReason,
    });
  } else if (normalized.defaultProcessingMode === "local-ai") {
    resolved = resolveRequestedProcessingMode("local-ai", { localAiAvailable });
  } else if (normalized.defaultProcessingMode === "lightweight") {
    resolved = resolveRequestedProcessingMode("lightweight");
  } else {
    resolved = resolveRequestedProcessingMode("auto", { localAiAvailable: localAiEligible });
  }
  const localAiEligibilityReason = normalized.defaultProcessingMode === "lightweight"
    ? "configured_lightweight"
    : normalized.defaultProcessingMode === "auto"
      ? (localAiEligible ? null : "runtime_components_incomplete")
      : resolved.effectiveMode === "local-ai" && resolved.fallbackReason === null
        ? null
        : resolved.fallbackReason;
  return {
    defaultMode: normalized.defaultProcessingMode,
    effectiveDefaultMode: resolved.effectiveMode,
    localAiAvailable,
    externalAiEnabled,
    externalAiReady,
    fallbackReason: resolved.fallbackReason,
    // Legacy response fields remain available to existing clients.
    localAiEligible,
    localAiEligibilityReason,
  };
}
