import crypto from "node:crypto";
import fs from "node:fs/promises";

import { mergeDatabases, validateFolderSnapshot } from "./backup.mjs";
import { normalizeOriginalName } from "./original-storage.mjs";

export const CLOUD_FOLDER_NAME = "weki";
export const CLOUD_DATA_FOLDER_NAME = "data";
export const CLOUD_CATALOG_NAME = "knowledge-base.json";

const clone = (value) => JSON.parse(JSON.stringify(value ?? null));
const resourceType = (resource) => String(resource?.type || "").toLowerCase();
const normalizedName = (value) => {
  try { return decodeURIComponent(String(value || "")).normalize("NFC").toLowerCase(); } catch { return String(value || "").normalize("NFC").toLowerCase(); }
};
const isFolder = (resource, name) => resourceType(resource) === "folder" && normalizedName(resource.name) === normalizedName(name);
const isFile = (resource, name) => resourceType(resource) === "file" && normalizedName(resource.name) === normalizedName(name);
export function cloudOriginalPath(reference) {
  const value = String(reference || "");
  const match = value.match(/^data\/([a-f0-9]{64})\/([^/\\]+)$/i);
  if (!match || !match[2] || match[2] === "." || match[2] === "..") throw new Error("새 Weki 백업 구조가 완성되지 않았습니다.");
  return { hash: match[1].toLowerCase(), fileName: match[2], storagePath: `${match[1]}/${match[2]}` };
}

export async function findWekiFolderStructure(mybox, { parentId, create = false } = {}) {
  const rootResources = await mybox.listResources({ parentId });
  let weki = rootResources.find((resource) => isFolder(resource, CLOUD_FOLDER_NAME));
  if (!weki && create) weki = await mybox.createFolder(CLOUD_FOLDER_NAME, parentId);
  if (!weki) return null;
  const resources = await mybox.listResources({ parentId: weki.resourceId });
  let data = resources.find((resource) => isFolder(resource, CLOUD_DATA_FOLDER_NAME));
  if (!data && create) data = await mybox.createFolder(CLOUD_DATA_FOLDER_NAME, weki.resourceId);
  return { parentId, weki, data, json: resources.find((resource) => isFile(resource, CLOUD_CATALOG_NAME)), resources, rootResources };
}

export async function readCloudCatalog(mybox, structure) {
  if (!structure?.weki || !structure.json) throw new Error("MYBOX에 새 Weki 백업이 없습니다.");
  if (!structure.data) throw new Error("새 Weki 백업 구조가 완성되지 않았습니다.");
  const response = await mybox.downloadFile(structure.json.resourceId);
  let snapshot;
  try { snapshot = JSON.parse(Buffer.from(await response.arrayBuffer()).toString("utf8")); } catch { throw new Error("Weki 폴더 백업 JSON을 읽을 수 없습니다."); }
  validateFolderSnapshot(snapshot);
  for (const doc of snapshot.database.documents || []) {
    if (doc.originalFile) cloudOriginalPath(doc.originalFile);
  }
  return { snapshot, structure };
}

export async function findCloudOriginalResource(mybox, structure, reference) {
  if (!structure?.data) throw new Error("새 Weki 백업 구조가 완성되지 않았습니다.");
  const target = cloudOriginalPath(reference);
  const dataResources = await mybox.listResources({ parentId: structure.data.resourceId });
  const hashFolder = dataResources.find((resource) => isFolder(resource, target.hash));
  if (!hashFolder) throw new Error(`MYBOX 원본 파일이 없습니다: ${target.fileName}`);
  const folderResources = await mybox.listResources({ parentId: hashFolder.resourceId });
  const resource = folderResources.find((item) => isFile(item, target.fileName));
  if (!resource) throw new Error(`MYBOX 원본 파일이 없습니다: ${target.fileName}`);
  return { ...target, resource };
}

export async function downloadCloudOriginal(mybox, structure, reference, expectedHash) {
  const target = await findCloudOriginalResource(mybox, structure, reference);
  if (expectedHash && String(expectedHash).toLowerCase() !== target.hash) throw new Error("MYBOX 원본 경로와 문서 Hash가 일치하지 않습니다.");
  const response = await mybox.downloadFile(target.resource.resourceId);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualHash = crypto.createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== target.hash) throw new Error(`MYBOX 원본 Hash 검증에 실패했습니다: ${target.fileName}`);
  return { bytes, fileName: target.fileName, hash: target.hash, resourceId: target.resource.resourceId, cloudOriginalFile: reference };
}

async function hasVerifiedLocalOriginal(document, resolveLocalPath, readFile) {
  if (!resolveLocalPath || !document?.hash) return false;
  const localPath = resolveLocalPath(document);
  if (!localPath) return false;
  try {
    const bytes = await readFile(localPath);
    return crypto.createHash("sha256").update(bytes).digest("hex") === String(document.hash).toLowerCase();
  } catch { return false; }
}

export async function mergeCloudCatalog(localDb, snapshot, { resolveLocalPath, readFile } = {}) {
  const read = readFile || fs.readFile;
  const remoteDb = clone(snapshot.database) || {};
  const manifestByPath = new Map((snapshot.manifest?.files || []).map((entry) => [`data/${entry.storagePath}`, entry]));
  for (const doc of remoteDb.documents || []) {
    const entry = doc.originalFile ? manifestByPath.get(doc.originalFile) : null;
    if (entry) {
      doc.cloudOriginalFile = doc.originalFile;
      const originalName = normalizeOriginalName(entry.originalName || entry.fileName || doc.originalName || doc.name, `${entry.hash}.bin`);
      doc.originalName = doc.originalName || originalName;
      doc.originalKey = `${entry.hash}/${originalName}`;
    } else {
      delete doc.cloudOriginalFile;
      doc.originalKey = null;
    }
    doc.sourceStatus = await hasVerifiedLocalOriginal(doc, resolveLocalPath, read) ? "local_available" : doc.cloudOriginalFile ? "cloud_available" : "unavailable";
    delete doc.originalPath;
  }

  const result = mergeDatabases(localDb, remoteDb);
  const remoteByHash = new Map((remoteDb.documents || []).filter((doc) => doc.hash).map((doc) => [doc.hash, doc]));
  for (const doc of result.database.documents || []) {
    const remote = remoteByHash.get(doc.hash);
    if (remote?.cloudOriginalFile && !doc.cloudOriginalFile) doc.cloudOriginalFile = remote.cloudOriginalFile;
    if (remote?.originalKey && !doc.originalKey) doc.originalKey = remote.originalKey;
    delete doc.originalPath;
    doc.sourceStatus = await hasVerifiedLocalOriginal(doc, resolveLocalPath, read) ? "local_available" : doc.cloudOriginalFile ? "cloud_available" : "unavailable";
  }
  return result;
}

export function shouldRunInitialMyboxSync({ newlyCreated, documentCount, hasToken } = {}) {
  return Boolean(newlyCreated && Number(documentCount) === 0 && hasToken);
}
