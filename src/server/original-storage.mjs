import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const ORIGINAL_STORAGE_LAYOUT_VERSION = 2;

const HASHED_ORIGINAL = /^([a-f0-9]{64})\/([^/\\]+)$/i;
const LEGACY_HASHED_ORIGINAL = /^([a-f0-9]{64})\.([a-z0-9]+)$/i;

export function normalizeOriginalName(name, fallback = "original.bin") {
  const candidate = path.basename(String(name || "")).normalize("NFC");
  const sanitized = candidate.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").trim();
  return sanitized && sanitized !== "." && sanitized !== ".." ? sanitized : fallback;
}

const extensionOf = (document) => {
  const fromName = path.extname(String(document?.originalName || document?.name || "")).slice(1);
  const fromPath = path.extname(String(document?.originalPath || "")).slice(1);
  return String(fromName || fromPath || document?.format || "bin").replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
};

export function originalNameOf(document = {}, fallback) {
  const fallbackName = fallback || `original.${extensionOf(document)}`;
  return normalizeOriginalName(document.originalName || document.name || fallbackName, fallbackName);
}

export function documentOriginalKey(document = {}) {
  const existing = String(document.originalKey || "").replaceAll("\\", "/");
  const existingMatch = existing.match(HASHED_ORIGINAL);
  if (existingMatch) return `${existingMatch[1].toLowerCase()}/${normalizeOriginalName(existingMatch[2])}`;
  const hash = String(document.hash || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  return `${hash}/${originalNameOf(document, `${hash}.${extensionOf(document)}`)}`;
}

export function resolveDocumentOriginalPath(dataDir, document = {}) {
  const key = documentOriginalKey(document);
  return key ? path.join(dataDir, "originals", ...key.split("/")) : null;
}

export function originalKeyParts(key) {
  const match = String(key || "").replaceAll("\\", "/").match(HASHED_ORIGINAL);
  return match ? { hash: match[1].toLowerCase(), fileName: normalizeOriginalName(match[2]) } : null;
}

export async function migrateLegacyOriginals(dataDir, documents, { readFile = fs.readFile, readdir = fs.readdir, mkdir = fs.mkdir, rename = fs.rename, unlink = fs.unlink } = {}) {
  const originalsDir = path.join(dataDir, "originals");
  const entries = await readdir(originalsDir, { withFileTypes: true }).catch(() => []);
  const documentsByHash = new Map();
  for (const document of documents || []) {
    const hash = String(document?.hash || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) continue;
    const list = documentsByHash.get(hash) || [];
    list.push(document);
    documentsByHash.set(hash, list);
  }

  let migrated = 0;
  let failed = 0;
  let changed = false;
  const failures = [];
  const markMissing = (documents) => {
    for (const document of documents) {
      const nextStatus = document.cloudOriginalFile ? "cloud_available" : "unavailable";
      if (document.sourceStatus !== nextStatus) {
        document.sourceStatus = nextStatus;
        changed = true;
      }
    }
  };
  for (const entry of entries) {
    if (!entry.isFile?.()) continue;
    const match = entry.name.match(LEGACY_HASHED_ORIGINAL);
    if (!match) continue;
    const hash = match[1].toLowerCase();
    const source = path.join(originalsDir, entry.name);
    const matchingDocuments = documentsByHash.get(hash) || [];
    const firstDocument = matchingDocuments[0];
    const targetName = originalNameOf(firstDocument || {}, entry.name);
    const targetKey = `${hash}/${targetName}`;
    const target = path.join(originalsDir, hash, targetName);
    let bytes;
    try {
      bytes = await readFile(source);
    } catch {
      failed += 1;
      failures.push({ fileName: entry.name, reason: "read_failed" });
      markMissing(matchingDocuments);
      continue;
    }
    const actualHash = crypto.createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== hash) {
      failed += 1;
      failures.push({ fileName: entry.name, reason: "hash_mismatch" });
      markMissing(matchingDocuments);
      continue;
    }

    let targetReady = false;
    try {
      const existingBytes = await readFile(target);
      targetReady = crypto.createHash("sha256").update(existingBytes).digest("hex") === hash;
    } catch {
      try {
        await mkdir(path.dirname(target), { recursive: true });
        await rename(source, target);
        targetReady = true;
      } catch {
        failed += 1;
        failures.push({ fileName: entry.name, reason: "move_failed" });
        markMissing(matchingDocuments);
        continue;
      }
    }
    if (!targetReady) {
      failed += 1;
      failures.push({ fileName: entry.name, reason: "target_conflict" });
      markMissing(matchingDocuments);
      continue;
    }
    if (target !== source) await unlink(source).catch(() => {});
    migrated += 1;
    changed = true;
    for (const document of matchingDocuments) {
      if (!document.originalName) document.originalName = originalNameOf(document, targetName);
      if (document.originalKey !== targetKey) document.originalKey = targetKey;
    }
  }
  return { changed, migrated, failed, failures };
}
