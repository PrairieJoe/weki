import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { normalizeOriginalName } from "./original-storage.mjs";

export const BACKUP_FORMAT = "weki-cloud-backup";
export const BACKUP_VERSION = 1;
export const FOLDER_BACKUP_FORMAT = "weki-cloud-folder-backup";
export const FOLDER_BACKUP_VERSION = 2;

const clone = (value) => JSON.parse(JSON.stringify(value ?? null));
const withoutAbsoluteOriginalPath = (doc) => { const next = clone(doc); delete next.originalPath; return next; };
const documentKey = (doc) => doc.hash || `id:${doc.id}`;
const normalizedTerm = (term) => String(term || "").trim().toLowerCase();
const listOrEmpty = (value) => Array.isArray(value) ? value : [];

const documentQuality = (doc) => [
  doc.processingStatus === "completed" ? 1 : 0,
  listOrEmpty(doc.units).length,
  Date.parse(doc.updatedAt || doc.registeredAt || 0) || 0,
  ["available", "local_available"].includes(doc.sourceStatus) ? 1 : 0,
];

const compareQuality = (left, right) => {
  const a = documentQuality(left); const b = documentQuality(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
};

const mergeEntriesById = (left, right) => {
  const result = []; const seen = new Set();
  for (const entry of [...listOrEmpty(left), ...listOrEmpty(right)]) {
    const key = entry.id || JSON.stringify(entry);
    if (seen.has(key)) continue;
    seen.add(key); result.push(clone(entry));
  }
  return result;
};

const mergeSynonyms = (left, right) => {
  const result = []; const byTerm = new Map();
  for (const entry of [...listOrEmpty(left), ...listOrEmpty(right)]) {
    const key = normalizedTerm(entry.term);
    if (!key) continue;
    const existing = byTerm.get(key);
    if (!existing) {
      const next = { ...clone(entry), aliases: [...new Set(listOrEmpty(entry.aliases).map((alias) => String(alias).trim()).filter(Boolean))] };
      byTerm.set(key, next); result.push(next); continue;
    }
    existing.aliases = [...new Set([...existing.aliases, ...listOrEmpty(entry.aliases).map((alias) => String(alias).trim()).filter(Boolean)])];
    existing.approved = Boolean(existing.approved || entry.approved);
    if ((Date.parse(entry.updatedAt || entry.createdAt || 0) || 0) > (Date.parse(existing.updatedAt || existing.createdAt || 0) || 0)) existing.updatedAt = entry.updatedAt;
  }
  return result;
};

export async function createBackupSnapshot(db, originalsDir, { now = () => new Date().toISOString(), readFile = fs.readFile, resolveOriginalPath = (doc) => doc.originalPath } = {}) {
  const documents = listOrEmpty(db.documents).map(withoutAbsoluteOriginalPath);
  const originals = {};
  for (const doc of listOrEmpty(db.documents)) {
    const originalPath = resolveOriginalPath(doc);
    if (!["available", "local_available"].includes(doc.sourceStatus) || !originalPath) continue;
    const bytes = await readFile(originalPath);
    const actualHash = crypto.createHash("sha256").update(bytes).digest("hex");
    if (doc.hash && actualHash !== doc.hash) throw new Error(`원본 Hash가 문서와 일치하지 않습니다: ${doc.name || doc.id}`);
    const hash = doc.hash || actualHash;
    originals[hash] = { name: normalizeOriginalName(doc.originalName || doc.name || path.basename(originalPath)), format: doc.format, data: Buffer.from(bytes).toString("base64") };
  }
  const createdAt = now();
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    type: "full",
    createdAt,
    manifest: {
      documentCount: documents.length,
      originalCount: Object.keys(originals).length,
      createdAt,
      source: "Weki",
    },
    database: { ...clone(db), documents, jobs: [], maintenance: null },
    originals,
  };
}

const collisionSafeName = (name, hash, usedNames) => {
  if (!usedNames.has(name)) return name;
  const extension = path.extname(name); const stem = path.basename(name, extension); const candidate = `${stem} (${hash.slice(0, 8)})${extension}`;
  if (!usedNames.has(candidate)) return candidate;
  let index = 2; while (usedNames.has(`${stem} (${hash.slice(0, 8)})-${index}${extension}`)) index += 1;
  return `${stem} (${hash.slice(0, 8)})-${index}${extension}`;
};

