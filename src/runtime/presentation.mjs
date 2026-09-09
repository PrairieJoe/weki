const activeJobStatuses = new Set(["queued", "processing", "paused"]);
const componentLabels = {
  "semantic-model": "의미 검색 모델",
  "semantic-reranker": "검색 결과 재정렬 모델",
  "document-renderer": "문서 화면 처리기",
};

export function runtimeAction(entry, metadata) {
  if (!metadata || entry?.reason === "runtime_pack_not_configured") return null;
  if(entry?.id==="document-renderer"&&metadata?.sourceType!=="mybox")return null;
  if (entry?.status === "failed") return { label: "재시도", disabled: false };
  if (entry?.status === "installing") return { label: "진행 중", disabled: true };
  if (entry?.status === "ready" && entry?.updateAvailable) return { label: "업데이트", disabled: false };
  if (entry?.status === "ready" && !entry?.applied) return { label: "재시작 필요", disabled: true };
  if (entry?.status === "ready" && entry?.applied && !entry?.updateAvailable) return { label: "최신 상태", disabled: true };
  return { label: "설치", disabled: false };
}

export function shouldAutoRestart(batch, jobs = []) {
  const installed = batch?.installed || [];
  const failed = batch?.failed || [];
  return ["ready", "partial"].includes(batch?.status)
    && installed.length > 0
    && failed.length === 0
    && !jobs.some((job) => activeJobStatuses.has(job?.status));
}

export function runtimeBatchMessage(batch) {
  if (batch?.status === "ready") return "모든 검색 구성요소 설치가 완료되었습니다.";
  const unavailable = batch?.unavailable || [];
  const skipped = batch?.skipped || [];
  const failed = batch?.failed || [];
  const failedLabels = failed.map((entry) => {
    const id = typeof entry === "string" ? entry : entry?.id;
    return componentLabels[id] || id;
  }).filter(Boolean);
  if (failedLabels.length || batch?.status === "failed") {
    return failedLabels.length
      ? `일부 구성요소 설치에 실패했습니다: ${failedLabels.join(", ")}. 오류 원인을 확인하고 재시도하세요.`
      : batch.error ? `구성요소 설치에 실패했습니다: ${batch.error}` : "구성요소 설치에 실패했습니다.";
  }
  const unavailableLabels = unavailable.map((id) => componentLabels[id] || id);
  if (batch?.status === "partial" && unavailableLabels.length) {
    return `설치 가능한 구성요소 설치가 완료되었습니다. ${unavailableLabels.join(", ")}는 MYBOX 배포본이 없어 보류되었습니다.`;
  }
  const skippedLabels = skipped.map((id) => componentLabels[id] || id);
  if (skippedLabels.length) return `${skippedLabels.join(", ")}는 배포본이 없어 설치하지 못했습니다.`;
  if (batch?.status === "partial") return "설치 가능한 구성요소 설치가 완료되었습니다.";
  return "";
}
