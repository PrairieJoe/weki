const DEFAULT_API_BASE = "https://open-api.mybox.naver.com/v1";
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

const normalizeTimeout = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0
  ? Math.floor(Number(value))
  : fallback;

const responseError = async (response, operation) => {
  let detail = "";
  try { detail = (await response.json()).message || ""; } catch { /* non-JSON provider errors are handled by status */ }
  throw new Error(`MYBOX ${operation} 실패 (${response.status})${detail ? `: ${detail}` : ""}`);
};

export function createMyboxClient({
  token = process.env.NAVER_MBOX_TOKEN,
  fetchImpl = fetch,
  apiBase = DEFAULT_API_BASE,
  timeoutMs = normalizeTimeout(process.env.WEKI_MYBOX_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS),
  downloadTimeoutMs = normalizeTimeout(process.env.WEKI_MYBOX_DOWNLOAD_TIMEOUT_MS, DEFAULT_DOWNLOAD_TIMEOUT_MS),
} = {}) {
  const base = apiBase.replace(/\/$/, "");
  const headers = () => ({ Authorization: `Bearer ${token}` });
  const requireToken = () => { if (!token) throw new Error("MYBOX 개인 액세스 토큰이 설정되지 않았습니다."); };
  const request = async (url, options = {}, operation = "API 호출", requestTimeoutMs = timeoutMs, { keepTimeoutUntilBody = false } = {}) => {
    requireToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    let response;
    try {
      response = await fetchImpl(url, { ...options, signal: controller.signal, headers: { ...headers(), ...(options.headers || {}) } });
    } catch (error) {
      clearTimeout(timer);
      if (controller.signal.aborted) throw new Error(`MYBOX ${operation} 시간 초과 (${Math.ceil(requestTimeoutMs / 1000)}초).`);
      const causeCode = error?.cause?.code ? ` (${error.cause.code})` : "";
      throw new Error(`MYBOX ${operation} 실패: ${error?.message || "네트워크 요청 실패"}${causeCode}`);
    }
    if (!response.ok) {
      clearTimeout(timer);
      await responseError(response, operation);
    }
    if (keepTimeoutUntilBody && response.body) {
      const reader = response.body.getReader();
      let timerActive = true;
      const clearBodyTimer = () => {
        if (!timerActive) return;
        timerActive = false;
        clearTimeout(timer);
      };
      const body = new ReadableStream({
        async pull(streamController) {
          try {
            const chunk = await reader.read();
            if (chunk.done) {
              clearBodyTimer();
              streamController.close();
            } else {
              streamController.enqueue(chunk.value);
            }
          } catch (error) {
            clearBodyTimer();
            streamController.error(controller.signal.aborted
              ? new Error(`MYBOX ${operation} 시간 초과 (${Math.ceil(requestTimeoutMs / 1000)}초).`)
              : error);
          }
        },
        async cancel(reason) {
          clearBodyTimer();
          await reader.cancel(reason).catch(() => {});
        },
      });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    clearTimeout(timer);
    return response;
  };

  return {
    async listResources({ parentId, count = 1000 } = {}) {
      const params = new URLSearchParams({ count: String(count), sort: "modifiedAt,desc" });
      const endpoint = parentId ? `${base}/drive/folders/${encodeURIComponent(parentId)}/resources` : `${base}/drive/resources`;
      const response = await request(`${endpoint}?${params}`, {}, "파일 목록 조회");
      const data = await response.json();
      return data.resources || [];
    },
    async createFolder(folderName, parentId) {
      const body = { folderName };
      if (parentId) body.parentId = parentId;
      const response = await request(`${base}/drive/folders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, "폴더 생성");
      return response.json();
    },
    async uploadFile(bytes, fileName, parentId, { isOverwrite = false } = {}) {
      const metadata = { fileName, fileSize: bytes.byteLength, isOverwrite };
      if (parentId) metadata.parentId = parentId;
      const issued = await request(`${base}/drive/files`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(metadata) }, "업로드 URL 발급");
      const { uploadUrl } = await issued.json();
      if (!uploadUrl) throw new Error("MYBOX 업로드 URL을 받지 못했습니다.");
      const form = new FormData(); form.append("Filedata", new Blob([bytes]), fileName);
      return request(uploadUrl, { method: "POST", body: form }, "파일 업로드").then((response) => response.json());
    },
    async downloadFile(fileId, { timeoutMs: requestedTimeoutMs = downloadTimeoutMs } = {}) {
      const issued = await request(`${base}/drive/files/${encodeURIComponent(fileId)}/download`, {}, "다운로드 URL 발급");
      const { downloadUrl } = await issued.json();
      if (!downloadUrl) throw new Error("MYBOX 다운로드 URL을 받지 못했습니다.");
      return request(downloadUrl, {}, "파일 다운로드", normalizeTimeout(requestedTimeoutMs, downloadTimeoutMs), { keepTimeoutUntilBody: true });
    },
    async listBackups({ parentId, count = 1000 } = {}) {
      return (await this.listResources({ parentId, count })).filter((resource) => resource.type === "file" && /\.weki$/i.test(resource.name));
    },
    async uploadBackup(bytes, fileName, parentId) {
      return this.uploadFile(bytes, fileName, parentId);
    },
    async downloadBackup(fileId) {
      return this.downloadFile(fileId);
    },
    async storage() {
      const response = await request(`${base}/drive/storage`, {}, "저장공간 조회");
      return response.json();
    },
  };
}