export async function createFolderSnapshot(db, { now = () => new Date().toISOString(), readFile = fs.readFile, resolveOriginalPath = (doc) => doc.originalPath, remoteManifest = [] } = {}) {
  const originalFiles = []; const manifest = []; const nameByHash = new Map();
  const documents = listOrEmpty(db.documents).map((doc) => { const next = withoutAbsoluteOriginalPath(doc); next.originalFile = null; return next; });
  const remoteByPath = new Map(listOrEmpty(remoteManifest).map((entry) => [`data/${entry.storagePath}`, entry]));
  const includedManifest = new Set();
  for (let index = 0; index < listOrEmpty(db.documents).length; index += 1) {
    const doc = db.documents[index]; const target = documents[index];
    const originalPath = resolveOriginalPath(doc);
    if (!["available", "local_available"].includes(doc.sourceStatus) || !originalPath) {
      const remote = doc.cloudOriginalFile && remoteByPath.get(doc.cloudOriginalFile);
      if (remote) {
        target.originalFile = doc.cloudOriginalFile;
        if (!includedManifest.has(remote.storagePath)) { manifest.push({ ...remote }); includedManifest.add(remote.storagePath); }
      }
      continue;
    }
    const bytes = await readFile(originalPath); const actualHash = crypto.createHash("sha256").update(bytes).digest("hex");
    if (doc.hash && actualHash !== doc.hash) throw new Error(`원본 Hash가 문서와 일치하지 않습니다: ${doc.name || doc.id}`);
    const hash = doc.hash || actualHash; let storedName = nameByHash.get(hash);
    const originalName = normalizeOriginalName(doc.originalName || doc.name || path.basename(originalPath));
    if (!storedName) { storedName = originalName; nameByHash.set(hash, storedName); const storagePath = `${hash}/${storedName}`; originalFiles.push({ fileName: storedName, storagePath, originalName, format: doc.format, hash, data: Buffer.from(bytes) }); manifest.push({ fileName: storedName, storagePath, originalName, format: doc.format, hash, size: bytes.byteLength }); includedManifest.add(storagePath); }
    target.originalFile = `data/${hash}/${storedName}`;
  }
  const createdAt = now();
  return {
    json: { format: FOLDER_BACKUP_FORMAT, version: FOLDER_BACKUP_VERSION, type: "full", createdAt, manifest: { documentCount: documents.length, originalCount: originalFiles.length, files: manifest, createdAt, source: "Weki" }, database: { ...clone(db), documents, jobs: [], maintenance: null } },
    originals: originalFiles,
  };
}

export function reconcileFolderSnapshotOriginals(snapshot, { remoteManifest = [] } = {}) {
  const next = { json: clone(snapshot.json), originals: snapshot.originals.map((original) => ({ ...original })) };
  const remoteByHash = new Map(); for (const entry of remoteManifest) if (entry?.hash && !remoteByHash.has(entry.hash)) remoteByHash.set(entry.hash, entry);
  const remap = (original, newName, originalName = original.originalName, storagePath = `${original.hash}/${newName}`) => {
    const oldName = original.fileName; original.fileName = newName; const entry = next.json.manifest.files.find((item) => item.fileName === oldName && item.hash === original.hash); if (entry) { entry.fileName = newName; entry.originalName = originalName; }
    original.storagePath = storagePath; if (entry) entry.storagePath = storagePath;
    for (const doc of next.json.database.documents) if (doc.originalFile === `data/${oldName}` || doc.originalFile === `data/${original.hash}/${oldName}`) doc.originalFile = `data/${storagePath}`;
  };
  for (const original of next.originals) {
    const existingByHash = remoteByHash.get(original.hash);
    if (existingByHash) { remap(original, existingByHash.fileName, existingByHash.originalName || original.originalName, existingByHash.storagePath || `${existingByHash.hash}/${existingByHash.fileName}`); original.skipUpload = true; }
  }
  return next;
}

