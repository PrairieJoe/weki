const DEFAULT_API_BASE = "https://open-api.mybox.naver.com/v1";

const responseError = async (response, operation) => {
  let detail = "";
  try { detail = (await response.json()).message || ""; } catch { /* non-JSON provider errors are handled by status */ }
  throw new Error(`MYBOX ${operation} 실패 (${response.status})${detail ? `: ${detail}` : ""}`);
};

export function createMyboxClient({ token = process.env.NAVER_MBOX_TOKEN, fetchImpl = fetch, apiBase = DEFAULT_API_BASE } = {}) {
  const base = apiBase.replace(/\/$/, "");
  const headers = () => ({ Authorization: `Bearer ${token}` });
  const requireToken = () => { if (!token) throw new Error("MYBOX 개인 액세스 토큰이 설정되지 않았습니다."); };
  const request = async (url, options = {}, operation = "API 호출") => {
    requireToken();
    const response = await fetchImpl(url, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
    if (!response.ok) await responseError(response, operation);
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
    async downloadFile(fileId) {
      const issued = await request(`${base}/drive/files/${encodeURIComponent(fileId)}/download`, {}, "다운로드 URL 발급");
      const { downloadUrl } = await issued.json();
      if (!downloadUrl) throw new Error("MYBOX 다운로드 URL을 받지 못했습니다.");
      return request(downloadUrl, {}, "파일 다운로드");
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