export function validateFolderSnapshot(snapshot) {
  if (!snapshot || snapshot.format !== FOLDER_BACKUP_FORMAT || snapshot.version !== FOLDER_BACKUP_VERSION || snapshot.type !== "full") throw new Error("유효하지 않은 Weki 폴더 백업입니다.");
  if (!snapshot.manifest || !Number.isInteger(snapshot.manifest.documentCount) || !Array.isArray(snapshot.manifest.files) || !snapshot.database || !Array.isArray(snapshot.database.documents)) throw new Error("Weki 폴더 백업 Manifest가 손상되었습니다.");
  if (snapshot.manifest.documentCount !== snapshot.database.documents.length || snapshot.manifest.originalCount !== snapshot.manifest.files.length) throw new Error("Weki 폴더 백업 수량이 일치하지 않습니다.");
  const files = new Set(snapshot.manifest.files.map((entry) => entry.storagePath));
  for (const doc of snapshot.database.documents) if (doc.originalFile && (!doc.originalFile.startsWith("data/") || !files.has(doc.originalFile.slice("data/".length)))) throw new Error("Weki 폴더 백업 Manifest 참조가 손상되었습니다.");
  for (const entry of snapshot.manifest.files) if (!entry?.fileName || path.basename(entry.fileName) !== entry.fileName || !/^[a-f0-9]{64}$/i.test(entry.hash || "") || entry.storagePath !== `${entry.hash}/${entry.fileName}`) throw new Error("Weki 폴더 백업 원본 정보가 손상되었습니다.");
  return snapshot;
}

export function removeDocumentData(db, documentId, deletedAt = new Date().toISOString()) {
  const document = listOrEmpty(db.documents).find((item) => item.id === documentId);
  if (!document) throw new Error("문서를 찾을 수 없습니다.");
  const database = { ...clone(db), documents: listOrEmpty(db.documents).filter((item) => item.id !== documentId), jobs: listOrEmpty(db.jobs).filter((job) => job.documentId !== documentId), audit: [{ id: crypto.randomUUID(), type: "document-delete", documentId, createdAt: deletedAt, detail: `${document.name || documentId} 문서 삭제` }, ...listOrEmpty(db.audit)] };
  return { database, document: clone(document) };
}

export function validateBackupSnapshot(snapshot) {
  if (!snapshot || snapshot.format !== BACKUP_FORMAT || snapshot.version !== BACKUP_VERSION || snapshot.type !== "full") throw new Error("유효하지 않은 Weki 백업 패키지입니다.");
  if (!snapshot.manifest || !Number.isInteger(snapshot.manifest.documentCount) || !snapshot.database || !Array.isArray(snapshot.database.documents) || !snapshot.originals || typeof snapshot.originals !== "object") throw new Error("백업 Manifest 또는 데이터가 손상되었습니다.");
  if (snapshot.manifest.documentCount !== snapshot.database.documents.length) throw new Error("백업 문서 수가 Manifest와 일치하지 않습니다.");
  for (const [hash, original] of Object.entries(snapshot.originals)) {
    if (!/^[a-f0-9]{64}$/i.test(hash) || !original?.data) throw new Error("백업 원본 데이터가 손상되었습니다.");
    const actualHash = crypto.createHash("sha256").update(Buffer.from(original.data, "base64")).digest("hex");
    if (actualHash !== hash) throw new Error("백업 원본 Hash 검증에 실패했습니다.");
  }
  return snapshot;
}

export function mergeDatabases(localDb, remoteDb) {
  const documents = []; const index = new Map(); let conflicts = 0;
  for (const candidate of [...listOrEmpty(localDb?.documents), ...listOrEmpty(remoteDb?.documents)]) {
    const next = clone(candidate); const key = documentKey(next); const existingIndex = index.get(key);
    if (existingIndex === undefined) { index.set(key, documents.length); documents.push(next); continue; }
    conflicts += 1;
    if (compareQuality(next, documents[existingIndex]) > 0) documents[existingIndex] = next;
  }
  const merged = {
    ...(clone(localDb) || {}),
    documents,
    synonyms: mergeSynonyms(localDb?.synonyms, remoteDb?.synonyms),
    feedback: mergeEntriesById(localDb?.feedback, remoteDb?.feedback),
    audit: mergeEntriesById(localDb?.audit, remoteDb?.audit),
    jobs: listOrEmpty(localDb?.jobs).filter((job) => !["processing", "queued", "paused"].includes(job.status)).map(clone),
    maintenance: null,
  };
  return { database: merged, mergedDocuments: documents.length, conflicts };
}

export function buildPageMetrics(pages, units) {
  const sourcePages = listOrEmpty(pages); const indexedUnits = listOrEmpty(units);
  const searchablePages = new Set(indexedUnits.map((unit) => unit.range).filter((range) => range !== undefined && range !== null));
  const pageCount = sourcePages.length;
  const searchablePageCount = searchablePages.size;
  const failedPageCount = Math.max(0, pageCount - searchablePageCount);
  return { pageCount, searchablePageCount, indexedUnitCount: indexedUnits.length, failedPageCount, processingStatus: failedPageCount ? "partial" : "completed" };
}
