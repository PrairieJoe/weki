import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import JSZip from "jszip";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { createWorker } from "tesseract.js";
import engData from "@tesseract.js-data/eng";
import korData from "@tesseract.js-data/kor";
import { parse as parseHwp } from "hwp.js";
import { createServer as createViteServer } from "vite";
import { buildPageMetrics, createFolderSnapshot, reconcileFolderSnapshotOriginals, removeDocumentData } from "./src/server/backup.mjs";
import { ACTIVE_JOB_STATUSES, visibleJobs } from "./src/server/jobs.mjs";
import { createMyboxClient } from "./src/server/mybox.mjs";
import { CLOUD_CATALOG_NAME, CLOUD_RUNTIME_MANIFEST_NAME, CLOUD_RUNTIME_ROOT_NAME, CLOUD_RUNTIME_VERSION_NAME, downloadCloudOriginal, findCloudOriginalResource, findRuntimeFolderStructure, findRuntimeResource, findWekiFolderStructure, mergeCloudCatalog, readCloudCatalog, shouldRunInitialMyboxSync } from "./src/server/mybox-sync.mjs";
import { documentOriginalKey, migrateLegacyOriginals, normalizeOriginalName, originalNameOf, resolveDocumentOriginalPath } from "./src/server/original-storage.mjs";
import { createSearchService, RANKING_VERSION } from "./src/search/service.mjs";
import { buildContextPack } from "./src/search/context-pack.mjs";
import { buildEvidenceSnippet, formatDisplayScore } from "./src/search/evidence-display.mjs";
import { expandSynonymQuery, normalizeSynonymCollection, normalizeSynonymEntry, suggestSynonymCandidates, validateSynonymInput } from "./src/search/synonyms.mjs";
import { matchesRouteConstraints } from "./src/search/query-normalization.mjs";
import { createSearchStore } from "./src/search/sqlite-store.mjs";
import { createSemanticEngine } from "./src/search/semantic-engine.mjs";
import { createAnnIndex } from "./src/search/ann-index.mjs";
import { buildEvidenceFragments } from "./src/processing/evidence.mjs";
import { resolveTextSource } from "./src/processing/evidence-block.mjs";
import { createDocumentRenderer } from "./src/processing/document-renderer.mjs";
import { collectZipVisualAssets, splitDocxLogicalPages } from "./src/processing/visual-assets.mjs";
import { buildVisualContext } from "./src/processing/visual-context.mjs";
import { buildPdfVisualAsset, hasPdfVisualContent, renderPdfPagePng } from "./src/processing/pdf-visual.mjs";
import { chartSearchText, parsePptChart, parsePptTableXml } from "./src/processing/ppt-structured.mjs";
import { createCachedOcrPool } from "./src/processing/ocr-pool.mjs";
import { createPresentationRenderer } from "./src/processing/presentation-renderer.mjs";
import { enrichPagesForSearch, stripEphemeralImageData } from "./src/server/ai-processing.mjs";
import { createGeminiProvider } from "./src/server/gemini-provider.mjs";
import { getComponentState, installComponent, persistComponentFailure, retryComponent, updateComponentState, validateManifest } from "./src/runtime/components.mjs";
import { ensureManagedDependency, resolveInstalledDependencyExecutable } from "./src/runtime/dependency-manager.mjs";
import { extractPortableArchive } from "./src/runtime/dependency-extractor.mjs";
import { DEFAULT_PRESENTATION_DEPENDENCY_MANIFEST, LIBREOFFICE_BUNDLE_NAME } from "./src/runtime/presentation-manifest.mjs";
import { createRuntimeEmbeddingProvider } from "./src/runtime/embedding.mjs";
import { createRuntimeRerankerProvider } from "./src/runtime/reranker.mjs";
import { normalizeDefaultProcessingMode, normalizeProcessingSettings, PROCESSING_DEFAULT_MODES, resolveProcessingDefault, resolveRequestedProcessingMode } from "./src/server/processing-settings.mjs";
import { DEFAULT_RUNTIME_MANIFEST } from "./src/runtime/semantic-manifest.mjs";
import { RUNTIME_PUBLIC_KEY } from "./src/runtime/runtime-public-key.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
function loadEnvFile() {
  if (process.env.WEKI_DISABLE_ENV_FILE === "1") return;
  const envPath = process.env.WEKI_ENV_FILE || path.join(root, ".env");
  try {
    for (const line of fsSync.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch { /* Optional local configuration is absent in clean installs. */ }
}
loadEnvFile();
const dataDir = process.env.WEKI_DATA_DIR || path.join(root, ".weki-data");
const originalsDir = path.join(dataDir, "originals");
const incomingDir = path.join(dataDir, "incoming");
const tessdataDir = path.join(dataDir, "tessdata");
const credentialsDir = path.join(dataDir, "credentials");
const dbPath = path.join(dataDir, "knowledge-base.json");
const dbBackupPath = `${dbPath}.bak`;
const v2DataDir = process.env.WEKI_V2_DATA_DIR || path.join(dataDir, "v2");
const runtimeRoot = process.env.WEKI_RUNTIME_DIR || path.join(dataDir, "runtime", "v1");
const resourcesDir = process.env.WEKI_RESOURCES_DIR || (process.resourcesPath ? path.join(process.resourcesPath, "resources") : path.join(root, "resources"));
const dependencyRoot = process.env.WEKI_DEPENDENCY_ROOT || path.join(dataDir, "dependencies");
const libreOfficeManifestPath = process.env.WEKI_LIBREOFFICE_MANIFEST || path.join(resourcesDir, "dependency-manifests", "libreoffice-windows-x64.json");
const offlineLibreOfficeBundlePath = process.env.WEKI_DEPENDENCY_BUNDLE_PATH || path.join(resourcesDir, "dependency-bundles", LIBREOFFICE_BUNDLE_NAME);
const allowed = new Set(["pdf", "pptx", "docx", "hwpx", "hwp"]);
let databaseWriteChain = Promise.resolve();
let databaseRecovery = null;

async function ensureStore() {
  let databaseCreated = false;
  await fs.mkdir(originalsDir, { recursive: true });
  await fs.mkdir(incomingDir, { recursive: true });
  await fs.mkdir(tessdataDir, { recursive: true });
  await fs.mkdir(credentialsDir, { recursive: true });
  for (const [language, source] of [["eng", engData.langPath], ["kor", korData.langPath]]) {
    const destination = path.join(tessdataDir, `${language}.traineddata.gz`);
  try { await fs.access(destination); } catch { await fs.copyFile(path.join(source, `${language}.traineddata.gz`), destination); }
  }
  try { await fs.access(dbPath); } catch { await fs.writeFile(dbPath, JSON.stringify({ documents: [] }, null, 2)); databaseCreated = true; }
  try {
    const markerPath = path.join(dataDir, ".weki-storage-root");
    const marker = (await fs.readFile(markerPath, "utf8")).trim();
    if (marker !== "weki-storage-root-v2") await fs.writeFile(markerPath, "weki-storage-root-v2\n");
  } catch { await fs.writeFile(path.join(dataDir, ".weki-storage-root"), "weki-storage-root-v2\n"); }
  try { await fs.access(path.join(dataDir, "storage-location.json")); } catch { await fs.writeFile(path.join(dataDir, "storage-location.json"), JSON.stringify({ format: "weki-storage-location", version: 1, dataDir }, null, 2)); }
  return databaseCreated;
}
async function reconcileOriginalReferences(db, storeDir = dataDir) {
  let changed = false;
  for (const doc of db.documents || []) {
    const originalKey = documentOriginalKey(doc);
    if (!originalKey) {
      if (Object.hasOwn(doc, "originalPath")) { delete doc.originalPath; changed = true; }
      const nextSourceStatus = doc.cloudOriginalFile ? "cloud_available" : "unavailable";
      if (doc.sourceStatus !== nextSourceStatus) { doc.sourceStatus = nextSourceStatus; changed = true; }
      continue;
    }
    const originalPath = resolveDocumentOriginalPath(storeDir, { ...doc, originalKey });
    let verified = false;
    try {
      const bytes = await fs.readFile(originalPath);
      const actualHash = crypto.createHash("sha256").update(bytes).digest("hex");
      verified = !doc.hash || actualHash === String(doc.hash).toLowerCase();
    } catch { verified = false; }
    if (doc.originalKey !== originalKey) { doc.originalKey = originalKey; changed = true; }
    if (Object.hasOwn(doc, "originalPath")) { delete doc.originalPath; changed = true; }
    const nextSourceStatus = verified ? "local_available" : doc.cloudOriginalFile ? "cloud_available" : "unavailable";
    if (doc.sourceStatus !== nextSourceStatus) { doc.sourceStatus = nextSourceStatus; changed = true; }
  }
  return { changed };
}
let originalStorageMigrated = false;
let originalReferencesReconciled = false;
async function readDb() {
  await ensureStore();
  await databaseWriteChain.catch(() => {});
  let db;
  try {
    db = JSON.parse(await fs.readFile(dbPath, "utf8"));
  } catch (error) {
    const candidatePaths = [dbBackupPath, `${dbPath}.previous`, `${dbPath}.tmp`];
    try {
      const entries = await fs.readdir(dataDir);
      candidatePaths.push(...entries.filter((name) => name.startsWith("knowledge-base.json.") && (name.endsWith(".tmp") || name.endsWith(".partial"))).map((name) => path.join(dataDir, name)));
    } catch { /* The main error is handled below when the data directory cannot be listed. */ }
    let recovered = null;
    let recoveredPath = null;
    for (const candidatePath of [...new Set(candidatePaths)]) {
      try {
        const candidate = JSON.parse(await fs.readFile(candidatePath, "utf8"));
        if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) { recovered = candidate; recoveredPath = candidatePath; break; }
      } catch { /* Try the next recovery candidate. */ }
    }
    if (recovered) {
      await replaceDatabaseSnapshot(JSON.stringify(persistableDatabase(recovered), null, 2), { backupSource: recoveredPath });
      databaseRecovery = { status: "recovered", strategy: "backup", message: "로컬 저장소 손상을 감지해 knowledge-base.json 백업으로 복구했습니다.", recoveredAt: new Date().toISOString() };
      db = recovered;
    } else {
      const corruptPath = path.join(dataDir, `knowledge-base.json.corrupt-${Date.now()}.json`);
      await fs.copyFile(dbPath, corruptPath).catch(() => {});
      const auditEntry = { id: crypto.randomUUID(), type: "storage-recovery", detail: "knowledge-base.json 손상 감지 후 새 로컬 저장소를 생성했습니다.", createdAt: new Date().toISOString() };
      db = { documents: [], jobs: [], synonyms: [], feedback: [], audit: [auditEntry], maintenance: null };
      await replaceDatabaseSnapshot(JSON.stringify(db, null, 2), { backupSource: null, createBackupAfterReplace: true });
      databaseRecovery = { status: "recovered-empty", strategy: "new-store", message: "로컬 저장소 손상을 감지해 새 저장소를 생성했습니다. 기존 파일은 손상 백업으로 보관했습니다.", corruptPath, recoveredAt: auditEntry.createdAt };
    }
  }
  if (!db || typeof db !== "object" || Array.isArray(db)) {
    const error = new Error("로컬 저장소의 knowledge-base.json 형식이 올바르지 않습니다.");
    error.code = "storage_database_invalid";
    throw error;
  }
  for (const [key, fallback] of [["documents", []], ["jobs", []], ["synonyms", []], ["feedback", []], ["audit", []]]) {
    if (db[key] == null) { db[key] = fallback; continue; }
    if (!Array.isArray(db[key])) {
      const error = new Error(`로컬 저장소의 knowledge-base.json 필드(${key}) 형식이 올바르지 않습니다.`);
      error.code = "storage_database_invalid";
      throw error;
    }
  }
  for (const document of db.documents) {
    if (!Array.isArray(document.units)) document.units = [];
  }
  // Normalize legacy snapshots in memory. Persisting from every concurrent
  // reader can enqueue stale snapshots that overwrite a newer mutation.
  db.maintenance ??= null;
  const normalizedSettings = normalizeProcessingSettings(db.settings);
  if (JSON.stringify(normalizedSettings) !== JSON.stringify(db.settings)) db.settings = { ...(db.settings || {}), ...normalizedSettings };
  const normalizedSynonyms = normalizeSynonymCollection(db.synonyms);
  if (JSON.stringify(normalizedSynonyms) !== JSON.stringify(db.synonyms)) db.synonyms = normalizedSynonyms;
  for (const doc of db.documents) { doc.name = normalizeFilename(doc.name); if (doc.originalName) doc.originalName = normalizeFilename(doc.originalName); else if (doc.name) doc.originalName = doc.name; }
  for (const job of db.jobs) job.name = normalizeFilename(job.name);
  if (!originalStorageMigrated) {
    originalStorageMigrated = true;
    const migration = await migrateLegacyOriginals(dataDir, db.documents);
    if (migration.changed) await writeDb(db);
  }
  if (!originalReferencesReconciled) { const result = await reconcileOriginalReferences(db); if (result.changed) await writeDb(db); originalReferencesReconciled = true; }
  return db;
}
const persistableDatabase = (db) => {
  const next = JSON.parse(JSON.stringify(stripEphemeralImageData(db)));
  for (const doc of next.documents || []) { doc.originalKey = documentOriginalKey(doc); delete doc.originalPath; }
  return next;
};
async function replaceDatabaseSnapshot(serialized, { backupSource = dbPath, createBackupAfterReplace = false } = {}) {
  const temporaryPath = `${dbPath}.${crypto.randomUUID()}.partial`;
  await fs.writeFile(temporaryPath, serialized, "utf8");
  try {
    if (backupSource) await fs.copyFile(backupSource, dbBackupPath).catch((error) => { if (error.code !== "ENOENT") throw error; });
    try {
      await fs.rename(temporaryPath, dbPath);
    } catch (error) {
      if (!new Set(["EEXIST", "EPERM", "EXDEV"]).has(error.code)) throw error;
      await fs.copyFile(temporaryPath, dbPath);
    }
    if (createBackupAfterReplace) await fs.copyFile(dbPath, dbBackupPath);
  } finally {
    await fs.unlink(temporaryPath).catch(() => {});
  }
}
async function writeDb(db) {
  const serialized = JSON.stringify(persistableDatabase(db), null, 2);
  databaseWriteChain = databaseWriteChain.catch(() => {}).then(() => replaceDatabaseSnapshot(serialized));
  return databaseWriteChain;
}
async function writeDbAtomic(db) { return writeDb(db); }
let storageStatsCache = null;
let storageStatsCacheExpiresAt = 0;
async function readStorageStats() {
  if (storageStatsCache && Date.now() < storageStatsCacheExpiresAt) return storageStatsCache;
  const directoryBytes = async (directory) => {
    let total = 0;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) total += await directoryBytes(entryPath);
      else if (entry.isFile()) total += (await fs.stat(entryPath)).size;
    }
    return total;
  };
  try {
    const { bsize, blocks, bavail } = await fs.statfs(dataDir);
    const total = Number(bsize) * Number(blocks);
    const available = Number(bsize) * Number(bavail);
    storageStatsCache = { usage: Math.max(0, total - available), available, total, dataUsage: await directoryBytes(dataDir) };
    storageStatsCacheExpiresAt = Date.now() + 30_000;
    return storageStatsCache;
  } catch {
    storageStatsCache = { usage: 0, available: 0, total: 0, dataUsage: 0 };
    storageStatsCacheExpiresAt = Date.now() + 30_000;
    return storageStatsCache;
  }
}
class JobInterrupted extends Error {
  constructor(status) { super(status === "paused" ? "작업이 일시중지되었습니다." : "작업이 취소되었습니다."); this.status = status; }
}
const semanticProcessingEnabled = () => Boolean(embeddingProvider?.available);
const processingModeResolution = (mode) => {
  if (mode && typeof mode === "object") {
    if (mode.processingPolicy && typeof mode.processingPolicy === "object") return processingModeResolution(mode.processingPolicy);
    if (mode.effectiveMode) return {
      requestedMode: PROCESSING_DEFAULT_MODES.has(mode.requestedMode || mode.requestedProcessingMode || mode.mode) ? (mode.requestedMode || mode.requestedProcessingMode || mode.mode) : "lightweight",
      effectiveMode: PROCESSING_DEFAULT_MODES.has(mode.effectiveMode) ? mode.effectiveMode : "lightweight",
      fallbackReason: mode.fallbackReason ?? mode.processingModeFallback ?? null,
      provider: mode.provider ?? mode.externalProvider ?? null,
      modelId: mode.modelId ?? mode.externalModelId ?? null,
    };
    return processingModeResolution(typeof mode.mode === "string" ? mode.mode : "lightweight");
  }
  const requestedMode = PROCESSING_DEFAULT_MODES.has(mode) ? mode : (typeof mode === "string" ? normalizeDefaultProcessingMode(mode) : "lightweight");
  if (requestedMode === "local-ai" && !semanticProcessingEnabled()) return { requestedMode, effectiveMode: "lightweight", fallbackReason: "semantic_model_unavailable", provider: null, modelId: null };
  if (requestedMode === "auto") return { requestedMode, effectiveMode: semanticProcessingEnabled() ? "local-ai" : "lightweight", fallbackReason: semanticProcessingEnabled() ? null : "runtime_components_incomplete", provider: null, modelId: null };
  return {
    requestedMode,
    effectiveMode: requestedMode,
    fallbackReason: null,
    provider: null,
    modelId: null,
  };
};
const jobProcessingResolution = (job) => processingModeResolution(job?.processingPolicy || job);
const effectiveProcessingMode = (mode) => processingModeResolution(mode).effectiveMode;
const processingModeLabel = (effectiveMode) => effectiveMode === "local-ai" ? "Local AI" : effectiveMode === "external-ai" ? "External AI" : "경량 처리";
const processingDetail = (mode, stage, completed = null, total = null) => {
  const resolution = processingModeResolution(mode);
  const effective = resolution.effectiveMode;
  const fallback = resolution.fallbackReason === "semantic_model_unavailable" ? "Local AI 모델이 준비되지 않아 경량 처리로 전환했습니다. " : "";
  if (stage === "index") return `${fallback}${effective === "local-ai" ? "Local AI: E5 의미 임베딩과 Evidence 색인을 생성 중입니다." : effective === "external-ai" ? "External AI: 페이지별 검색 보강과 Evidence 색인을 생성 중입니다." : "경량 처리: Evidence 색인을 생성 중입니다."}`;
  if (Number.isFinite(completed) && Number.isFinite(total)) return `${fallback}${processingModeLabel(effective)} · ${completed}/${total} 페이지·슬라이드 처리 완료`;
  return `${fallback}${effective === "local-ai" ? "Local AI: 원본을 보관하고 페이지별 텍스트·OCR을 추출 중입니다." : effective === "external-ai" ? "External AI: 원본을 보관하고 페이지별 텍스트·OCR을 추출 중입니다." : "경량 처리: 원본을 보관하고 페이지별 텍스트·OCR을 추출 중입니다."}`;
};
const checkpointStates = new Map();
async function flushCheckpoint(jobId) {
  const key = String(jobId); const state = checkpointStates.get(key);
  if (!state) return;
  if (state.timer) { clearTimeout(state.timer); state.timer = null; }
  const db = await readDb(); const job = db.jobs.find((item) => item.id === key);
  if (!job) return;
  job.completedUnits = state.completed; job.totalUnits = state.total;
  job.progress = Math.max(1, Math.min(95, Math.round((state.completed / Math.max(1, state.total)) * 95)));
  job.detail = processingDetail(state.processingResolution, "extract", state.completed, state.total);
  await writeDb(db);
}
async function checkpoint(jobId, completed, total, processingResolution = "lightweight") {
  const key = String(jobId); let state = checkpointStates.get(key); const now = Date.now();
  if (!state || now - state.lastStatusCheckAt >= 500) {
    const db = await readDb(); const job = db.jobs.find((item) => item.id === key);
    if (!job || job.status === "cancelled") throw new JobInterrupted("cancelled");
    if (job.status === "paused") throw new JobInterrupted("paused");
    state = { completed, total, processingResolution, lastStatusCheckAt: now, timer: null }; checkpointStates.set(key, state);
  } else {
    state.completed = completed; state.total = total; state.processingResolution = processingResolution;
  }
  if (!state.timer) state.timer = setTimeout(() => { void flushCheckpoint(key).catch(() => {}); }, 200);
}
const textOnly = (value) => value.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
const normalizeFilename = (name) => {
  if (!/[ìëêíÃÂ]/.test(name)) return name;
  const decoded = Buffer.from(name, "latin1").toString("utf8");
  return /[가-힣]/.test(decoded) ? decoded : name;
};

async function extractPdf(buffer, options = {}) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true }).promise;
  const ocrPool = await createCachedOcrPool({ createWorker: createLocalOcrWorker, size: options.ocrConcurrency || 2, maxCacheEntries: options.ocrCacheEntries || 512 });
  const pages = [];
  try {
    const batchSize = Math.max(1, Math.min(4, Number(options.ocrConcurrency) || ocrPool.size));
    for (let start = 1; start <= pdf.numPages; start += batchSize) {
      const batch = await Promise.all(Array.from({ length: Math.min(batchSize, pdf.numPages - start + 1) }, (_, offset) => (async () => {
        const pageNo = start + offset;
        const page = await pdf.getPage(pageNo); const content = await page.getTextContent(); const nativeText = content.items.map((item) => item.str).join(" ").replace(/\s+/g, " ").trim();
        const operatorList = await page.getOperatorList();
        const viewport = page.getViewport({ scale: 1.5 }); const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        const renderedBytes = canvas.toBuffer("image/png");
        let normalizedOcr = ""; const diagnostics = [];
        try { normalizedOcr = String(await ocrPool.recognize(renderedBytes)).replace(/\s+/g, " ").trim(); }
        catch (error) { diagnostics.push({ code: "ocr_failed", message: error.message }); }
        const visualAssets = hasPdfVisualContent(operatorList) ? [buildPdfVisualAsset({ page: pageNo, bytes: renderedBytes, ocrText: normalizedOcr })] : [];
        return { page: pageNo, text: [nativeText, normalizedOcr].filter(Boolean).filter((value, index, list) => list.indexOf(value) === index).join(" "), nativeText, ocrText: normalizedOcr, diagnostics, visualAssets };
      })()));
      pages.push(...batch.sort((left, right) => left.page - right.page));
      await options.onUnit?.(pages.length, pdf.numPages);
    }
  } finally { await ocrPool.close(); }
  return pages.sort((left, right) => left.page - right.page);
}
async function extractZip(buffer, ext, options = {}) {
  const zip = await JSZip.loadAsync(buffer);
  const files = Object.keys(zip.files);
  let paths;
  if (ext === "pptx") paths = files.filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  else if (ext === "docx") paths = files.filter((p) => p === "word/document.xml");
  else paths = files.filter((p) => /(?:Contents|section)\/.*\.xml$|^Contents\/content\.xml$/i.test(p)).sort((a, b) => a.localeCompare(b));
  const slideOcr = new Map();
  const slideAssets = new Map();
  const slideCharts = new Map();
  let pageSources = null;
  let pageCount = paths.length;
  let renderedPages = [];
  if (["pptx", "docx"].includes(ext) && options.presentationRenderer?.available) {
    try { renderedPages = await options.presentationRenderer.renderPages(buffer, ext); }
    catch { renderedPages = []; }
  }
  if (ext === "docx") {
    const sourcePath = paths[0];
    const xml = sourcePath ? await zip.file(sourcePath).async("string") : "";
    pageSources = sourcePath ? splitDocxLogicalPages(xml).map((pageXml) => ({ sourcePath, xml: pageXml })) : [];
    pageCount = pageSources.length;
  } else if (ext === "hwpx") {
    pageSources = [];
    for (const sourcePath of paths) pageSources.push({ sourcePath, xml: await zip.file(sourcePath).async("string") });
    pageCount = pageSources.length;
  }
  if (ext === "pptx") {
    const ocrPool = await createCachedOcrPool({ createWorker: createLocalOcrWorker, size: options.ocrConcurrency || 2, maxCacheEntries: options.ocrCacheEntries || 512 });
    try {
      for (const slidePath of paths) {
        const relPath = slidePath.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
        const rel = zip.file(relPath) ? await zip.file(relPath).async("string") : "";
        const relationshipRows = [...rel.matchAll(/<Relationship\b([^>]+?)\/?>(?:<\/Relationship>)?/gu)].map((match) => {
          const attributes = Object.fromEntries([...match[1].matchAll(/([A-Za-z]+)="([^"]*)"/gu)].map((item) => [item[1], item[2]]));
          return attributes;
        });
        const resolveZipTarget = (basePath, target) => {
          const cleanTarget = decodeURIComponent(String(target || "").replace(/^\//u, "")).replaceAll("\\", "/");
          const segments = `${basePath}/${cleanTarget}`.split("/"); const resolved = [];
          for (const segment of segments) { if (!segment || segment === ".") continue; if (segment === "..") resolved.pop(); else resolved.push(segment); }
          return resolved.join("/");
        };
        const targets = relationshipRows.filter((item) => /media\//iu.test(item.Target || "")).map((item) => resolveZipTarget("ppt/slides", item.Target).replace(/^ppt\/media\//u, ""));
        const recognizedAssets = await Promise.all(targets.filter((target) => /\.(?:png|jpe?g|webp)$/i.test(target)).map(async (target) => {
          const asset = zip.file(`ppt/media/${target}`);
          if (!asset) return null;
          try {
            const bytes = await asset.async("nodebuffer");
            const visualText = String(await ocrPool.recognize(bytes, { key: `ppt-media:${target}:${bytes.byteLength}` })).replace(/\s+/g, " ").trim();
            const mimeType = target.match(/\.png$/i) ? "image/png" : target.match(/\.webp$/i) ? "image/webp" : "image/jpeg";
            return { name: target, text: visualText, mime: mimeType, mimeType, bytes };
          } catch (error) { return { name: target, text: "", mime: "image/*", mimeType: "image/*", diagnostics: [{ code: "ocr_failed", message: error.message }] }; }
        }));
        const assets = recognizedAssets.filter(Boolean); const parts = assets.map((asset) => asset.text).filter(Boolean);
        const renderedBytes = renderedPages[paths.indexOf(slidePath)];
        if (renderedBytes) {
          try {
            const renderedText = String(await ocrPool.recognize(renderedBytes, { key: `ppt-rendered-slide:${paths.indexOf(slidePath)}:${renderedBytes.byteLength}` })).replace(/\s+/g, " ").trim();
            assets.push({ name: `slide-${paths.indexOf(slidePath) + 1}.png`, text: renderedText, ocrText: renderedText, mime: "image/png", mimeType: "image/png", bytes: renderedBytes, source: "rendered-slide", assetType: "visual", origin: "ocr" });
            if (renderedText) parts.push(renderedText);
          } catch { /* Native XML, embedded workbook and media OCR remain available. */ }
        }
        const charts = [];
        for (const relationship of relationshipRows.filter((item) => /\/chart$/iu.test(item.Type || "") || /chart/iu.test(item.Target || ""))) {
          const chartPath = resolveZipTarget("ppt/slides", relationship.Target);
          const chartFile = zip.file(chartPath);
          if (!chartFile) continue;
          try {
            const chartXml = await chartFile.async("string");
            const chartRelPath = chartPath.replace(/([^/]+)$/u, "_rels/$1.rels");
            const chartRel = zip.file(chartRelPath) ? await zip.file(chartRelPath).async("string") : "";
            const embed = [...chartRel.matchAll(/<Relationship\b([^>]+?)\/?>(?:<\/Relationship>)?/gu)]
              .map((match) => Object.fromEntries([...match[1].matchAll(/([A-Za-z]+)="([^"]*)"/gu)].map((item) => [item[1], item[2]])))
              .find((item) => /embeddedPackage|package|xlsx|workbook/iu.test(`${item.Type || ""} ${item.Target || ""}`));
            const workbookPath = embed ? resolveZipTarget("ppt/charts", embed.Target) : null;
            const workbookBuffer = workbookPath && zip.file(workbookPath) ? await zip.file(workbookPath).async("nodebuffer") : null;
            const chart = parsePptChart({ xml: chartXml, workbookBuffer, chartPath, workbookPath });
            const text = chartSearchText(chart);
            charts.push({ name: chartPath.split("/").pop(), assetType: "chart", origin: "native", text, chart, sourceRef: { slidePath, chartPath, workbookPath } });
          } catch { /* Keep native slide text and raster OCR available when chart XML is malformed. */ }
        }
        slideOcr.set(slidePath, parts.join(" "));
        slideAssets.set(slidePath, assets);
        slideCharts.set(slidePath, charts);
      }
    } finally { await ocrPool.close(); }
  }
  if (["docx", "hwpx"].includes(ext)) {
    const ocrPool = await createCachedOcrPool({ createWorker: createLocalOcrWorker, size: options.ocrConcurrency || 2, maxCacheEntries: options.ocrCacheEntries || 512 });
    try {
      for (const [index, renderedBytes] of renderedPages.entries()) {
        if (!renderedBytes) continue;
        try {
          const renderedText = String(await ocrPool.recognize(renderedBytes, { key: `docx-rendered-page:${index}:${renderedBytes.byteLength}` })).replace(/\s+/g, " ").trim();
          const page = index + 1;
          const visualAssets = slideAssets.get(String(page)) || [];
          visualAssets.push({ name: `page-${page}.png`, text: renderedText, ocrText: renderedText, mime: "image/png", mimeType: "image/png", bytes: renderedBytes, source: "rendered-office-page", assetType: "visual", origin: "ocr" });
          slideAssets.set(String(page), visualAssets);
          if (renderedText) slideOcr.set(String(page), renderedText);
        } catch { /* Native XML and embedded media OCR remain available. */ }
      }
      const assets = await collectZipVisualAssets(zip, ext, { recognize: async (bytes) => ocrPool.recognize(bytes), preserveBytes: true, pagePaths: paths });
      pageCount = Math.max(pageCount, ...assets.map((asset) => Number(asset.page) || 1));
      for (const asset of assets) {
        const page = Number(asset.page) || 1;
        const key = String(page);
        const visualAssets = slideAssets.get(key) || [];
        visualAssets.push({ ...asset, text: asset.ocrText });
        slideAssets.set(key, visualAssets);
        const ocr = [slideOcr.get(key), asset.ocrText].filter(Boolean).join(" ").trim();
        slideOcr.set(key, ocr);
      }
      for (const [key, ocr] of slideOcr) slideOcr.set(key, Array.isArray(ocr) ? ocr.join(" ") : String(ocr || ""));
    } finally { await ocrPool.close(); }
  }
  const pages = [];
  if (pageSources) {
    for (let index = 0; index < pageCount; index++) {
      const xml = pageSources[index]?.xml || "";
      const tagged = [...xml.matchAll(/<(?:w:t|a:t|hp:t)[^>]*>([\s\S]*?)<\/(?:w:t|a:t|hp:t)>/g)].map((m) => textOnly(m[1])).filter(Boolean).join(" ");
      const tablePattern = ext === "docx" ? /<w:tbl[\s\S]*?<\/w:tbl>/g : /<hp:tbl[\s\S]*?<\/hp:tbl>/g;
      const tableText = [...xml.matchAll(tablePattern)].map((match) => textOnly(match[0])).filter((value) => value.length > 2);
      const nativeText = tagged || textOnly(xml); const ocrText = slideOcr.get(String(index + 1)) || "";
      const text = [nativeText, ocrText].filter(Boolean).filter((value, itemIndex, list) => list.indexOf(value) === itemIndex).join(" ");
      pages.push({ page: index + 1, text, nativeText, ocrText, tableText, visualAssets: slideAssets.get(String(index + 1)) || [] });
      await options.onUnit?.(index + 1, pageCount);
    }
    return pages;
  }
  for (let index = 0; index < paths.length; index++) {
    const xml = await zip.file(paths[index]).async("string");
    const tagged = [...xml.matchAll(/<(?:w:t|a:t|hp:t)[^>]*>([\s\S]*?)<\/(?:w:t|a:t|hp:t)>/g)].map((m) => textOnly(m[1])).filter(Boolean).join(" ");
    const tablePattern = ext === "docx" ? /<w:tbl[\s\S]*?<\/w:tbl>/g : ext === "pptx" ? /<a:tbl[\s\S]*?<\/a:tbl>/g : /<hp:tbl[\s\S]*?<\/hp:tbl>/g;
    const tableMatches = [...xml.matchAll(tablePattern)];
    const tables = ext === "pptx" ? tableMatches.map((match) => parsePptTableXml(match[0])).filter(Boolean) : [];
    const tableText = tableMatches.map((match) => textOnly(match[0])).filter((value) => value.length > 2);
    const nativeText = tagged || textOnly(xml); const ocrText = slideOcr.get(paths[index]) || "";
    const text = [nativeText, ocrText].filter(Boolean).filter((value, itemIndex, list) => list.indexOf(value) === itemIndex).join(" ");
    const charts = slideCharts.get(paths[index]) || [];
    pages.push({ page: index + 1, text, nativeText, ocrText, tableText, tables, chart: charts[0]?.chart || null, chartText: charts.map((item) => item.text).join(" "), visualAssets: [...(slideAssets.get(paths[index]) || []), ...charts] });
    await options.onUnit?.(index + 1, paths.length);
  }
  return pages;
}
async function extractHwp(buffer, options = {}) {
  let document;
  try { document = parseHwp(buffer, { type: "buffer" }); } catch (error) { throw new Error(`지원되지 않거나 손상된 HWP 5.x 문서입니다: ${error.message}`); }
  const sections = document.sections || [];
  const characterText = (item) => {
    if (typeof item === "string") return item;
    if (typeof item === "number") return item === 13 || item === 10 ? "\n" : item ? String.fromCharCode(item) : "";
    if (typeof item?.value === "number") return item.value === 13 || item.value === 10 ? "\n" : item.value ? String.fromCharCode(item.value) : "";
    return item?.value || "";
  };
  const paragraphText = (paragraph) => {
    const own = (paragraph.content || []).map(characterText).join("");
    const nested = (paragraph.controls || []).flatMap((control) => (control.content || []).flatMap((row) => row.items || row || [])).map(paragraphText).join("\n");
    return [own, nested].filter(Boolean).join("\n");
  };
  const pages = sections.map((section, index) => {
    const paragraphs = section.content || [];
    const text = paragraphs.map(paragraphText).join("\n").replace(/\s+/g, " ").trim();
    return { page: index + 1, text, nativeText: text, ocrText: "" };
  });
  const binData = Array.isArray(document.info?.binData) ? document.info.binData : [];
  if (binData.length) {
    const ocrPool = await createCachedOcrPool({ createWorker: createLocalOcrWorker, size: options.ocrConcurrency || 2, maxCacheEntries: options.ocrCacheEntries || 512 });
    try {
      if (!pages.length) pages.push({ page: 1, text: "", nativeText: "", ocrText: "", visualAssets: [] });
      const recognized = await Promise.all(binData.map(async (item, index) => {
        const bytes = Buffer.from(item.payload || item.bytes || []); const extension = String(item.extension || "bin").toLowerCase(); let text = ""; const diagnostics = [];
        try { text = String(await ocrPool.recognize(bytes, { key: `hwp-bindata:${index}:${bytes.byteLength}` })).replace(/\s+/g, " ").trim(); }
        catch (error) { diagnostics.push({ code: "ocr_failed", message: error.message }); }
        return { index, bytes, text, diagnostics, name: `bindata-${String(index + 1).padStart(4, "0")}.${extension}`, mime: extension === "png" ? "image/png" : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : "image/*" };
      }));
      for (const asset of recognized) {
        const page = pages[Math.min(asset.index, pages.length - 1)]; page.visualAssets ||= [];
        page.visualAssets.push({ name: asset.name, bytes: asset.bytes, mime: asset.mime, assetType: "visual", origin: "ocr", ocrText: asset.text, text: asset.text, diagnostics: asset.diagnostics, sourceRef: { format: "hwp", binDataIndex: asset.index } });
        if (asset.text) { page.ocrText = [page.ocrText, asset.text].filter(Boolean).join(" "); page.text = [page.nativeText, page.ocrText].filter(Boolean).join(" "); }
      }
    } finally { await ocrPool.close(); }
  }
  for (let index = 0; index < pages.length; index++) await options.onUnit?.(index + 1, pages.length);
  if (!pages.length || !pages.some((page) => page.text || page.visualAssets?.length)) throw new Error("HWP에서 검색 가능한 텍스트·이미지를 추출하지 못했습니다.");
  return pages;
}
async function extract(buffer, ext, options) {
  if (ext === "pdf") return extractPdf(buffer, options);
  if (["hwp", "hwpx"].includes(ext) && documentRenderer) {
    const worker = await createVisualOcrWorker();
    try {
      const recognizeVisualAsset = async (bytes) => (await worker.recognize(bytes)).data.text;
      const recognizeRenderedPage = async (svg) => {
        const image = await loadImage(Buffer.from(svg));
        const canvas = createCanvas(image.width, image.height);
        canvas.getContext("2d").drawImage(image, 0, 0);
        return (await worker.recognize(canvas.toBuffer("image/png"))).data.text;
      };
      return await documentRenderer.extract(buffer, { ...options, recognizeVisualAsset, recognizeRenderedPage });
    } catch { /* Fall back to the native parser for damaged or unsupported files. */ }
    finally { await worker.terminate(); }
  }
  if (["pptx", "docx", "hwpx"].includes(ext)) return extractZip(buffer, ext, options);
  if (ext === "hwp") return extractHwp(buffer, options);
  throw new Error("지원하지 않는 문서 형식입니다.");
}
const embedding = (text, dimensions = 128) => {
  const vector = Array(dimensions).fill(0); const normalized = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  for (let index = 0; index < normalized.length - 1; index++) { const gram = normalized.slice(index, index + 2); let hash = 0; for (const char of gram) hash = ((hash * 31) + char.codePointAt(0)) >>> 0; vector[hash % dimensions] += 1; }
  const length = Math.hypot(...vector) || 1; return vector.map((value) => Number((value / length).toFixed(6)));
};
const cosine = (left, right) => left.reduce((sum, value, index) => sum + value * right[index], 0);
const makeUnits = (pages) => pages.flatMap((page) => {
  const auxiliaryFields = page.generatedMetadata ? { generatedMetadata: page.generatedMetadata, searchAuxiliaryText: page.searchAuxiliaryText || "" } : {};
  const nativeText = String(page.nativeText || "").trim();
  const ocrText = String(page.ocrText || "").trim();
  const pageText = String(page.text || [nativeText, ocrText].filter(Boolean).join(" ")).trim();
  const textSource = page.textSource || resolveTextSource({ nativeText, ocrText });
  const textUnit = pageText ? {
    id: crypto.randomUUID(), range: page.page, text: pageText, nativeText, ocrText,
    textSource, ocrConfidence: page.ocrConfidence ?? null, sourceRef: page.sourceRef || null,
    diagnostics: page.diagnostics || [], caption: page.caption || "", table: page.table || null, chart: page.chart || null,
    embedding: embedding(`${pageText} ${page.searchAuxiliaryText || ""}`), evidenceType: "text", ...auxiliaryFields,
  } : null;
  const nearbyText = buildVisualContext({ ...page, nativeText: nativeText || pageText });
  const visualUnits = (page.visualAssets || []).filter((asset) => asset.text || asset.ocrText || asset.name).map((asset) => {
    const assetText = asset.text || asset.ocrText || "";
    return {
      id: crypto.randomUUID(), range: page.page, text: assetText, nativeText: "", ocrText: assetText,
      textSource: asset.textSource || (assetText ? "ocr" : "native"), ocrConfidence: asset.confidence ?? null,
      sourceRef: asset.sourceRef || null, diagnostics: asset.diagnostics || [], caption: asset.caption || "",
      table: asset.table || null, chart: asset.chart || null,
      embedding: embedding(`${assetText} ${asset.caption || ""} ${nearbyText} ${page.searchAuxiliaryText || ""}`),
      evidenceType: asset.assetType || "visual", visualAssetName: asset.name, visualMime: asset.mime || asset.mimeType,
      visualNearbyText: nearbyText, ...auxiliaryFields,
    };
  });
  const tableRows = page.tables || page.tableText || [];
  const tableUnits = tableRows.map((table) => {
    const value = typeof table === "string" ? table : [table.headers || [], ...(table.rows || [])].flat().join(" | ");
    return { id: crypto.randomUUID(), range: page.page, text: value, nativeText: value, ocrText: "", textSource: "native", sourceRef: page.tableSourceRef || null, diagnostics: page.tableDiagnostics || [], table: typeof table === "string" ? null : table, embedding: embedding(`${value} ${page.searchAuxiliaryText || ""}`), evidenceType: "table", ...auxiliaryFields };
  });
  return [textUnit, ...tableUnits, ...visualUnits].filter(Boolean);
});
const activeJobs = (db) => db.jobs.filter((job) => ACTIVE_JOB_STATUSES.includes(job.status));
async function recoverInterruptedJobs() {
  const db = await readDb(); let changed = false;
  for (const job of db.jobs) {
    if (job.status === "processing") { job.status = "queued"; job.detail = "앱 종료 전 작업을 감지했습니다. 안전 지점부터 자동 재개합니다."; job.recoveredAt = new Date().toISOString(); changed = true; }
  }
  if (changed) await writeDb(db);
}
async function queueRendererUpgradeJobs() {
  if (!rendererComponentVersion || !documentRenderer) return;
  const db = await readDb();
  const queued = new Set(db.jobs.filter((job) => ["queued", "processing", "paused"].includes(job.status) && job.documentId).map((job) => job.documentId));
  let changed = false;
  for (const doc of db.documents) {
    const format = String(doc.format || "").toUpperCase();
    if (!(format === "HWP" || format === "HWPX") || doc.rendererVersion === rendererComponentVersion || queued.has(doc.id)) continue;
    const originalPath = resolveDocumentOriginalPath(dataDir, doc);
    const localOriginal = originalPath && await hasVerifiedLocalOriginal(doc);
    if (!localOriginal && !doc.cloudOriginalFile) continue;
    db.jobs.unshift({ id: crypto.randomUUID(), kind: "reprocess", trigger: "renderer-upgrade", auto: true, rendererVersion: rendererComponentVersion, name: doc.name, mode: "lightweight", status: "queued", progress: 0, detail: `문서 렌더러 ${rendererComponentVersion} 적용을 위한 시각 근거 재처리 대기 중입니다.`, documentId: doc.id, createdAt: new Date().toISOString() });
    doc.rendererStatus = "pending";
    doc.visualAnalysisStatus = "pending";
    changed = true;
  }
  if (changed) await writeDb(db);
}
let queueRunning = false;
async function runQueue() {
  if (queueRunning) return; queueRunning = true;
  try {
    while (true) {
      const db = await readDb(); if (db.maintenance) break;
      const job = db.jobs.filter((item) => item.status === "queued" && ["reprocess", "registration"].includes(item.kind)).sort((a, b) => (b.priority || 0) - (a.priority || 0) || new Date(a.createdAt) - new Date(b.createdAt))[0]; if (!job) break;
      if (job.kind === "registration") {
        const modeResolution = jobProcessingResolution(job); job.status = "processing"; job.progress = 15; job.detail = processingDetail(modeResolution, "extract"); job.effectiveMode = modeResolution.effectiveMode; job.processingModeFallback = modeResolution.fallbackReason; await writeDb(db);
        try {
          const buffer = await fs.readFile(job.stagedPath); const pages = await extract(buffer, job.ext, { presentationRenderer, onUnit: (completed, total) => checkpoint(job.id, completed, total, modeResolution) });
          if (!pages.length) throw new Error("검색 가능한 텍스트를 추출하지 못했습니다.");
          const fresh = await readDb(); const freshJob = fresh.jobs.find((item) => item.id === job.id); if (!freshJob || freshJob.status === "cancelled") { await fs.unlink(job.stagedPath).catch(() => {}); continue; }
          const originalName = normalizeOriginalName(job.name, `${job.hash}.${job.ext}`); const originalKey = `${job.hash}/${originalName}`; const originalPath = path.join(originalsDir, job.hash, originalName); await writeOriginalAtomically(originalPath, buffer); await fs.unlink(job.stagedPath).catch(() => {});
          const documentId = crypto.randomUUID(); const enriched = modeResolution.effectiveMode === "external-ai" ? await enrichExternalPages(pages, modeResolution, documentId) : { pages, audits: [], resolution: modeResolution }; const effectiveResolution = enriched.resolution; const pdfOcr = job.ext === "pdf"; const now = new Date().toISOString(); const units = makeUnits(enriched.pages); const metrics = buildPageMetrics(enriched.pages, units); const effectiveMode = effectiveResolution.effectiveMode; const format = job.ext.toUpperCase(); const doc = { id: documentId, name: job.name, originalName, format, hash: job.hash, originalKey, size: job.size, registeredAt: now, modifiedAt: job.modifiedAt, updatedAt: now, processingMode: effectiveMode, requestedProcessingMode: modeResolution.requestedMode, processingModeFallback: effectiveResolution.fallbackReason, processingPolicy: { requestedMode: modeResolution.requestedMode, effectiveMode, provider: modeResolution.provider, modelId: modeResolution.modelId, fallbackReason: effectiveResolution.fallbackReason }, advancedAnalysis: effectiveMode === "local-ai", semanticAnalysisStatus: effectiveMode === "local-ai" ? "pending" : "degraded", rendererStatus: rendererAvailableForFormat(format) ? "ready" : "fallback", rendererVersion: rendererAvailableForFormat(format) ? rendererComponentVersion : null, ...metrics, sourceStatus: "local_available", nativeTextStatus: "success", ocrStatus: pdfOcr ? "success" : "unavailable", visualAnalysisStatus: metrics.visualEvidenceCount ? "success" : rendererAvailableForFormat(format) ? "unavailable" : "not_supported", units };
          fresh.documents.push(doc); freshJob.documentId = doc.id; freshJob.status = "processing"; freshJob.progress = 96; freshJob.effectiveMode = effectiveMode; freshJob.requestedProcessingMode = modeResolution.requestedMode; freshJob.processingModeFallback = effectiveResolution.fallbackReason; freshJob.processingPolicy = doc.processingPolicy; freshJob.detail = processingDetail(effectiveResolution, "index"); delete freshJob.stagedPath; fresh.audit.unshift(...enriched.audits.map((audit) => ({ id: crypto.randomUUID(), type: "external-ai", ...audit, processingModeFallback: effectiveResolution.fallbackReason }))); await writeDb(fresh); await syncDocumentToV2(doc);
          const indexed = await readDb(); const indexedJob = indexed.jobs.find((item) => item.id === job.id); const indexedDoc = indexed.documents.find((item) => item.id === doc.id); if (indexedJob && indexedDoc) { indexedDoc.semanticAnalysisStatus = effectiveMode === "local-ai" ? "ready" : "degraded"; indexedJob.status = "completed"; indexedJob.progress = 100; indexedJob.detail = `${processingModeLabel(effectiveMode)} · ${metrics.pageCount}개 페이지 처리 완료${metrics.failedPageCount ? ` · ${metrics.failedPageCount}개 페이지 검색 불가` : ""}${effectiveMode === "local-ai" ? " · Local AI 의미 색인 완료" : ""}`; indexedJob.completedAt = now; indexed.audit.unshift({ id: crypto.randomUUID(), type: "registration", documentId: doc.id, createdAt: now, detail: indexedJob.detail }); await writeDb(indexed); }
        } catch (error) { const fresh = await readDb(); const freshJob = fresh.jobs.find((item) => item.id === job.id); if (freshJob && error instanceof JobInterrupted) { freshJob.status = error.status; freshJob.detail = error.message; freshJob.interruptedAt = new Date().toISOString(); if (error.status === "cancelled") { await fs.unlink(freshJob.stagedPath || job.stagedPath).catch(() => {}); delete freshJob.stagedPath; } await writeDb(fresh); } else if (freshJob) { freshJob.status = "failed"; freshJob.progress = 0; freshJob.detail = error.message; await writeDb(fresh); } }
        continue;
      }
       const doc = db.documents.find((item) => item.id === job.documentId);
       let originalPath;
       try { originalPath = await ensureDocumentOriginal(doc); } catch (error) { job.status = "failed"; job.detail = error.message || "원본이 없어 재처리할 수 없습니다."; await writeDb(db); continue; }
      const modeResolution = jobProcessingResolution(job); job.status = "processing"; job.progress = 20; job.effectiveMode = modeResolution.effectiveMode; job.processingModeFallback = modeResolution.fallbackReason; job.detail = modeResolution.fallbackReason === "semantic_model_unavailable" ? "Local AI 모델이 준비되지 않아 경량 처리로 전환했습니다. 경량 처리: 기존 색인을 유지한 채 페이지별 텍스트·OCR을 재처리 중입니다." : processingDetail(modeResolution, "extract"); await writeDb(db);
      try {
        const pages = await extract(await fs.readFile(originalPath), doc.format.toLowerCase(), { presentationRenderer, onUnit: (completed, total) => checkpoint(job.id, completed, total, modeResolution) });
        const fresh = await readDb(); const freshJob = fresh.jobs.find((item) => item.id === job.id); const freshDoc = fresh.documents.find((item) => item.id === job.documentId);
        if (!freshJob || freshJob.status === "cancelled") continue;
        const enriched = modeResolution.effectiveMode === "external-ai" ? await enrichExternalPages(pages, modeResolution, freshDoc.id) : { pages, audits: [], resolution: modeResolution }; const effectiveResolution = enriched.resolution; const pdfOcr = freshDoc.format === "PDF"; const effectiveMode = effectiveResolution.effectiveMode; freshDoc.processingMode = effectiveMode; freshDoc.requestedProcessingMode = modeResolution.requestedMode; freshDoc.processingModeFallback = effectiveResolution.fallbackReason; freshDoc.processingPolicy = { requestedMode: modeResolution.requestedMode, effectiveMode, provider: modeResolution.provider, modelId: modeResolution.modelId, fallbackReason: effectiveResolution.fallbackReason }; freshDoc.advancedAnalysis = effectiveMode === "local-ai"; freshDoc.semanticAnalysisStatus = "pending"; freshDoc.rendererStatus = rendererAvailableForFormat(freshDoc.format) ? "ready" : "fallback"; freshDoc.rendererVersion = rendererAvailableForFormat(freshDoc.format) ? rendererComponentVersion : null; freshDoc.units = makeUnits(enriched.pages); Object.assign(freshDoc, buildPageMetrics(enriched.pages, freshDoc.units)); freshDoc.updatedAt = new Date().toISOString(); freshDoc.nativeTextStatus = "success"; freshDoc.ocrStatus = pdfOcr ? "success" : "unavailable"; freshDoc.visualAnalysisStatus = freshDoc.visualEvidenceCount ? "success" : rendererAvailableForFormat(freshDoc.format) ? "unavailable" : "not_supported";
        freshJob.status = "processing"; freshJob.progress = 96; freshJob.effectiveMode = effectiveMode; freshJob.requestedProcessingMode = modeResolution.requestedMode; freshJob.processingModeFallback = effectiveResolution.fallbackReason; freshJob.processingPolicy = freshDoc.processingPolicy; freshJob.detail = processingDetail(effectiveResolution, "index"); fresh.audit.unshift(...enriched.audits.map((audit) => ({ id: crypto.randomUUID(), type: "external-ai", ...audit, processingModeFallback: effectiveResolution.fallbackReason }))); await writeDb(fresh); await syncDocumentToV2(freshDoc);
        const indexed = await readDb(); const indexedJob = indexed.jobs.find((item) => item.id === job.id); const indexedDoc = indexed.documents.find((item) => item.id === freshDoc.id); if (indexedJob && indexedDoc) { indexedDoc.semanticAnalysisStatus = effectiveMode === "local-ai" ? "ready" : "degraded"; indexedJob.status = "completed"; indexedJob.progress = 100; indexedJob.detail = `${processingModeLabel(effectiveMode)} · ${indexedDoc.pageCount}개 페이지 재처리 완료${indexedDoc.failedPageCount ? ` · ${indexedDoc.failedPageCount}개 페이지 검색 불가` : ""}${pdfOcr ? " · OCR 완료" : ""}${effectiveMode === "local-ai" ? " · Local AI 의미 색인 완료" : ""}`; indexedJob.completedAt = new Date().toISOString(); indexed.audit.unshift({ id: crypto.randomUUID(), type: "reprocess", documentId: indexedDoc.id, createdAt: indexedJob.completedAt, detail: indexedJob.detail }); await writeDb(indexed); }
      } catch (error) { const fresh = await readDb(); const freshJob = fresh.jobs.find((item) => item.id === job.id); if (freshJob && error instanceof JobInterrupted) { freshJob.status = error.status; freshJob.detail = error.message; freshJob.interruptedAt = new Date().toISOString(); await writeDb(fresh); } else if (freshJob) { freshJob.status = "failed"; freshJob.progress = 0; freshJob.detail = error.message; await writeDb(fresh); } }
    }
  } finally { queueRunning = false; }
}
async function waitForQueueIdle(timeout = 30_000) {
  const started = Date.now();
  while (queueRunning) {
    if (Date.now() - started >= timeout) {
      const error = new Error("Processing Queue가 아직 종료되지 않았습니다.");
      error.code = "queue_busy";
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
const createLocalOcrWorker = () => createWorker("eng+kor", 1, { langPath: tessdataDir, gzip: true, cacheMethod: "none" });
const createVisualOcrWorker = () => createWorker(process.env.WEKI_VISUAL_OCR_LANG || "kor", 1, { langPath: tessdataDir, gzip: true, cacheMethod: "none" });
const tokens = (query) => query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
function search(db, query) {
  const terms = tokens(query); const queryEmbedding = embedding(query);
  return db.documents.filter((doc) => ["completed", "partial"].includes(doc.processingStatus)).flatMap((doc) => doc.units.map((unit) => {
    if (!matchesRouteConstraints(query, [unit.text, unit.nativeText, unit.ocrText, unit.searchAuxiliaryText, doc.name])) return null;
    const haystack = `${unit.text} ${unit.searchAuxiliaryText || ""} ${doc.name}`.toLowerCase();
    const hits = terms.filter((term) => haystack.includes(term));
    const lexical = terms.length ? Math.round((hits.length / terms.length) * 70) : 0;
    const semantic = Math.round(Math.max(0, cosine(queryEmbedding, unit.embedding || embedding(`${unit.text} ${unit.searchAuxiliaryText || ""}`))) * 30);
    const frequency = hits.reduce((count, term) => count + (haystack.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length || 0), 0);
    const locationPrefix = doc.format === "HWP" ? "섹션" : doc.format === "PPTX" ? "슬라이드" : "p.";
    const evidenceOrigin = unit.evidenceType === "visual" ? "ocr" : unit.evidenceType === "table" ? "native" : unit.nativeText && unit.ocrText ? "native+ocr" : unit.ocrText ? "ocr" : "native";
    const score = Math.min(100, lexical + semantic + Math.min(15, frequency * 3));
    const snippet = buildEvidenceSnippet(unit.text, query);
    return { documentId: doc.id, fileName: doc.name, format: doc.format, sourceStatus: doc.sourceStatus, cloudOriginalFile: doc.cloudOriginalFile || null, matchedPage: unit.range, sourceRange: unit.range, locationPrefix, evidenceType: unit.evidenceType, evidenceOrigin, visualAssetName: unit.visualAssetName || null, text: unit.text.slice(0, 420), snippet: snippet.text, truncated: snippet.truncated, lexicalScore: lexical, semanticScore: semantic, score, displayScore: formatDisplayScore(score), lowRelevance: hits.length === 0, matchedTerms: snippet.matchedTerms };
  })).filter((result) => result && (result.matchedTerms.length > 0 || result.semanticScore >= 12) && result.text.trim().length > 3).sort((a, b) => b.score - a.score || a.fileName.localeCompare(b.fileName)).slice(0, 30);
}
const synonymExpansionCache = new Map();
function expandQuery(db, query) {
  const entries = db.synonyms || [];
  const revision = entries.map((entry) => `${entry.id || entry.term}:${entry.updatedAt || entry.status || "approved"}:${(entry.aliases || []).join("|")}`).join(";");
  const key = `${revision}\n${String(query || "")}`;
  if (synonymExpansionCache.has(key)) return synonymExpansionCache.get(key);
  const expanded = expandSynonymQuery(query, entries, { maxExpansions: 8 });
  synonymExpansionCache.set(key, expanded);
  while (synonymExpansionCache.size > 256) synonymExpansionCache.delete(synonymExpansionCache.keys().next().value);
  return expanded;
}

const mybox = createMyboxClient({ apiBase: process.env.WEKI_MYBOX_API_BASE || undefined });
const myboxManifestTimeoutMs = Number(process.env.WEKI_MYBOX_MANIFEST_TIMEOUT_MS) > 0
  ? Number(process.env.WEKI_MYBOX_MANIFEST_TIMEOUT_MS)
  : 20_000;
const cloudJsonName = CLOUD_CATALOG_NAME;
const configuredCredentialState = process.env.WEKI_MYBOX_CREDENTIAL_STATE || (process.env.NAVER_MBOX_TOKEN ? "available" : "missing");
const myboxCredentialMessage = {
  missing: "MYBOX 토큰이 설정되지 않았습니다. 관리자에게 문의하세요.",
  unreadable: "MYBOX 토큰을 읽을 수 없습니다. 관리자에게 문의하세요.",
  invalid: "MYBOX 토큰 검증에 실패했습니다. 관리자에게 문의하세요.",
  unavailable: "MYBOX 연결을 확인할 수 없습니다. 네트워크 상태를 확인하세요."
};
const publicMyboxError = (error) => {
  const detail = String(error?.message || "");
  const authFailure = /\((401|403)\)/.test(detail);
  return { credentialState: authFailure ? "invalid" : "unavailable", reason: authFailure ? "token_invalid" : "network_unavailable", message: authFailure ? myboxCredentialMessage.invalid : myboxCredentialMessage.unavailable };
};
const findMyboxFolderStructure = ({ create = false } = {}) => findWekiFolderStructure(mybox, { parentId: process.env.NAVER_MBOX_FOLDER_ID || undefined, create });
const cloudRuntimeRootName = process.env.WEKI_MYBOX_RUNTIME_ROOT || CLOUD_RUNTIME_ROOT_NAME;
const findMyboxRuntimeStructure = () => findRuntimeFolderStructure(mybox, {
  parentId: process.env.NAVER_MBOX_RUNTIME_PARENT_ID || undefined,
  rootName: cloudRuntimeRootName,
});
const readFolderSnapshot = async (structure) => (await readCloudCatalog(mybox, structure)).snapshot;
const myboxSyncState = { state: "idle", message: "" };
let myboxSyncPromise = null;
const cloudOriginalDownloads = new Map();

async function hasVerifiedLocalOriginal(document) {
  const originalPath = resolveDocumentOriginalPath(dataDir, document);
  if (!originalPath || !document?.hash) return false;
  try {
    const bytes = await fs.readFile(originalPath);
    return crypto.createHash("sha256").update(bytes).digest("hex") === String(document.hash).toLowerCase();
  } catch { return false; }
}

async function writeOriginalAtomically(destination, bytes) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporaryPath = `${destination}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, bytes);
  try {
    await fs.rename(temporaryPath, destination);
  } catch (error) {
    if (!(["EEXIST", "EPERM"].includes(error.code))) throw error;
    try {
      const existing = await fs.readFile(destination);
      const existingHash = crypto.createHash("sha256").update(existing).digest("hex");
      const incomingHash = crypto.createHash("sha256").update(bytes).digest("hex");
      if (existingHash === incomingHash) { await fs.unlink(temporaryPath).catch(() => {}); return; }
    } catch { /* The destination may have disappeared between the rename attempts. */ }
    await fs.unlink(destination).catch(() => {});
    await fs.rename(temporaryPath, destination);
  }
}

async function ensureDocumentOriginal(document) {
  const originalKey = documentOriginalKey(document);
  const originalPath = resolveDocumentOriginalPath(dataDir, { ...document, originalKey });
  if (originalPath && await hasVerifiedLocalOriginal(document)) return originalPath;
  if (!document?.cloudOriginalFile) throw new Error("원본을 사용할 수 없습니다.");
  const lockKey = String(document.hash || originalKey || document.cloudOriginalFile).toLowerCase();
  if (!cloudOriginalDownloads.has(lockKey)) {
    cloudOriginalDownloads.set(lockKey, (async () => {
        const markSourceStatus = async (status) => {
          const current = await readDb(); const currentDoc = current.documents.find((item) => item.id === document.id);
          if (currentDoc) { currentDoc.sourceStatus = status; await writeDb(current); v2Store?.updateDocumentSource(currentDoc); }
        };
      await markSourceStatus("syncing");
      try {
        const structure = await findMyboxFolderStructure();
        if (!structure?.weki || !structure.data) throw new Error("MYBOX에 새 Weki 백업이 없습니다.");
        const downloaded = await downloadCloudOriginal(mybox, structure, document.cloudOriginalFile, document.hash);
        if (!originalPath) throw new Error("문서 원본 식별자를 확인할 수 없습니다.");
        await writeOriginalAtomically(originalPath, downloaded.bytes);
        const current = await readDb();
        const currentDoc = current.documents.find((item) => item.id === document.id);
        if (currentDoc) { currentDoc.originalKey = originalKey; currentDoc.sourceStatus = "local_available"; currentDoc.cloudOriginalFile = document.cloudOriginalFile; delete currentDoc.originalPath; await writeDbAtomic(current); await syncDocumentToV2(currentDoc); }
        return originalPath;
      } catch (error) {
        await markSourceStatus(document.cloudOriginalFile ? "cloud_available" : "unavailable");
        throw error;
      }
    })());
  }
  const pending = cloudOriginalDownloads.get(lockKey);
  try { return await pending; }
  finally { if (cloudOriginalDownloads.get(lockKey) === pending) cloudOriginalDownloads.delete(lockKey); }
}

async function runMyboxCatalogSync({ initial = false } = {}) {
  if (myboxSyncPromise) return myboxSyncPromise;
  myboxSyncPromise = (async () => {
    const current = await readDb();
    if (!process.env.NAVER_MBOX_TOKEN) throw new Error("MYBOX 개인 액세스 토큰이 설정되지 않았습니다.");
    if (!initial && (activeJobs(current).length || current.maintenance)) throw new Error("Processing Queue가 비어 있고 Maintenance 작업이 없어야 합니다.");
    myboxSyncState.state = "syncing"; myboxSyncState.message = "MYBOX 검색 DB를 동기화하는 중입니다.";
    current.maintenance = { type: "mybox-sync", startedAt: new Date().toISOString() }; await writeDb(current);
    try {
      const structure = await findMyboxFolderStructure();
      const catalog = await readCloudCatalog(mybox, structure);
      const merge = await mergeCloudCatalog(current, catalog.snapshot, { resolveLocalPath: (doc) => resolveDocumentOriginalPath(dataDir, doc), readFile: fs.readFile });
      const now = new Date().toISOString();
      merge.database.audit ??= [];
      merge.database.audit.unshift({ id: crypto.randomUUID(), type: "mybox-sync", detail: `MYBOX 검색 DB 동기화 · knowledge-base.json만 다운로드 · ${merge.database.documents.length}개 문서`, createdAt: now });
      merge.database.maintenance = null;
      await writeDbAtomic(merge.database);
      myboxSyncState.state = "succeeded"; myboxSyncState.message = `${merge.database.documents.length}개 문서를 동기화했습니다.`; myboxSyncState.completedAt = now;
      return { documents: merge.database.documents.length, conflicts: merge.conflicts };
    } catch (error) {
      myboxSyncState.state = "failed"; myboxSyncState.message = error.message;
      current.maintenance = null; await writeDb(current);
      throw error;
    } finally { myboxSyncPromise = null; }
  })();
  return myboxSyncPromise;
}

async function ensureMyboxHashFolder(dataResourceId, hash, cache = new Map()) {
  const key = String(hash).toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const resources = await mybox.listResources({ parentId: dataResourceId });
  let folder = resources.find((resource) => String(resource?.type || "").toLowerCase() === "folder" && String(resource.name || "").toLowerCase() === key);
  if (!folder) folder = await mybox.createFolder(key, dataResourceId);
  cache.set(key, folder);
  return folder;
}
async function verifyRemoteSnapshotOriginals(structure, snapshot) {
  const localUploadPaths = new Set(snapshot.originals.filter((item) => !item.skipUpload).map((item) => item.storagePath));
  for (const entry of snapshot.json.manifest.files || []) {
    if (localUploadPaths.has(entry.storagePath)) continue;
    await findCloudOriginalResource(mybox, structure, `data/${entry.storagePath}`);
  }
}
async function copyStoreContents(targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  for (const entry of ["knowledge-base.json", "v2", "runtime", "originals", "incoming", "backups", "tessdata", "credentials", "storage-location.json", ".weki-storage-root"]) {
    const source = path.join(dataDir, entry); const destination = path.join(targetDir, entry);
    try { await fs.cp(source, destination, { recursive: true, force: false, errorOnExist: false }); } catch (error) { if (error.code !== "EEXIST" && error.code !== "ENOENT") throw error; }
  }
  JSON.parse(await fs.readFile(path.join(targetDir, "knowledge-base.json"), "utf8"));
}
const windowsStorageRegistryKey = "HKCU\\Software\\Weki";
function updateWindowsStoragePointer(targetDir, cleanupRoot = null) {
  if (process.platform !== "win32" || process.env.WEKI_DESKTOP !== "1") return true;
  try {
    const pointer = spawnSync("reg.exe", ["add", windowsStorageRegistryKey, "/v", "DataDir", "/t", "REG_SZ", "/d", path.resolve(targetDir), "/f"], { windowsHide: true, encoding: "utf8" });
    if (pointer.status !== 0) return false;
    if (cleanupRoot) {
      const pending = spawnSync("reg.exe", ["add", windowsStorageRegistryKey, "/v", "PendingCleanupRoot", "/t", "REG_SZ", "/d", path.resolve(cleanupRoot), "/f"], { windowsHide: true, encoding: "utf8" });
      if (pending.status !== 0) return false;
    }
    return true;
  } catch { return false; }
}
async function removeManagedStore(rootDir) {
  const managedDirectories = ["v2", "runtime", "originals", "incoming", "backups", "tessdata", "credentials"];
  if (!(process.platform === "win32" && process.env.WEKI_DESKTOP === "1")) managedDirectories.push(".runtime");
  for (const entry of managedDirectories) await fs.rm(path.join(rootDir, entry), { recursive: true, force: true });
  for (const entry of ["knowledge-base.json", "knowledge-base.json.bak", "storage-location.json", ".weki-storage-root"]) await fs.rm(path.join(rootDir, entry), { force: true });
  try {
    const databaseArtifacts = (await fs.readdir(rootDir)).filter((entry) => entry.startsWith("knowledge-base.json.") && (entry.includes("corrupt-") || entry.endsWith(".partial") || entry.endsWith(".tmp")));
    for (const entry of databaseArtifacts) await fs.rm(path.join(rootDir, entry), { force: true });
  } catch { /* The root may already have been removed. */ }
  try {
    const remaining = await fs.readdir(rootDir);
    if (remaining.length) return false;
    await fs.rmdir(rootDir);
    return !(await fs.stat(rootDir).catch(() => null));
  } catch { return false; }
}

const initialStoreCreated = await ensureStore();
const databaseForIndex = await readDb();
const v2Enabled = true;
let v2Store = createSearchStore({ directory: v2DataDir });
for (const document of databaseForIndex.documents || []) v2Store.updateDocumentSource(document);
let legacyMigration = { status: "pending", total: databaseForIndex.documents?.length || 0, completed: 0, failed: 0, updatedAt: null };
const runtimeComponentState = await getComponentState(runtimeRoot);
const configuredRenderer = runtimeComponentState.components?.["document-renderer"] || null;
const rendererComponentPath = configuredRenderer?.status === "ready" ? configuredRenderer.path : null;
const documentRenderer = rendererComponentPath ? await createDocumentRenderer({ componentPath: rendererComponentPath }).catch(() => null) : null;
const rendererSource = configuredRenderer?.status === "ready" ? "runtime" : documentRenderer ? "bundled" : null;
const rendererComponentVersion = configuredRenderer?.version || null;
const rendererAvailableForFormat = (format) => Boolean(documentRenderer) && ["HWP", "HWPX"].includes(String(format || "").toUpperCase());
const configuredPresentation = runtimeComponentState.components?.["presentation-renderer"] || null;
const managedPresentationPath = resolveInstalledDependencyExecutable({ root: dependencyRoot, name: DEFAULT_PRESENTATION_DEPENDENCY_MANIFEST.name, executable: DEFAULT_PRESENTATION_DEPENDENCY_MANIFEST.entrypoint, expectedSha256: DEFAULT_PRESENTATION_DEPENDENCY_MANIFEST.sha256 });
const configuredPresentationPath = configuredPresentation?.status === "ready" && configuredPresentation.path
  ? path.resolve(configuredPresentation.path, configuredPresentation.entrypoint || DEFAULT_PRESENTATION_DEPENDENCY_MANIFEST.entrypoint)
  : null;
const presentationExecutablePath = managedPresentationPath || (configuredPresentationPath && fsSync.existsSync(configuredPresentationPath) ? configuredPresentationPath : null);
const presentationRenderer = await createPresentationRenderer({ executablePath: presentationExecutablePath });
const semanticModelPath = runtimeComponentState.components?.["semantic-model"]?.status === "ready" ? runtimeComponentState.components["semantic-model"].path : null;
const embeddingProvider = semanticModelPath ? await createRuntimeEmbeddingProvider({ componentPath: semanticModelPath }) : null;
const rerankerPath = runtimeComponentState.components?.["semantic-reranker"]?.status === "ready" ? runtimeComponentState.components["semantic-reranker"].path : null;
const rerankerProvider = rerankerPath ? await createRuntimeRerankerProvider({ componentPath: rerankerPath }) : null;
let annIndex = v2Store ? createAnnIndex({ directory: path.join(v2DataDir, "ann"), dimension: 384 }) : null;
if (v2Store) v2Store.setIndexState({ name: "model", generation: semanticModelPath || "none", revision: Date.now(), status: embeddingProvider?.available ? "ready" : semanticModelPath ? "degraded" : "unavailable" });
if (v2Store && annIndex && embeddingProvider?.available) {
  const existingEmbeddings = v2Store.listEmbeddings({ dimension: 384 });
  if (existingEmbeddings.length && (await annIndex.health()).status !== "healthy") {
    try { const generation = await annIndex.build(existingEmbeddings); v2Store.setIndexState({ name: "ann", generation, revision: Date.now(), status: "ready" }); } catch { /* A later registration can rebuild the ANN generation. */ }
  }
}
let semanticEngine = v2Store ? createSemanticEngine({ store: v2Store, annIndex, dimension: 384, model: "multilingual-e5-small", embedQuery: embeddingProvider?.available ? (query) => embeddingProvider.embed(query, "query") : null }) : null;
let v2Search = v2Store ? createSearchService({ store: v2Store, semanticSearch: semanticEngine.search.bind(semanticEngine), reranker: rerankerProvider?.available ? rerankerProvider.rerank : null }) : null;
let annRebuildTimer = null;
let annRebuildPromise = null;
function scheduleAnnRebuild({ delay = 500 } = {}) {
  if (!embeddingProvider?.available || !v2Store || !annIndex) return;
  if (annRebuildTimer) clearTimeout(annRebuildTimer);
  annRebuildTimer = setTimeout(() => {
    annRebuildTimer = null;
    annRebuildPromise = (async () => {
      try {
        const generation = await annIndex.build(v2Store.listEmbeddings({ dimension: 384, model: "multilingual-e5-small" }));
        v2Store.setIndexState({ name: "ann", generation, revision: Date.now(), status: "ready" });
      } catch { /* Keep the previous generation available; a later batch retries the build. */ }
    })().finally(() => { annRebuildPromise = null; });
  }, Math.max(100, Number(delay) || 500));
}
async function syncDocumentToV2(document, { rebuildAnn = true, store = v2Store, ann = annIndex } = {}) {
  if (!store || !document?.id) return;
  const entries = [];
  for (const unit of document.units || []) {
      const fragments = buildEvidenceFragments({
        documentId: document.id,
        page: unit.range,
        nativeText: unit.evidenceType === "text" ? unit.nativeText : "",
        ocrText: unit.evidenceType === "text" ? unit.ocrText : "",
        textSource: unit.textSource,
        context: unit.evidenceType === "text" ? unit.text : "",
        nearbyText: unit.visualNearbyText || "",
        table: unit.table || (unit.evidenceType === "table" ? { headers: [], rows: [[unit.text]] } : null),
        chart: unit.chart || null,
        confidence: unit.ocrConfidence,
        diagnostics: unit.diagnostics,
        sourceRef: unit.sourceRef || null,
        caption: unit.caption || "",
        visualAssets: unit.visualAssetName ? [{
          name: unit.visualAssetName,
          mime: unit.visualMime,
          ocrText: unit.ocrText,
          caption: unit.caption,
          nearbyText: unit.visualNearbyText,
          assetType: unit.evidenceType,
          origin: unit.textSource,
          sourceRef: unit.sourceRef,
          table: unit.table,
          chart: unit.chart,
          confidence: unit.ocrConfidence,
          diagnostics: unit.diagnostics,
        }] : [],
        maxTokens: 384,
        overlapTokens: 64,
      });
    for (const fragment of fragments) {
      const indexedUnitId = `${unit.id}:${fragment.id}`;
      let vector = null;
      if (embeddingProvider?.available) {
        try { vector = await embeddingProvider.embed(`${document.name} ${unit.heading || ""} ${fragment.context || ""} ${unit.searchAuxiliaryText || ""}`, "passage"); } catch { /* Semantic indexing remains optional; lexical indexing is authoritative. */ }
      }
      entries.push({
        evidence: { id: fragment.id, documentId: document.id, pageStart: fragment.pageStart, pageEnd: fragment.pageEnd, type: fragment.type, origin: fragment.origin, assetName: fragment.assetName || null, context: fragment.context, confidence: fragment.confidence ?? null, diagnostics: fragment.diagnostics || [], structured: fragment.structured || null },
        unit: { id: indexedUnitId, documentId: document.id, title: document.name, heading: unit.heading || "", text: fragment.context || "", nativeText: unit.nativeText || "", ocrText: unit.ocrText || "", textSource: unit.textSource || fragment.origin || null, confidence: fragment.confidence ?? unit.ocrConfidence ?? null, caption: unit.caption || "", table: fragment.type === "table" ? fragment.structured : unit.table || null, chart: fragment.type === "chart" ? fragment.structured : unit.chart || null, structured: fragment.structured || null, generatedMetadata: unit.generatedMetadata, searchAuxiliaryText: [unit.searchAuxiliaryText || "", unit.caption || "", fragment.structured ? JSON.stringify(fragment.structured) : ""].filter(Boolean).join(" "), sourceRange: unit.range, evidenceIds: [fragment.id] },
        embedding: vector ? { vector, dimension: vector.length, model: "multilingual-e5-small", generation: String(document.updatedAt || document.registeredAt || "active") } : null,
      });
    }
  }
  store.replaceDocumentIndex({ document: { id: document.id, name: document.name, format: String(document.format || "").toLowerCase(), createdAt: document.registeredAt, modifiedAt: document.modifiedAt, sourceHash: document.hash, sourceStatus: document.sourceStatus, cloudOriginalFile: document.cloudOriginalFile || null }, entries });
  if (rebuildAnn && store === v2Store && ann === annIndex) scheduleAnnRebuild();
  store.setIndexState({ name: "fts", generation: String(document.updatedAt || document.registeredAt || Date.now()), revision: Date.now(), status: "ready" });
}
let v2ReindexState = { status: "idle", total: 0, completed: 0, failed: 0, startedAt: null, finishedAt: null, error: null };
let v2ReindexPromise = null;
async function renameDirectoryWithRetry(source, destination) {
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try { await fs.rename(source, destination); return; }
    catch (error) {
      lastError = error;
      if (process.platform !== "win32" || !["EPERM", "EBUSY"].includes(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 75 * (attempt + 1)));
    }
  }
  throw lastError;
}
function startV2Reindex() {
  if (v2ReindexPromise) return v2ReindexPromise;
  if (annRebuildTimer) { clearTimeout(annRebuildTimer); annRebuildTimer = null; }
  v2ReindexState = { status: "indexing", total: 0, completed: 0, failed: 0, startedAt: new Date().toISOString(), finishedAt: null, error: null };
  let reindexStagingDir = null;
  v2ReindexPromise = (async () => {
    if (annRebuildPromise) await annRebuildPromise.catch(() => {});
    const current = await readDb();
    const documents = current.documents || [];
    v2ReindexState.total = documents.length;
    const generation = `${Date.now()}-${crypto.randomUUID()}`;
    const stagingDir = path.join(dataDir, `.v2-reindex-${generation}`);
    reindexStagingDir = stagingDir;
    const previousDir = path.join(dataDir, `v2.previous-${generation}`);
    await fs.rm(stagingDir, { recursive: true, force: true });
    const shadowStore = createSearchStore({ directory: stagingDir });
    const shadowAnn = embeddingProvider?.available ? createAnnIndex({ directory: path.join(stagingDir, "ann"), dimension: 384 }) : null;
    for (const document of documents) {
      try { await syncDocumentToV2(document, { rebuildAnn: false, store: shadowStore, ann: shadowAnn }); v2ReindexState.completed += 1; }
      catch { v2ReindexState.failed += 1; }
    }
    if (v2ReindexState.failed) throw new Error("일부 문서의 검색 색인을 생성하지 못했습니다.");
    if (embeddingProvider?.available && shadowAnn) {
      const embeddings = shadowStore.listEmbeddings({ dimension: 384, model: "multilingual-e5-small" });
      await shadowAnn.build(embeddings);
    }
    shadowAnn?.close?.();
    shadowStore.close();
    await annIndex?.close?.();
    v2Store.close();
    await renameDirectoryWithRetry(v2DataDir, previousDir);
    try {
      await renameDirectoryWithRetry(stagingDir, v2DataDir);
    } catch (error) {
      await fs.rename(previousDir, v2DataDir).catch(() => {});
      v2Store = createSearchStore({ directory: v2DataDir });
      annIndex = createAnnIndex({ directory: path.join(v2DataDir, "ann"), dimension: 384 });
      semanticEngine = createSemanticEngine({ store: v2Store, annIndex, dimension: 384, model: "multilingual-e5-small", embedQuery: embeddingProvider?.available ? (query) => embeddingProvider.embed(query, "query") : null });
      v2Search = createSearchService({ store: v2Store, semanticSearch: semanticEngine.search.bind(semanticEngine), reranker: rerankerProvider?.available ? rerankerProvider.rerank : null });
      throw error;
    }
    v2Store = createSearchStore({ directory: v2DataDir });
    annIndex = createAnnIndex({ directory: path.join(v2DataDir, "ann"), dimension: 384 });
    semanticEngine = createSemanticEngine({ store: v2Store, annIndex, dimension: 384, model: "multilingual-e5-small", embedQuery: embeddingProvider?.available ? (query) => embeddingProvider.embed(query, "query") : null });
    v2Search = createSearchService({ store: v2Store, semanticSearch: semanticEngine.search.bind(semanticEngine), reranker: rerankerProvider?.available ? rerankerProvider.rerank : null });
    v2ReindexState.status = "ready";
    v2ReindexState.finishedAt = new Date().toISOString();
    v2ReindexState.error = null;
    v2Store.setIndexState({ name: "reindex", generation: String(v2ReindexState.finishedAt), revision: Date.now(), status: v2ReindexState.status });
    await fs.rm(previousDir, { recursive: true, force: true });
  })().catch((error) => {
    v2ReindexState.status = "failed"; v2ReindexState.finishedAt = new Date().toISOString(); v2ReindexState.error = error.message;
    try { v2Store.health(); } catch {
      v2Store = createSearchStore({ directory: v2DataDir });
      annIndex = createAnnIndex({ directory: path.join(v2DataDir, "ann"), dimension: 384 });
      semanticEngine = createSemanticEngine({ store: v2Store, annIndex, dimension: 384, model: "multilingual-e5-small", embedQuery: embeddingProvider?.available ? (query) => embeddingProvider.embed(query, "query") : null });
      v2Search = createSearchService({ store: v2Store, semanticSearch: semanticEngine.search.bind(semanticEngine), reranker: rerankerProvider?.available ? rerankerProvider.rerank : null });
    }
    try { v2Store.setIndexState({ name: "reindex", generation: String(v2ReindexState.finishedAt), revision: Date.now(), status: "failed" }); } catch { /* Keep the active generation available even if state persistence fails. */ }
    if (reindexStagingDir) void fs.rm(reindexStagingDir, { recursive: true, force: true }).catch(() => {});
  }).finally(() => { v2ReindexPromise = null; });
  return v2ReindexPromise;
}
function sourceDatabaseGeneration(documents) {
  return crypto.createHash("sha256").update(JSON.stringify((documents || []).map((document) => ({
    id: document.id,
    hash: document.hash,
    updatedAt: document.updatedAt,
    registeredAt: document.registeredAt,
    units: (document.units || []).map((unit) => ({ id: unit.id, range: unit.range, text: unit.text, nativeText: unit.nativeText, ocrText: unit.ocrText, textSource: unit.textSource, evidenceType: unit.evidenceType, visualAssetName: unit.visualAssetName, sourceRef: unit.sourceRef, table: unit.table, chart: unit.chart, diagnostics: unit.diagnostics, generatedMetadata: unit.generatedMetadata ? { summary: unit.generatedMetadata.summary, topic: unit.generatedMetadata.topic, keywords: unit.generatedMetadata.keywords, visualDescriptions: unit.generatedMetadata.visualDescriptions } : null, searchAuxiliaryText: unit.searchAuxiliaryText || "" })),
  })))).digest("hex");
}
const sourceGeneration = sourceDatabaseGeneration(databaseForIndex.documents || []);
const storedSourceMigration = v2Store.getIndexState("source-migration");
if (storedSourceMigration?.generation === sourceGeneration && storedSourceMigration.status === "ready") {
  legacyMigration = { ...legacyMigration, status: "ready", completed: legacyMigration.total, updatedAt: storedSourceMigration.updated_at };
} else {
  v2Store.setIndexState({ name: "source-migration", generation: sourceGeneration, revision: Date.now(), status: "pending" });
  const maintenanceDb = await readDb();
  maintenanceDb.maintenance = { type: "search-index-migration", startedAt: new Date().toISOString(), detail: "검색 색인을 새 Evidence 구조로 교체하는 중입니다." };
  await writeDb(maintenanceDb);
  if ((databaseForIndex.documents || []).length) {
    await startV2Reindex();
    legacyMigration.completed = v2ReindexState.completed;
    legacyMigration.failed = v2ReindexState.failed;
    legacyMigration.status = v2ReindexState.status === "ready" && legacyMigration.failed === 0 ? "ready" : "failed";
  } else {
    legacyMigration.status = "ready";
    legacyMigration.completed = 0;
  }
  const completedDb = await readDb(); completedDb.maintenance = null; await writeDb(completedDb);
  legacyMigration.updatedAt = new Date().toISOString();
  v2Store.setIndexState({ name: "source-migration", generation: sourceGeneration, revision: Date.now(), status: legacyMigration.status });
}
const optionalRuntimeComponents = ["semantic-model", "semantic-reranker", "document-renderer", "presentation-renderer"];
const presentationComponentId = "presentation-renderer";
function resolveSevenZipPath() {
  const candidates = [
    process.env.WEKI_7Z_PATH,
    process.resourcesPath ? path.join(process.resourcesPath, "tools", "7zip", "7z.exe") : null,
    path.join(resourcesDir, "tools", "7zip", "7z.exe"),
    path.join(root, "node_modules", "electron-winstaller", "vendor", "7z-x64.exe"),
    "7z.exe",
  ].filter(Boolean);
  return candidates.find((candidate) => path.isAbsolute(candidate) ? fsSync.existsSync(candidate) : Boolean(spawnSync(process.platform === "win32" ? "where.exe" : "which", [candidate], { encoding: "utf8", windowsHide: true }).status === 0)) || candidates[0];
}
async function readPresentationDependencyManifest() {
  try {
    const manifest = JSON.parse(await fs.readFile(libreOfficeManifestPath, "utf8"));
    return { ...DEFAULT_PRESENTATION_DEPENDENCY_MANIFEST, ...manifest };
  } catch { return DEFAULT_PRESENTATION_DEPENDENCY_MANIFEST; }
}
async function readBundledMyboxRuntimeManifest() {
  try {
    const manifestPath = path.join(resourcesDir, "runtime-manifests", "mybox-runtime-v1.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    return manifest?.source === "mybox" && validateManifest(manifest).ok ? manifest : null;
  } catch { return null; }
}
async function resolveMyboxPresentationSource(manifest, { required = false } = {}) {
  if (!process.env.NAVER_MBOX_TOKEN) {
    if (required) throw new RuntimePackUnavailableError("MYBOX LibreOffice 설치에는 개인 액세스 토큰이 필요합니다.");
    return null;
  }
  try {
    const loaded = await readMyboxRuntimeManifest();
    const entry = loaded.manifest.components?.find((item) => item.id === presentationComponentId && item.version === manifest.version);
    if (!entry) throw new RuntimePackUnavailableError(`MYBOX runtime component이 설정되지 않았습니다: ${presentationComponentId}@${manifest.version}`);
    const file = entry.files?.find((item) => path.posix.basename(String(item.path || "")) === LIBREOFFICE_BUNDLE_NAME && String(item.sha256 || "").toLowerCase() === String(manifest.sha256).toLowerCase());
    if (!file) throw new RuntimePackUnavailableError("MYBOX LibreOffice runtime payload의 파일명 또는 SHA-256이 pinned manifest와 일치하지 않습니다.");
    await findRuntimeResource(mybox, loaded.structure, entry.id, entry.version, file.path);
    const encodedPath = String(file.path).split("/").filter(Boolean).map((part) => encodeURIComponent(part)).join("/");
    return {
      sourceUrl: `mybox://runtime/${encodeURIComponent(entry.id)}/${encodeURIComponent(entry.version)}/${encodedPath}`,
      fetchImpl: myboxRuntimeSource({ structure: loaded.structure, componentId: entry.id, version: entry.version }),
      sourceType: "mybox",
      source: loaded.manifest.source || "mybox",
    };
  } catch (error) {
    if (required) throw error;
    return null;
  }
}
async function installPresentationRendererDependency({ source: requestedSource = "auto", resolvedSource = null } = {}) {
  const manifest = await readPresentationDependencyManifest();
  let sourcePath;
  let sourceUrl = null;
  let fetchImpl = globalThis.fetch;
  let sourceType = null;
  let source = null;
  if (requestedSource === "public") throw new Error("presentation-renderer는 공개 URL로 설치할 수 없습니다. MYBOX 배포본 또는 오프라인 번들을 사용하세요.");
  if (requestedSource === "auto" && fsSync.existsSync(offlineLibreOfficeBundlePath) && !process.env.NAVER_MBOX_TOKEN) {
    sourcePath = offlineLibreOfficeBundlePath;
    source = "Weki bundled dependency";
    sourceType = "bundled";
  } else {
    const myboxSource = resolvedSource || await resolveMyboxPresentationSource(manifest, { required: true });
    sourceUrl = myboxSource.sourceUrl;
    fetchImpl = myboxSource.fetchImpl;
    sourceType = myboxSource.sourceType;
    source = myboxSource.source;
  }
  const result = await ensureManagedDependency({
    root: dependencyRoot,
    manifest,
    sourcePath,
    sourceUrl,
    fetchImpl,
    install: ({ stagedPath, destination }) => extractPortableArchive({ archivePath: stagedPath, destination, extractorPath: resolveSevenZipPath() }),
  });
  const executable = resolveInstalledDependencyExecutable({ root: dependencyRoot, name: manifest.name, executable: manifest.entrypoint, expectedSha256: manifest.sha256 }) || path.resolve(result.destination, manifest.entrypoint);
  if (!fsSync.existsSync(executable)) throw new Error("LibreOffice dependency was extracted but soffice.exe is missing");
  await updateComponentState({ rootDirectory: runtimeRoot, componentId: presentationComponentId, patch: {
    status: "ready", version: manifest.version, path: result.destination, entrypoint: manifest.entrypoint,
    progress: 100, completedFiles: 1, totalFiles: 1, currentFile: null, bytesDownloaded: 0, totalBytes: 0,
    sourceType, source, requiresMybox: sourceType === "mybox", reason: null, applied: false,
  } });
  return { ...result, executable, manifest, sourceType, source };
}
function createRuntimeInstallBatchState() {
  const unavailable = [];
  return {
    status: "idle",
    componentIds: [],
    currentComponent: null,
    completed: 0,
    total: 0,
    results: {},
    installed: [],
    unavailable,
    unavailableDetails: [],
    failed: [],
    skipped: unavailable,
    error: null,
    startedAt: null,
    finishedAt: null,
  };
}
let runtimeInstallBatchState = createRuntimeInstallBatchState();
let runtimeInstallBatchPromise = null;
function compareRuntimeVersions(left, right) {
  const parse = (value) => String(value || "0").replace(/^v/i, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left); const b = parse(right);
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}
async function runtimeStatus() {
  const state = await getComponentState(runtimeRoot);
  let manifest = null;
  try { manifest = JSON.parse(await fs.readFile(path.join(runtimeRoot, "manifest.json"), "utf8")); } catch { /* Optional packs are not installed yet. */ }
  const bundledMyboxManifest = await readBundledMyboxRuntimeManifest();
  const manifestEntries = Array.isArray(manifest?.components) ? manifest.components : [];
  const defaultSource = (entry) => entry.files?.some((file) => typeof file.url === "string" && file.url.startsWith("file:"))
    ? { source: "Weki bundled runtime pack", sourceType: "bundled" }
    : { source: DEFAULT_RUNTIME_MANIFEST.source, sourceType: "public" };
  const defaultPresentationSource = !process.env.NAVER_MBOX_TOKEN && fsSync.existsSync(offlineLibreOfficeBundlePath)
    ? { source: "Weki bundled dependency", sourceType: "bundled", requiresMybox: false }
    : { source: "mybox", sourceType: "mybox", requiresMybox: true };
  const defaultEntries = [...DEFAULT_RUNTIME_MANIFEST.components, { id: presentationComponentId, version: DEFAULT_PRESENTATION_DEPENDENCY_MANIFEST.version, license: DEFAULT_PRESENTATION_DEPENDENCY_MANIFEST.license }];
  const installable = Object.fromEntries(defaultEntries.map((entry) => {
    const source = defaultSource(entry);
    return [entry.id, { version: entry.version, license: entry.license || DEFAULT_RUNTIME_MANIFEST.license, ...source, ...(entry.id === presentationComponentId ? defaultPresentationSource : {}), requiresMybox: entry.id === presentationComponentId ? defaultPresentationSource.requiresMybox : false }];
  }));
  for (const entry of bundledMyboxManifest?.components || []) {
    if (!installable[entry.id] || entry.id === "document-renderer") installable[entry.id] = { version: entry.version, license: entry.license || bundledMyboxManifest.license || null, source: "mybox", sourceType: "mybox", requiresMybox: true };
  }
  for (const entry of manifestEntries) {
    if (entry.id === "document-renderer" && manifest.source !== "mybox") continue;
    const recorded = state.components?.[entry.id];
    const sourceType = recorded?.sourceType || (manifest.source === "mybox" ? "mybox" : "public");
    const source = recorded?.source || manifest.source || process.env.WEKI_RUNTIME_MANIFEST_URL || null;
    installable[entry.id] = { version: entry.version, license: entry.license || manifest.license || null, source, sourceType, requiresMybox: sourceType === "mybox" };
  }
  for (const [id, current] of Object.entries(state.components || {})) {
    const hasMyboxRendererMetadata = id === "document-renderer" && current?.sourceType === "mybox";
    const recoverableRendererFailure = id === "document-renderer" && hasMyboxRendererMetadata && current?.status === "failed";
    if ((current?.version || recoverableRendererFailure) && !installable[id] && (id !== "document-renderer" || hasMyboxRendererMetadata)) installable[id] = { version: current.version || null, license: null, source: hasMyboxRendererMetadata ? current.source || "mybox" : current.source || null, sourceType: hasMyboxRendererMetadata ? "mybox" : current.sourceType || null, requiresMybox: hasMyboxRendererMetadata };
  }
  const knownIds = [...new Set([...optionalRuntimeComponents, ...Object.keys(state.components || {}), ...manifestEntries.map((entry) => entry.id)])];
  const components = {};
  for (const id of knownIds) {
    const current = state.components?.[id];
    let applied = false;
    if (current) {
      let status = current.status;
      if (status === "ready" && current.path) {
        try { const stat = await fs.stat(current.path); if (!stat.isDirectory()) status = "missing"; } catch { status = "missing"; }
      }
      applied = status === "ready" && (id === "document-renderer" ? Boolean(documentRenderer) : id === presentationComponentId ? Boolean(presentationRenderer?.available) : id === "semantic-model" ? Boolean(embeddingProvider?.available) : id === "semantic-reranker" ? Boolean(rerankerProvider?.available) : true);
      const available = installable[id] || null;
      const myboxOnly = id === "document-renderer" && !available;
      const rendererBundledReady = id === "document-renderer" && status === "ready" && Boolean(documentRenderer) && current.sourceType !== "mybox" && current.sourceType !== "public";
      const availableVersion = available?.version || null;
      const rendererUnavailable = id === "document-renderer" && !rendererBundledReady && !available && current.reason !== "runtime_install_failed";
      components[id] = { ...current, status, applied, installable: Boolean(available), availableVersion, updateAvailable: status === "ready" && Boolean(availableVersion) && compareRuntimeVersions(availableVersion, current.version) > 0, sourceType: id === "document-renderer" ? (rendererBundledReady ? "bundled" : "mybox") : current.sourceType || available?.sourceType || (myboxOnly ? "mybox" : null), requiresMybox: id === "document-renderer" ? !rendererBundledReady : current.requiresMybox ?? available?.requiresMybox ?? myboxOnly, reason: rendererUnavailable || status === "missing" && !available ? "runtime_pack_not_configured" : !applied && status === "ready" ? "component_not_applied" : current.reason || null };
    } else {
      const available = installable[id] || null;
      const myboxOnly = id === "document-renderer" && !available;
      components[id] = id === "document-renderer" && documentRenderer
        ? { id, status: "ready", applied: true, source: rendererSource, version: rendererComponentVersion, progress: 100, completedFiles: 0, totalFiles: 0, currentFile: null, installable: false, availableVersion: null, updateAvailable: false, sourceType: "bundled", requiresMybox: false, reason: null }
        : id === presentationComponentId && presentationRenderer?.available
          ? { id, status: "ready", applied: true, source: presentationRenderer.executable || "environment", version: null, progress: 100, completedFiles: 0, totalFiles: 0, currentFile: null, installable: Boolean(available), availableVersion: available?.version || null, updateAvailable: false, sourceType: "environment", requiresMybox: false, reason: null }
        : { id, status: "missing", applied: false, version: null, progress: 0, completedFiles: 0, currentFile: null, bytesDownloaded: 0, totalBytes: 0, installable: Boolean(available), availableVersion: available?.version || null, updateAvailable: false, sourceType: available?.sourceType || (myboxOnly ? "mybox" : null), requiresMybox: available?.requiresMybox ?? myboxOnly, reason: available ? null : "runtime_pack_not_configured" };
    }
  }
  return { rootDirectory: runtimeRoot, manifestVersion: manifest?.version || null, manifestUrl: process.env.WEKI_RUNTIME_MANIFEST_URL || null, installable, components, installBatch: runtimeInstallBatchState };
}
const SAFE_EXTERNAL_ERROR_CODES = new Set([
  "external_ai_not_configured",
  "external_ai_model_not_selected",
  "external_ai_connection_failed",
  "external_ai_invalid_key",
  "external_ai_permission_denied",
  "external_ai_rate_limited",
  "external_ai_provider_error",
  "external_ai_timeout",
  "external_ai_invalid_response",
  "external_ai_disabled",
]);
let externalApiKey = "";
let externalCredentialSync = Promise.resolve();
if (typeof process.on === "function") {
  process.on("message", (message) => {
    if (!message || message.type !== "weki:gemini-credential") return;
    if (Object.hasOwn(message, "apiKey") && message.apiKey !== null && typeof message.apiKey !== "string") return;
    externalCredentialSync = externalCredentialSync.then(async () => {
      if (Object.hasOwn(message, "apiKey")) externalApiKey = String(message.apiKey || "").trim();
      try {
        const db = await readDb();
        const external = externalSettings(db.settings);
        external.lastConnection = { status: "unknown", checkedAt: null, errorCode: null };
        db.settings = { ...(db.settings || {}), externalAi: external };
        await writeDb(db);
      } catch {}
      try { if (typeof process.send === "function") process.send({ type: "weki-gemini-credential-applied" }); } catch {}
    }).catch(() => {});
    void externalCredentialSync;
  });
}
const externalProviderBaseUrl = process.env.WEKI_GEMINI_API_BASE_URL || process.env.WEKI_GEMINI_API_BASE || undefined;
const externalProviderTimeoutMs = Number(process.env.WEKI_GEMINI_TIMEOUT_MS) || 30_000;
const safeExternalErrorCode = (error) => SAFE_EXTERNAL_ERROR_CODES.has(error?.code) ? error.code : "external_ai_provider_error";
const normalizedLastConnection = (value) => {
  const status = ["unknown", "ready", "failed"].includes(value?.status) ? value.status : "unknown";
  return {
    status,
    checkedAt: typeof value?.checkedAt === "string" ? value.checkedAt : null,
    errorCode: status === "failed" && SAFE_EXTERNAL_ERROR_CODES.has(value?.errorCode) ? value.errorCode : null,
  };
};
const externalSettings = (settings = {}) => {
  const source = settings.externalAi && typeof settings.externalAi === "object" ? settings.externalAi : {};
  return {
    provider: "gemini",
    modelId: typeof source.modelId === "string" && source.modelId.trim() ? source.modelId.trim() : null,
    consentVersion: source.consentVersion === 1 ? 1 : null,
    lastConnection: normalizedLastConnection(source.lastConnection),
  };
};
function externalAiStatus(settings = {}) {
  const configured = Boolean(externalApiKey);
  const external = externalSettings(settings);
  const enabled = normalizeDefaultProcessingMode(settings.defaultProcessingMode) === "external-ai";
  const modelSelected = Boolean(external.modelId);
  const connectionReady = external.lastConnection.status === "ready";
  const ready = enabled && configured && modelSelected && connectionReady;
  const failureReason = !enabled
    ? "external_ai_disabled"
    : configured
      ? modelSelected
        ? (external.lastConnection.status === "failed" ? external.lastConnection.errorCode || "external_ai_connection_failed" : "external_ai_connection_failed")
        : "external_ai_model_not_selected"
      : "external_ai_not_configured";
  return {
    provider: external.provider,
    configured,
    modelSelected,
    enabled,
    ready,
    available: ready,
    modelId: external.modelId,
    lastConnection: external.lastConnection,
    connectionStatus: external.lastConnection.status,
    failureReason,
  };
}
const createExternalProvider = (modelId = null) => externalApiKey
  ? createGeminiProvider({ apiKey: externalApiKey, modelId, ...(externalProviderBaseUrl ? { baseUrl: externalProviderBaseUrl } : {}), timeoutMs: externalProviderTimeoutMs })
  : null;
async function enrichExternalPages(pages, resolution, documentId) {
  const provider = createExternalProvider(resolution.modelId);
  const sourcePages = pages.map((page) => ({ ...page, documentId, processingModeFallback: resolution.fallbackReason || undefined }));
  if (!provider) {
    const timestamp = new Date().toISOString();
    const audits = sourcePages.map((page) => ({ documentId, page: Number(page.page) || 1, provider: resolution.provider || "gemini", model: resolution.modelId, timestamp, status: "failed", errorCode: "external_ai_not_configured", dataType: page.visualAssets?.length ? (page.text ? "text+image" : "image") : "text", excludedImageCount: 0, processingModeFallback: "external_ai_not_configured" }));
    return { pages: sourcePages.map(stripEphemeralImageData), audits, resolution: { ...resolution, effectiveMode: semanticProcessingEnabled() ? "local-ai" : "lightweight", fallbackReason: "external_ai_not_configured", provider: null, modelId: null } };
  }
  const result = await enrichPagesForSearch(sourcePages, { provider });
  const failure = result.audits.find((audit) => audit.status === "failed");
  if (!failure) return { ...result, resolution };
  const fallbackReason = SAFE_EXTERNAL_ERROR_CODES.has(failure.errorCode) ? failure.errorCode : "external_ai_provider_error";
  return {
    ...result,
    audits: result.audits.map((audit) => ({ ...audit, processingModeFallback: fallbackReason })),
    resolution: { ...resolution, effectiveMode: semanticProcessingEnabled() ? "local-ai" : "lightweight", fallbackReason, provider: null, modelId: null },
  };
}
async function processingStatus(db = null, runtime = null) {
  const currentDb = db || await readDb();
  const currentRuntime = runtime || await runtimeStatus();
  const resolved = resolveProcessingDefault(currentDb.settings, currentRuntime.components, externalAiStatus(currentDb.settings));
  return { ...resolved, effectiveDefaultMode: resolved.effectiveDefaultMode, localAiEligible: resolved.localAiEligible };
}
const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024, files: 30 } });
app.get("/api/documents", async (_req, res) => { const db = await readDb(); res.json({ documents: db.documents.map((doc) => publicDocument(db, doc)) }); });
app.get("/api/status", async (_req, res) => {
  const db = await readDb();
  const storage = await readStorageStats();
  const external = externalAiStatus(db.settings);
  res.json({
    documentCount: db.documents.length,
    indexedUnits: db.documents.reduce((count, doc) => count + (doc.units || []).length, 0),
    storage,
    dataDirectory: dataDir,
    databaseRecovery,
    maintenance: db.maintenance ?? null,
    engines: { lexical: "healthy", evidence: "healthy" },
    search: { ...v2Store.health(), ann: annIndex ? await annIndex.health() : { status: "unavailable" }, semantic: semanticEngine.health(), reranker: { status: rerankerProvider?.available ? "healthy" : "unavailable", model: rerankerProvider?.model || null, reason: rerankerProvider?.reason || null }, migration: legacyMigration },
    runtime: await runtimeStatus(),
    processing: { ...(await processingStatus(db)), externalAi: { provider: external.provider, configured: external.configured, modelSelected: external.modelSelected, enabled: external.enabled, ready: external.ready, lastConnection: external.lastConnection } },
    searchVersion: "v2",
    rankingVersion: RANKING_VERSION,
  });
});
const publicSettings = (db) => {
  const external = externalSettings(db.settings);
  const status = externalAiStatus(db.settings);
  return { defaultProcessingMode: normalizeDefaultProcessingMode(db.settings?.defaultProcessingMode), externalAi: { provider: external.provider, modelId: external.modelId, consentVersion: external.consentVersion, enabled: status.enabled, lastConnection: external.lastConnection } };
};
app.get("/api/settings", async (_req, res) => {
  const db = await readDb();
  res.json({ settings: publicSettings(db), externalAi: { ...externalAiStatus(db.settings), failureReason: undefined }, processing: await processingStatus(db) });
});
app.get("/api/mybox/status", async (_req, res) => {
  if (configuredCredentialState === "unreadable") return res.json({ connected: false, credentialState: "unreadable", reason: "credential_unreadable", message: myboxCredentialMessage.unreadable, sync: { ...myboxSyncState } });
  if (!process.env.NAVER_MBOX_TOKEN) return res.json({ connected: false, credentialState: "missing", reason: "token_missing", message: myboxCredentialMessage.missing, sync: { ...myboxSyncState } });
  try { const storage = await mybox.storage(); res.json({ connected: true, credentialState: "available", connectionScope: "storage", message: "저장공간 API 연결됨", storage, sync: { ...myboxSyncState } }); } catch (error) { res.json({ connected: false, ...publicMyboxError(error), sync: { ...myboxSyncState } }); }
});
app.get("/api/mybox/runtime", async (_req, res) => {
  try {
    const structure = await findMyboxRuntimeStructure();
    let manifest = null;
    let manifestError = null;
    if (structure?.manifest) {
      try { manifest = JSON.parse(Buffer.from(await (await mybox.downloadFile(structure.manifest.resourceId, { timeoutMs: myboxManifestTimeoutMs })).arrayBuffer()).toString("utf8")); }
      catch (error) { manifestError = error.message; }
    }
    const runtimeComponents = Array.isArray(manifest?.components) ? manifest.components.map((entry) => ({ id: entry.id, version: entry.version })) : [];
    const status = manifestError ? "manifest_unreadable" : manifest ? "ready" : structure?.version ? "manifest_missing" : structure?.runtime ? "runtime_version_missing" : structure ? "runtime_folder_missing" : "runtime_root_missing";
    res.json({ configured: true, status, path: `${cloudRuntimeRootName}/runtime/${CLOUD_RUNTIME_VERSION_NAME}`, manifestName: CLOUD_RUNTIME_MANIFEST_NAME, manifestError, runtimeComponents, structure: structure ? { root: structure.root, runtime: structure.runtime, version: structure.version, manifest: structure.manifest } : null });
  } catch (error) { res.status(503).json({ configured: false, status: "unavailable", error: error.message }); }
});
app.patch("/api/settings", async (req, res) => {
  const db = await readDb();
  if (db.maintenance) return res.status(409).json({ error: "Maintenance 작업 중에는 설정을 변경할 수 없습니다." });
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const nestedExternal = body.externalAi && typeof body.externalAi === "object" ? body.externalAi : {};
  const hasMode = body.defaultProcessingMode !== undefined;
  const hasEnabled = body.externalAiEnabled !== undefined || nestedExternal.enabled !== undefined;
  if (!hasMode && !hasEnabled && nestedExternal.modelId === undefined && nestedExternal.consentVersion === undefined) return res.status(400).json({ error: "변경할 설정이 필요합니다." });
  const previousMode = normalizeDefaultProcessingMode(db.settings?.defaultProcessingMode);
  const rawMode = hasMode ? String(body.defaultProcessingMode) : "";
  if (hasMode && rawMode !== "installed-model" && !PROCESSING_DEFAULT_MODES.has(rawMode)) return res.status(400).json({ error: "기본 처리 모드가 올바르지 않습니다." });
  let defaultProcessingMode = hasMode ? normalizeDefaultProcessingMode(rawMode) : previousMode;
  if (hasEnabled) defaultProcessingMode = Boolean(body.externalAiEnabled ?? nestedExternal.enabled) ? "external-ai" : "auto";
  const nextExternal = externalSettings(db.settings);
  if (nestedExternal.modelId !== undefined) nextExternal.modelId = typeof nestedExternal.modelId === "string" && nestedExternal.modelId.trim() ? nestedExternal.modelId.trim() : null;
  if (nestedExternal.consentVersion !== undefined || body.consentVersion !== undefined) nextExternal.consentVersion = Number(nestedExternal.consentVersion ?? body.consentVersion) === 1 ? 1 : null;
  const enabling = previousMode !== "external-ai" && defaultProcessingMode === "external-ai";
  const suppliedConsent = Number(nestedExternal.consentVersion ?? body.consentVersion);
  if (enabling && suppliedConsent !== 1) return res.status(409).json({ error: "external_ai_consent_required", code: "external_ai_consent_required" });
  if (nextExternal.modelId !== externalSettings(db.settings).modelId) nextExternal.lastConnection = { status: "unknown", checkedAt: null, errorCode: null };
  db.settings = { ...(db.settings || {}), defaultProcessingMode, externalAi: nextExternal };
  await writeDb(db);
  res.json({ settings: publicSettings(db), processing: { ...(await processingStatus(db)), externalAi: { ...externalAiStatus(db.settings), failureReason: undefined } } });
});
function externalApiErrorResponse(res, error) {
  const code = safeExternalErrorCode(error);
  const status = ["external_ai_not_configured", "external_ai_model_not_selected"].includes(code) ? 409 : 502;
  return res.status(status).json({ error: code, code });
}
app.get("/api/ai/gemini/models", async (_req, res) => {
  if (!externalApiKey) return externalApiErrorResponse(res, Object.assign(new Error(), { code: "external_ai_not_configured" }));
  try {
    const models = await createExternalProvider()?.listModels();
    const safeModels = (Array.isArray(models) ? models : []).map((model) => ({ id: String(model.id || "").slice(0, 256), displayName: String(model.displayName || model.id || "").slice(0, 256), supportsGenerateContent: true })).filter((model) => model.id);
    res.json({ provider: "gemini", models: safeModels });
  } catch (error) { externalApiErrorResponse(res, error); }
});
app.post("/api/ai/gemini/check", async (req, res) => {
  // Deliberately ignore the request body. Connection checks never accept document content.
  void req.body;
  const db = await readDb();
  const external = externalSettings(db.settings);
  if (!externalApiKey) return externalApiErrorResponse(res, Object.assign(new Error(), { code: "external_ai_not_configured" }));
  if (!external.modelId) return externalApiErrorResponse(res, Object.assign(new Error(), { code: "external_ai_model_not_selected" }));
  const checkedAt = new Date().toISOString();
  try {
    const result = await createExternalProvider(external.modelId).checkConnection();
    external.lastConnection = { status: "ready", checkedAt, errorCode: null };
    db.settings = { ...(db.settings || {}), externalAi: external };
    await writeDb(db);
    res.json({ status: "ready", provider: "gemini", modelId: external.modelId, lastConnection: external.lastConnection });
  } catch (error) {
    const errorCode = safeExternalErrorCode(error);
    external.lastConnection = { status: "failed", checkedAt, errorCode };
    db.settings = { ...(db.settings || {}), externalAi: external };
    await writeDb(db);
    externalApiErrorResponse(res, Object.assign(new Error(), { code: errorCode }));
  }
});
app.get("/api/mybox/backups", async (_req, res) => {
  try {
    const structure = await findMyboxFolderStructure();
    res.json({ backups: structure?.json ? [{ ...structure.json, name: cloudJsonName, type: "file" }] : [] });
  } catch (error) { res.status(503).json({ error: error.message }); }
});
const documentMetrics = (db, doc) => {
  const fallbackPageCount = db.jobs.find((job) => job.documentId === doc.id && Number.isInteger(job.totalUnits))?.totalUnits ?? new Set((doc.units || []).map((unit) => unit.range)).size;
  const searchablePageCount = doc.searchablePageCount ?? new Set((doc.units || []).map((unit) => unit.range)).size;
  const pageCount = doc.pageCount ?? fallbackPageCount;
  const failedPageCount = doc.failedPageCount ?? Math.max(0, pageCount - searchablePageCount);
  return {
    pageCount,
    searchablePageCount,
    indexedUnitCount: doc.indexedUnitCount ?? (doc.units || []).length,
    failedPageCount,
    processingStatus: failedPageCount > 0 ? "partial" : doc.processingStatus,
    visualEvidenceCount: doc.visualEvidenceCount ?? (doc.units || []).filter((unit) => unit.evidenceType === "visual").length,
    ocrPageCount: doc.ocrPageCount ?? (doc.units || []).filter((unit) => unit.ocrText).length,
  };
};
const publicDocument = (db, doc) => { const metrics = documentMetrics(db, doc); return { ...doc, ...metrics, ocrStatus: metrics.ocrPageCount > 0 ? "success" : doc.ocrStatus, visualAnalysisStatus: metrics.visualEvidenceCount > 0 ? "success" : doc.visualAnalysisStatus === "not_supported" ? "unavailable" : doc.visualAnalysisStatus, pages: metrics.pageCount, units: undefined }; };
app.get("/api/jobs", async (_req, res) => { const db = await readDb(); res.json({ jobs: visibleJobs(db.jobs) }); });
app.get("/api/audit", async (_req, res) => { const db = await readDb(); res.json({ entries: db.audit.slice(0, 40) }); });
app.post("/api/search", async (_req, res) => { res.status(410).json({ code: "legacy_search_removed", message: "기존 검색 엔진은 종료되었습니다. /api/v2/search를 사용하세요." }); });
app.post("/api/v2/search", async (req, res) => {
  try {
    const body = req.body || {};
    const db = await readDb();
    const expansion = expandQuery(db, body.query || "");
    const queries = [expansion.normalized, ...(expansion.queries || [])].filter(Boolean);
    const mergedQueryRequest = queries.length > 1 ? { ...body, cursor: null, pageSize: 200 } : body;
    const responses = await Promise.all(queries.map((query) => v2Search.search({ ...mergedQueryRequest, query })));
    const result = responses[0] || await v2Search.search({ ...body, query: expansion.normalized });
    const merged = new Map();
    for (const response of responses) for (const row of response.results || []) {
      const key = row.unitId || row.resultId;
      const existing = merged.get(key);
      if (!existing || Number(row.displayScore || 0) > Number(existing.displayScore || 0)) merged.set(key, row);
    }
    const mergedQueries = queries.length > 1;
    result.results = [...merged.values()].sort((left, right) => Number(right.displayScore || 0) - Number(left.displayScore || 0) || String(left.unitId).localeCompare(String(right.unitId))).map((row, index) => ({ ...row, rank: index + 1 }));
    if (mergedQueries) {
      // A cursor from one synonym query cannot resume the combined result set safely.
      result.hasMore = false;
      result.nextCursor = null;
      if (body.includeContext) result.contextPack = buildContextPack({ query: expansion.normalized, rows: result.results });
    } else {
      result.hasMore = responses.some((response) => response.hasMore);
    }
    const selectedQuery = expansion.normalized;
    res.json({ ...result, query: expansion.normalized, searchQuery: selectedQuery, expansions: expansion.expansions });
  } catch (error) { res.status(500).json({ error: "v2 검색에 실패했습니다.", detail: error.message }); }
});
app.post("/api/v2/feedback", async (req, res) => {
  const body = req.body || {};
  if (!body.sessionId || !body.resultId || !body.unitId || !body.rankingVersion || typeof body.helpful !== "boolean") return res.status(400).json({ error: "sessionId, resultId, unitId, rank, rankingVersion, helpful이 필요합니다." });
  try { v2Store.recordFeedback(body); res.status(201).json({ stored: true }); } catch (error) { res.status(400).json({ error: "피드백을 저장할 수 없습니다.", detail: error.message }); }
});
app.get("/api/v2/status", async (_req, res) => {
  let engines;
  try {
    engines = v2Store ? { ...v2Store.health(), ann: annIndex ? await annIndex.health() : { status: "unavailable" }, semantic: semanticEngine.health(), reranker: { status: rerankerProvider?.available ? "healthy" : "unavailable", model: rerankerProvider?.model || null, reason: rerankerProvider?.reason || null } } : { sqlite: "disabled", fts: "disabled", ann: "disabled", model: "disabled", indexGeneration: null };
  } catch {
    engines = { sqlite: "reindexing", fts: "reindexing", ann: { status: "reindexing" }, model: "reindexing", indexGeneration: null, semantic: { status: "degraded", reason: "reindex_in_progress" }, reranker: { status: "unavailable", model: null, reason: null } };
  }
  res.json({ enabled: v2Enabled, engines, reindex: v2ReindexState, rankingVersion: RANKING_VERSION, dataDirectory: v2DataDir });
});
// Internal migration/recovery only: rebuilds FTS/embedding/ANN projections from existing parsed units,
// not v1.3.0 whole-document reprocessing (original -> parse/OCR/AI/embedding/index).
app.post("/api/v2/search/reindex", async (_req, res) => {
  if (v2ReindexPromise) return res.status(202).json({ ...v2ReindexState, status: "indexing" });
  void startV2Reindex();
  res.status(202).json({ ...v2ReindexState, status: "indexing" });
});
// Backward-compatible restart contract: semantic-model and document-renderer remain restart-required.
// restartRequired: ["semantic-model", "document-renderer"].includes(component.id)
app.get("/api/runtime/components", async (_req, res) => { res.json(await runtimeStatus()); });
class RuntimePackUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "RuntimePackUnavailableError";
    this.code = "runtime_pack_not_configured";
  }
}
async function readMyboxRuntimeManifest() {
  const structure = await findMyboxRuntimeStructure();
  if (!structure?.manifest) throw new RuntimePackUnavailableError("MYBOX wiki/runtime/v1/manifest.json이 없습니다.");
  let manifest;
  try { manifest = JSON.parse(Buffer.from(await (await mybox.downloadFile(structure.manifest.resourceId, { timeoutMs: myboxManifestTimeoutMs })).arrayBuffer()).toString("utf8")); }
  catch (error) { throw new Error(`MYBOX runtime manifest를 읽을 수 없습니다: ${error.message}`); }
  const validation = validateManifest(manifest);
  if (!validation.ok) throw new Error(`MYBOX runtime manifest가 유효하지 않습니다: ${validation.reason}`);
  return { structure, manifest };
}
async function fetchRuntimeSource(url) {
  const parsed = new URL(url);
  if (parsed.protocol === "file:") return new Response(await fs.readFile(fileURLToPath(parsed)), { status: 200, headers: { "content-type": "text/javascript" } });
  return fetch(url);
}
function myboxRuntimeSource({ structure, componentId, version }) {
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "mybox:") return fetch(url);
    const pathParts = parsed.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    const requestedComponent = pathParts.shift() || componentId;
    const requestedVersion = pathParts.shift() || version;
    const filePath = pathParts.join("/");
    const resource = await findRuntimeResource(mybox, structure, requestedComponent, requestedVersion, filePath);
    return mybox.downloadFile(resource.resourceId);
  };
}
async function runtimeInstallOptions(componentId, version) {
  const documentRenderer = componentId === "document-renderer";
  let localManifest = null;
  try { localManifest = JSON.parse(await fs.readFile(path.join(runtimeRoot, "manifest.json"), "utf8")); } catch { /* Use the default or MYBOX manifest below. */ }
  const localEntry = localManifest?.components?.find((entry) => entry.id === componentId && (!version || entry.version === version));
  const bundledLocalEntry = componentId === "semantic-reranker" && localEntry?.files?.some((file) => typeof file.url === "string" && file.url.startsWith("file:"));
  if (bundledLocalEntry) return { manifest: localManifest, version: localEntry.version, sourceType: "bundled", source: "Weki bundled runtime pack", baseUrl: null, fetchImpl: fetchRuntimeSource };
  if (localEntry && !documentRenderer && localManifest.source !== "mybox") return { manifest: localManifest, version: localEntry.version, sourceType: "public", source: localManifest.source || null, baseUrl: process.env.WEKI_RUNTIME_MANIFEST_URL || null, fetchImpl: globalThis.fetch };
  const defaultEntry = DEFAULT_RUNTIME_MANIFEST.components.find((entry) => entry.id === componentId && (!version || entry.version === version));
  if (defaultEntry && !documentRenderer) {
    const bundled = defaultEntry.files?.some((file) => typeof file.url === "string" && file.url.startsWith("file:"));
    return { manifest: DEFAULT_RUNTIME_MANIFEST, version: defaultEntry.version, sourceType: bundled ? "bundled" : "public", source: bundled ? "Weki bundled runtime pack" : DEFAULT_RUNTIME_MANIFEST.source, baseUrl: null, fetchImpl: bundled ? fetchRuntimeSource : globalThis.fetch };
  }
  let myboxUnavailable = null;
  if (!process.env.NAVER_MBOX_TOKEN) myboxUnavailable = new RuntimePackUnavailableError("MYBOX runtime pack이 설정되지 않았습니다.");
  try {
    if (!myboxUnavailable) {
      const loaded = await readMyboxRuntimeManifest();
      const entry = loaded.manifest.components?.find((item) => item.id === componentId && (!version || item.version === version));
      if (entry) return { manifest: loaded.manifest, version: entry.version, sourceType: "mybox", source: loaded.manifest.source || "mybox", baseUrl: `mybox://runtime/${encodeURIComponent(componentId)}/${encodeURIComponent(entry.version)}/`, fetchImpl: myboxRuntimeSource({ structure: loaded.structure, componentId, version: entry.version }) };
      myboxUnavailable = new RuntimePackUnavailableError(`MYBOX runtime component이 설정되지 않았습니다: ${componentId}`);
    }
  } catch (error) {
    if (!(error instanceof RuntimePackUnavailableError)) throw error;
    myboxUnavailable = error;
  }
  if (process.env.WEKI_RUNTIME_MANIFEST_URL && !documentRenderer) {
    const response = await fetch(process.env.WEKI_RUNTIME_MANIFEST_URL);
    if (!response.ok) throw new Error("runtime manifest download failed");
    const manifest = await response.json();
    const entry = manifest.components?.find((item) => item.id === componentId && (!version || item.version === version));
    if (entry) return { manifest, version: entry.version, sourceType: "public", source: process.env.WEKI_RUNTIME_MANIFEST_URL, baseUrl: process.env.WEKI_RUNTIME_MANIFEST_URL, fetchImpl: globalThis.fetch };
  }
  if (myboxUnavailable) throw myboxUnavailable;
  if (documentRenderer) throw new Error("document-renderer는 MYBOX 배포본만 설치할 수 있습니다.");
  throw new Error(`runtime component is not currently distributable: ${componentId}`);
}
function startRuntimeInstallBatch(componentIds) {
  if (runtimeInstallBatchPromise) return runtimeInstallBatchPromise;
  runtimeInstallBatchState = createRuntimeInstallBatchState();
  runtimeInstallBatchState.status = "indexing";
  runtimeInstallBatchState.componentIds = componentIds;
  runtimeInstallBatchState.total = componentIds.length;
  runtimeInstallBatchState.startedAt = new Date().toISOString();
  runtimeInstallBatchPromise = (async () => {
    for (const componentId of componentIds) {
      runtimeInstallBatchState.currentComponent = componentId;
      const runtime = await runtimeStatus();
      const current = runtime.components[componentId];
      if (current?.status === "ready" && !current.updateAvailable) {
        runtimeInstallBatchState.results[componentId] = { status: "already-ready", version: current.version };
        runtimeInstallBatchState.completed += 1;
        continue;
      }
      if (componentId === presentationComponentId) {
        try {
          const presentationManifest = await readPresentationDependencyManifest();
          const offlineBundleAvailable = !process.env.NAVER_MBOX_TOKEN && fsSync.existsSync(offlineLibreOfficeBundlePath);
          const resolvedSource = offlineBundleAvailable ? null : await resolveMyboxPresentationSource(presentationManifest, { required: true });
          const installed = await installPresentationRendererDependency({ source: "auto", resolvedSource });
          runtimeInstallBatchState.results[componentId] = { status: "installed", version: installed.manifest.version };
          runtimeInstallBatchState.installed.push(componentId);
        } catch (error) {
          const offlineBundleAvailable = !process.env.NAVER_MBOX_TOKEN && fsSync.existsSync(offlineLibreOfficeBundlePath);
          if (error?.code === "runtime_pack_not_configured") {
            runtimeInstallBatchState.results[componentId] = { status: "unavailable", reason: "runtime_pack_not_configured", error: error.message };
            runtimeInstallBatchState.unavailable.push(componentId);
            runtimeInstallBatchState.unavailableDetails.push({ id: componentId, error: error.message });
            runtimeInstallBatchState.completed += 1;
            continue;
          }
          await persistComponentFailure({ rootDirectory: runtimeRoot, componentId, version: DEFAULT_PRESENTATION_DEPENDENCY_MANIFEST.version, error, sourceType: offlineBundleAvailable ? "bundled" : "mybox", source: offlineBundleAvailable ? "Weki bundled dependency" : "mybox", requiresMybox: !offlineBundleAvailable });
          runtimeInstallBatchState.results[componentId] = { status: "failed", error: error.message };
          runtimeInstallBatchState.failed.push({ id: componentId, error: error.message });
        }
        runtimeInstallBatchState.completed += 1;
        continue;
      }
      let options;
      try {
        options = await runtimeInstallOptions(componentId, current?.availableVersion || null);
      } catch (error) {
        if (!(error instanceof RuntimePackUnavailableError)) {
          await persistComponentFailure({ rootDirectory: runtimeRoot, componentId, version: current?.availableVersion || current?.version || null, error, sourceType: current?.sourceType || null, source: current?.source || null, requiresMybox: current?.requiresMybox ?? false });
          runtimeInstallBatchState.results[componentId] = { status: "failed", error: error.message };
          runtimeInstallBatchState.failed.push({ id: componentId, error: error.message });
          runtimeInstallBatchState.completed += 1;
          continue;
        }
        runtimeInstallBatchState.results[componentId] = { status: "unavailable", reason: "runtime_pack_not_configured" };
        runtimeInstallBatchState.unavailable.push(componentId);
        runtimeInstallBatchState.completed += 1;
        continue;
      }
      try {
        await installComponent({ rootDirectory: runtimeRoot, manifest: options.manifest, componentId, version: options.version, publicKey: process.env.WEKI_RUNTIME_PUBLIC_KEY || RUNTIME_PUBLIC_KEY, baseUrl: options.baseUrl, fetchImpl: options.fetchImpl, sourceType: options.sourceType, source: options.source });
      } catch (error) {
        runtimeInstallBatchState.results[componentId] = { status: "failed", error: error.message };
        runtimeInstallBatchState.failed.push({ id: componentId, error: error.message });
        runtimeInstallBatchState.completed += 1;
        continue;
      }
      runtimeInstallBatchState.results[componentId] = { status: "installed", version: options.version };
      runtimeInstallBatchState.installed.push(componentId);
      runtimeInstallBatchState.completed += 1;
    }
    runtimeInstallBatchState.status = runtimeInstallBatchState.failed.length
      ? "failed"
      : runtimeInstallBatchState.unavailable.length
        ? "partial"
        : "ready";
    runtimeInstallBatchState.currentComponent = null;
    runtimeInstallBatchState.finishedAt = new Date().toISOString();
  })().catch((error) => {
    runtimeInstallBatchState.status = "failed";
    runtimeInstallBatchState.currentComponent = null;
    runtimeInstallBatchState.finishedAt = new Date().toISOString();
    runtimeInstallBatchState.error = error.message;
  }).finally(() => { runtimeInstallBatchPromise = null; });
  return runtimeInstallBatchPromise;
}
app.post("/api/runtime/components/install", async (req, res) => {
  const body = req.body || {};
  try {
    const requestedComponentId = String(body.componentId || "");
    if (requestedComponentId === "document-renderer" && body.source !== "mybox") throw new Error("document-renderer는 명시적인 MYBOX 배포본만 설치할 수 있습니다.");
    if (requestedComponentId === presentationComponentId) {
      const requestedSource = body.source === "mybox" ? "mybox" : body.source === "public" ? "public" : "auto";
      const installed = await installPresentationRendererDependency({ source: requestedSource });
      return res.status(201).json({ component: { id: presentationComponentId, status: "ready", version: installed.manifest.version, path: installed.destination, sourceType: installed.sourceType, source: installed.source }, restartRequired: true, runtime: await runtimeStatus() });
    }
    let manifest = body.manifest;
    const manifestUrl = body.manifestUrl ? String(body.manifestUrl) : null;
    let fetchImpl = globalThis.fetch;
    let baseUrl = manifestUrl;
    let sourceType = null;
    let source = null;
    if (body.source === "mybox") {
      const loaded = await readMyboxRuntimeManifest();
      manifest = loaded.manifest;
      const selected = manifest.components?.find((entry) => entry.id === String(body.componentId || ""));
      if (!selected) throw new Error(`MYBOX runtime component not found: ${body.componentId}`);
      const version = String(body.version || selected.version);
      if (version !== selected.version) throw new Error(`MYBOX runtime component version not found: ${body.componentId}@${version}`);
      // Keep the signed manifest bytes unchanged. The MYBOX transport is a
      // URL base supplied to the downloader rather than a mutation of each
      // signed file entry.
      fetchImpl = myboxRuntimeSource({ structure: loaded.structure, componentId: selected.id, version: selected.version });
      baseUrl = `mybox://runtime/${encodeURIComponent(selected.id)}/${encodeURIComponent(selected.version)}/`;
      sourceType = "mybox";
      source = manifest.source || "mybox";
    } else if (!manifest && manifestUrl) { const response = await fetch(manifestUrl); if (!response.ok) throw new Error("runtime manifest download failed"); manifest = await response.json(); }
    if (!manifest && !manifestUrl && !body.source) {
      const defaults = await runtimeInstallOptions(requestedComponentId, body.version ? String(body.version) : null);
      manifest = defaults.manifest;
      fetchImpl = defaults.fetchImpl;
      baseUrl = defaults.baseUrl;
      sourceType = defaults.sourceType;
      source = defaults.source;
    }
    if (body.source === "public" && manifest?.source === "mybox") throw new Error("명시한 public 출처와 manifest의 MYBOX 출처가 일치하지 않습니다.");
    const componentId = requestedComponentId;
    if (!manifest) return res.status(400).json({ error: "manifest가 필요합니다." });
    const selectedVersion = String(body.version || manifest.components?.find((entry) => entry.id === componentId)?.version || "");
    const resolvedSourceType = sourceType || (body.source === "mybox" || manifest.source === "mybox" ? "mybox" : "public");
    const resolvedSource = source || manifest.source || manifestUrl || null;
    const component = await installComponent({ rootDirectory: runtimeRoot, manifest, componentId, version: selectedVersion, publicKey: process.env.WEKI_RUNTIME_PUBLIC_KEY || RUNTIME_PUBLIC_KEY, baseUrl, fetchImpl, sourceType: resolvedSourceType, source: resolvedSource });
    res.status(201).json({ component, restartRequired: ["semantic-model", "semantic-reranker", "document-renderer", presentationComponentId].includes(component.id), runtime: await runtimeStatus() });
  } catch (error) { res.status(400).json({ error: error.message, runtime: await runtimeStatus() }); }
});
app.post("/api/runtime/components/install-all", async (req, res) => {
  const requested = Array.isArray(req.body?.componentIds) ? req.body.componentIds.map((id) => String(id)) : optionalRuntimeComponents;
  const requestedIds = new Set(requested);
  const componentIds = optionalRuntimeComponents.filter((id) => requestedIds.has(id));
  if (!componentIds.length) return res.status(400).json({ error: "설치할 구성요소가 없습니다." });
  if (runtimeInstallBatchPromise) return res.status(202).json({ ...runtimeInstallBatchState, runtime: await runtimeStatus() });
  void startRuntimeInstallBatch(componentIds);
  res.status(202).json({ ...runtimeInstallBatchState, runtime: await runtimeStatus() });
});
app.post("/api/runtime/components/:id/retry", async (req, res) => {
  const body = req.body || {};
  try {
    if (body.source === "public" && body.manifest?.source === "mybox") throw new Error("명시한 public 출처와 manifest의 MYBOX 출처가 일치하지 않습니다.");
    if (req.params.id === "document-renderer" && body.source !== "mybox") throw new Error("document-renderer 재시도에는 명시적인 MYBOX 배포본이 필요합니다.");
    if (req.params.id === presentationComponentId) {
      const requestedSource = body.source === "mybox" ? "mybox" : body.source === "public" ? "public" : "auto";
      const installed = await installPresentationRendererDependency({ source: requestedSource });
      return res.status(201).json({ component: { id: presentationComponentId, status: "ready", version: installed.manifest.version, path: installed.destination, sourceType: installed.sourceType, source: installed.source }, restartRequired: true, runtime: await runtimeStatus() });
    }
    let manifest = body.manifest;
    let fetchImpl = globalThis.fetch;
    let baseUrl = null;
    const sourceType = body.source === "mybox" || manifest?.source === "mybox" ? "mybox" : "public";
    let source = manifest?.source || null;
    let version = body.version ? String(body.version) : null;
    if (sourceType !== "mybox" && (!manifest || !version)) return res.status(400).json({ error: "재시도에는 manifest와 version이 필요합니다." });
    if (sourceType === "mybox") {
      const loaded = await readMyboxRuntimeManifest();
      manifest = loaded.manifest;
      const selected = manifest.components?.find((entry) => entry.id === req.params.id);
      if (!selected) throw new Error(`MYBOX runtime component not found: ${req.params.id}`);
      version = version || selected.version;
      if (version !== selected.version) throw new Error(`MYBOX runtime component version not found: ${req.params.id}@${version}`);
      fetchImpl = myboxRuntimeSource({ structure: loaded.structure, componentId: selected.id, version: selected.version });
      baseUrl = `mybox://runtime/${encodeURIComponent(selected.id)}/${encodeURIComponent(selected.version)}/`;
      source = manifest.source || "mybox";
    }
    if (req.params.id === "document-renderer" && sourceType !== "mybox") throw new Error("document-renderer는 MYBOX 배포본만 설치할 수 있습니다.");
    const component = await retryComponent({ rootDirectory: runtimeRoot, manifest, componentId: req.params.id, version, publicKey: process.env.WEKI_RUNTIME_PUBLIC_KEY || RUNTIME_PUBLIC_KEY, baseUrl, fetchImpl, sourceType, source });
    res.status(201).json({ component, restartRequired: ["semantic-model", "semantic-reranker", "document-renderer", presentationComponentId].includes(component.id), runtime: await runtimeStatus() });
  } catch (error) { res.status(400).json({ error: error.message, runtime: await runtimeStatus() }); }
});
app.get("/api/synonyms", async (_req, res) => { const db = await readDb(); res.json({ entries: db.synonyms }); });
app.get("/api/synonyms/suggestions", async (_req, res) => { const db = await readDb(); res.json({ suggestions: suggestSynonymCandidates({ feedback: db.feedback, documents: db.documents, existing: db.synonyms }) }); });
app.post("/api/synonyms/suggestions", async (req, res) => {
  const validation = validateSynonymInput({ term: req.body?.term, aliases: req.body?.aliases || [] });
  if (!validation.valid) return res.status(400).json({ error: validation.errors.join(" "), errors: validation.errors });
  const db = await readDb(); if (db.maintenance) return res.status(409).json({ error: "Maintenance 작업 중에는 동의어를 변경할 수 없습니다." });
  const now = new Date().toISOString(); const entry = normalizeSynonymEntry({ term: validation.term, aliases: validation.aliases, status: "draft", source: "suggested" }, { id: crypto.randomUUID() }); entry.createdAt = now; entry.updatedAt = now; db.synonyms.unshift(entry); await writeDb(db); res.status(201).json({ entry });
});
app.post("/api/synonyms", async (req, res) => {
  const validation = validateSynonymInput({ term: req.body?.term, aliases: req.body?.aliases || [] });
  if (!validation.valid) return res.status(400).json({ error: validation.errors.join(" "), errors: validation.errors });
  const db = await readDb(); if (db.maintenance) return res.status(409).json({ error: "Maintenance 작업 중에는 동의어를 변경할 수 없습니다." });
  if (db.synonyms.some((item) => item.term === validation.term && (item.status || (item.approved ? "approved" : "draft")) === "approved")) return res.status(409).json({ error: "같은 기준어의 동의어가 이미 등록되어 있습니다." });
  const now = new Date().toISOString(); const entry = normalizeSynonymEntry({ term: validation.term, aliases: validation.aliases, status: "approved", source: "manual" }, { id: crypto.randomUUID() }); entry.createdAt = now; entry.updatedAt = now;
  db.synonyms.unshift(entry); db.audit.unshift({ id: crypto.randomUUID(), type: "synonym", detail: `${entry.term} synonym added`, createdAt: now }); await writeDb(db); res.status(201).json({ entry });
});
app.put("/api/synonyms/:id", async (req, res) => {
  const validation = validateSynonymInput({ term: req.body?.term, aliases: req.body?.aliases || [] });
  if (!validation.valid) return res.status(400).json({ error: validation.errors.join(" "), errors: validation.errors });
  const db = await readDb(); if (db.maintenance) return res.status(409).json({ error: "Maintenance 작업 중에는 동의어를 변경할 수 없습니다." });
  const entry = db.synonyms.find((item) => item.id === req.params.id); if (!entry) return res.status(404).json({ error: "동의어 항목을 찾을 수 없습니다." });
  if (db.synonyms.some((item) => item.id !== entry.id && item.term === validation.term && (item.status || (item.approved ? "approved" : "draft")) === "approved")) return res.status(409).json({ error: "같은 기준어의 동의어가 이미 등록되어 있습니다." });
  entry.term = validation.term; entry.aliases = validation.aliases; entry.updatedAt = new Date().toISOString(); db.audit.unshift({ id: crypto.randomUUID(), type: "synonym", detail: `${entry.term} synonym updated`, createdAt: entry.updatedAt }); await writeDb(db); res.json({ entry });
});
app.post("/api/synonyms/:id/decision", async (req, res) => {
  const status = req.body?.status; if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: "approved 또는 rejected 상태가 필요합니다." });
  const db = await readDb(); if (db.maintenance) return res.status(409).json({ error: "Maintenance 작업 중에는 동의어를 변경할 수 없습니다." }); const entry = db.synonyms.find((item) => item.id === req.params.id); if (!entry) return res.status(404).json({ error: "동의어 항목을 찾을 수 없습니다." });
  entry.status = status; entry.approved = status === "approved"; entry.updatedAt = new Date().toISOString(); db.audit.unshift({ id: crypto.randomUUID(), type: "synonym", detail: `${entry.term} synonym ${status}`, createdAt: entry.updatedAt }); await writeDb(db); res.json({ entry });
});
app.delete("/api/synonyms/:id", async (req, res) => {
  const db = await readDb(); if (db.maintenance) return res.status(409).json({ error: "Maintenance 작업 중에는 동의어를 변경할 수 없습니다." }); const before = db.synonyms.length;
  db.synonyms = db.synonyms.filter((entry) => entry.id !== req.params.id);
  if (before === db.synonyms.length) return res.status(404).json({ error: "동의어 항목을 찾을 수 없습니다." });
  db.audit.unshift({ id: crypto.randomUUID(), type: "synonym", detail: "synonym removed", createdAt: new Date().toISOString() });
  await writeDb(db); res.status(204).end();
});
app.post("/api/feedback", async (req, res) => { const db = await readDb(); if (db.maintenance) return res.status(409).json({ error: "Maintenance 작업 중에는 피드백을 기록할 수 없습니다." }); const feedback = { id: crypto.randomUUID(), query: String(req.body?.query || ""), documentId: req.body?.documentId || null, helpful: Boolean(req.body?.helpful), createdAt: new Date().toISOString() }; db.feedback.unshift(feedback); await writeDb(db); res.status(201).json({ feedback }); });
app.post("/api/mybox/upload", async (_req, res) => {
  const current = await readDb(); if (activeJobs(current).length || current.maintenance) return res.status(409).json({ error: "Processing Queue가 비어 있고 Maintenance 작업이 없어야 합니다." });
  current.maintenance = { type: "mybox-upload", startedAt: new Date().toISOString() }; await writeDb(current);
  try {
    const structure = await findMyboxFolderStructure({ create: true }); let mergedDb = { ...current, maintenance: null }; let conflicts = 0; let remoteSnapshot = null;
    if (structure.json) { remoteSnapshot = await readFolderSnapshot(structure); const merge = await mergeCloudCatalog(mergedDb, remoteSnapshot, { resolveLocalPath: (doc) => resolveDocumentOriginalPath(dataDir, doc), readFile: fs.readFile }); mergedDb = merge.database; conflicts = merge.conflicts; }
    const now = new Date().toISOString(); mergedDb.audit ??= []; mergedDb.audit.unshift({ id: crypto.randomUUID(), type: "mybox-upload", detail: `MYBOX 백업 업로드 · 원본 파일 포함 · knowledge-base.json 갱신 · ${conflicts}개 문서 병합`, createdAt: now });
    const snapshot = reconcileFolderSnapshotOriginals(await createFolderSnapshot(mergedDb, { now: () => now, resolveOriginalPath: (doc) => resolveDocumentOriginalPath(dataDir, doc), remoteManifest: remoteSnapshot?.manifest.files || [] }), { remoteManifest: remoteSnapshot?.manifest.files || [] });
    await verifyRemoteSnapshotOriginals(structure, snapshot);
    const hashFolders = new Map();
    for (const original of snapshot.originals.filter((item) => !item.skipUpload)) {
      const hashFolder = await ensureMyboxHashFolder(structure.data.resourceId, original.hash, hashFolders);
      await mybox.uploadFile(original.data, original.fileName, hashFolder.resourceId, { isOverwrite: false });
    }
    const uploaded = await mybox.uploadFile(Buffer.from(JSON.stringify(snapshot.json), "utf8"), cloudJsonName, structure.weki.resourceId, { isOverwrite: true });
    await writeDbAtomic(mergedDb); res.status(201).json({ fileName: cloudJsonName, resourceId: uploaded.resourceId || structure.json?.resourceId || null, documents: mergedDb.documents.length, conflicts });
  } catch (error) { current.maintenance = null; await writeDb(current); res.status(502).json({ error: error.message }); }
});
async function handleMyboxCatalogSync(_req, res) {
  try {
    const result = await runMyboxCatalogSync();
    res.json(result);
  } catch (error) {
    const status = /Queue|Maintenance|토큰/.test(error.message) ? 409 : 422;
    res.status(status).json({ error: error.message, sync: { ...myboxSyncState } });
  }
}
app.post("/api/mybox/sync", handleMyboxCatalogSync);
app.post("/api/mybox/download", handleMyboxCatalogSync);
app.get("/api/storage", async (_req, res) => { const storage = await readStorageStats(); res.json({ path: dataDir, storage }); });
app.post("/api/storage/migrate", async (req, res) => {
  const targetPath = String(req.body?.targetPath || "").trim(); if (!targetPath || !path.isAbsolute(targetPath)) return res.status(400).json({ error: "영구 저장소의 절대 경로가 필요합니다." });
  const db = await readDb(); if (activeJobs(db).length || db.maintenance) return res.status(409).json({ error: "Processing Queue가 비어 있고 Maintenance 작업이 없어야 합니다." });
  const currentPath = path.resolve(dataDir); const resolvedTarget = path.resolve(targetPath); if (currentPath.toLowerCase() === resolvedTarget.toLowerCase()) return res.json({ path: dataDir, restartRequired: false });
  if (resolvedTarget.toLowerCase().startsWith(`${currentPath.toLowerCase()}${path.sep}`) || currentPath.toLowerCase().startsWith(`${resolvedTarget.toLowerCase()}${path.sep}`)) return res.status(400).json({ error: "현재 저장소 내부 또는 상위 경로로 이전할 수 없습니다." });
  const staging = `${resolvedTarget}.weki-migration-${crypto.randomUUID()}`;
  try {
    let targetStat;
    try { targetStat = await fs.stat(resolvedTarget); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (targetStat && !targetStat.isDirectory()) throw new Error("선택한 저장소 경로가 폴더가 아닙니다.");
    if (targetStat && (await fs.readdir(resolvedTarget)).length > 0) throw new Error("선택한 저장소 폴더는 비어 있어야 합니다.");
    if (targetStat) await fs.rename(resolvedTarget, staging);
    await copyStoreContents(staging);
    await fs.writeFile(path.join(staging, ".weki-storage-root"), "weki-storage-root-v1\n");
    await fs.writeFile(path.join(staging, "storage-location.json"), JSON.stringify({ format: "weki-storage-location", version: 1, dataDir: resolvedTarget }, null, 2));
    await fs.rename(staging, resolvedTarget);
    if (!updateWindowsStoragePointer(resolvedTarget, currentPath)) throw new Error("새 저장소 위치를 시스템 설정에 기록하지 못했습니다.");
    v2Store?.close();
    const sourceRemoved = await removeManagedStore(currentPath);
    const sourceCleanupPending = !sourceRemoved && process.platform === "win32" && process.env.WEKI_DESKTOP === "1";
    res.json({ path: resolvedTarget, restartRequired: true, sourceRemoved, sourceCleanupPending });
  }
  catch (error) { await fs.rm(staging, { recursive: true, force: true }).catch(() => {}); res.status(422).json({ error: `저장소 이전에 실패했습니다: ${error.message}` }); }
});
app.post("/api/documents", upload.array("files"), async (req, res) => {
  const db = await readDb();
  const runtime = await runtimeStatus();
  const external = externalAiStatus(db.settings);
  const defaultResolution = resolveProcessingDefault(db.settings, runtime.components, external);
  const hasExplicitMode = typeof req.body?.mode === "string" && req.body.mode.trim();
  const requestedMode = hasExplicitMode
    ? (PROCESSING_DEFAULT_MODES.has(req.body.mode.trim()) ? req.body.mode.trim() : "lightweight")
    : normalizeDefaultProcessingMode(db.settings?.defaultProcessingMode);
  const modeResolution = resolveRequestedProcessingMode(requestedMode, {
    localAiAvailable: requestedMode === "auto" ? defaultResolution.localAiEligible : defaultResolution.localAiAvailable,
    externalAiAvailable: external.ready,
    externalProvider: external.provider,
    externalModelId: external.modelId,
    externalFailureReason: external.failureReason,
  });
  const processingPolicy = { requestedMode: modeResolution.requestedMode, effectiveMode: modeResolution.effectiveMode, provider: modeResolution.provider, modelId: modeResolution.modelId, fallbackReason: modeResolution.fallbackReason };
  const consentVersion = Number(req.body?.consentVersion ?? (typeof req.body?.externalAi === "object" ? req.body.externalAi?.consentVersion : null));
  if (hasExplicitMode && requestedMode === "external-ai" && consentVersion !== 1) return res.status(409).json({ error: "external_ai_consent_required", code: "external_ai_consent_required" });
  if (hasExplicitMode && requestedMode === "external-ai" && !external.enabled) return res.status(409).json({ error: "external_ai_disabled", code: "external_ai_disabled" });
  if (db.maintenance) return res.status(409).json({ error: "Maintenance 작업 중에는 문서 등록을 시작할 수 없습니다." }); const results = [];
  for (const file of req.files || []) {
    const fileName = normalizeFilename(file.originalname); const ext = path.extname(fileName).slice(1).toLowerCase();
    if (!allowed.has(ext)) { results.push({ name: fileName, status: "failed", error: "지원 형식은 PDF, PPTX, HWP, HWPX, DOCX입니다." }); continue; }
    const hash = crypto.createHash("sha256").update(file.buffer).digest("hex");
    const existing = db.documents.find((doc) => doc.hash === hash);
    if (existing && ["available", "local_available"].includes(existing.sourceStatus)) {
      const job = { id: crypto.randomUUID(), kind: "registration", name: fileName, mode: requestedMode, requestedProcessingMode: modeResolution.requestedMode, effectiveMode: modeResolution.effectiveMode, processingModeFallback: modeResolution.fallbackReason, processingPolicy, status: "skipped", progress: 100, detail: "동일 Hash 문서가 이미 등록되어 있습니다.", createdAt: new Date().toISOString(), completedAt: new Date().toISOString() };
      db.jobs.unshift(job); results.push({ name: fileName, status: "skipped", jobId: job.id, documentId: existing.id, message: job.detail }); continue;
    }
    if (existing && ["missing", "unavailable", "cloud_available"].includes(existing.sourceStatus)) {
      const now = new Date().toISOString(); const originalName = originalNameOf(existing, normalizeOriginalName(fileName, `${hash}.${ext}`)); const originalKey = documentOriginalKey({ ...existing, originalName }) || `${hash}/${originalName}`; const originalPath = resolveDocumentOriginalPath(dataDir, { ...existing, originalKey });
      await writeOriginalAtomically(originalPath, file.buffer); existing.originalName ??= originalName; existing.sourceStatus = "local_available"; existing.originalKey = originalKey; delete existing.originalPath; await syncDocumentToV2(existing);
      const job = { id: crypto.randomUUID(), kind: "source-relink", name: fileName, mode: requestedMode, requestedProcessingMode: modeResolution.requestedMode, effectiveMode: modeResolution.effectiveMode, processingModeFallback: modeResolution.fallbackReason, processingPolicy, status: "completed", progress: 100, detail: modeResolution.fallbackReason === "semantic_model_unavailable" ? "Local AI 모델이 준비되지 않아 경량 처리로 전환했습니다. 기존 Document 원본을 자동 재연결했습니다." : "기존 Document 원본을 자동 재연결했습니다.", documentId: existing.id, createdAt: now, completedAt: now };
      db.jobs.unshift(job); results.push({ name: fileName, status: "relinked", jobId: job.id, documentId: existing.id, pages: existing.units.length }); continue;
    }
    const now = new Date().toISOString(); const job = { id: crypto.randomUUID(), kind: "registration", name: fileName, mode: requestedMode, requestedProcessingMode: modeResolution.requestedMode, effectiveMode: modeResolution.effectiveMode, processingModeFallback: modeResolution.fallbackReason, processingPolicy, status: "queued", progress: 0, detail: modeResolution.fallbackReason === "semantic_model_unavailable" ? "Local AI 모델이 준비되지 않아 경량 처리로 전환했습니다. 대기열에 추가되었습니다." : "대기열에 추가되었습니다.", hash, ext, size: file.size, modifiedAt: new Date(file.lastModified || Date.now()).toISOString(), createdAt: now };
    job.stagedPath = path.join(incomingDir, `${job.id}.${ext}`); await fs.writeFile(job.stagedPath, file.buffer); db.jobs.unshift(job); results.push({ name: fileName, status: "queued", jobId: job.id, message: job.detail });
  }
  const responseFallbackReason = !hasExplicitMode && requestedMode === "local-ai" ? null : modeResolution.fallbackReason;
  await writeDb(db); void runQueue(); res.status(202).json({ results, processing: { requestedMode: hasExplicitMode ? modeResolution.requestedMode : modeResolution.effectiveMode, requestedProcessingMode: modeResolution.requestedMode, effectiveMode: modeResolution.effectiveMode, fallbackReason: responseFallbackReason, provider: modeResolution.provider, modelId: modeResolution.modelId } });
});
app.post("/api/documents/:id/reprocess", async (req, res) => {
  const db = await readDb(); const doc = db.documents.find((item) => item.id === req.params.id);
  if (!doc) return res.status(404).json({ error: "문서를 찾을 수 없습니다." });
  if (db.maintenance) return res.status(409).json({ error: "Maintenance 작업 중에는 재처리를 시작할 수 없습니다." });
  const requestedMode = normalizeDefaultProcessingMode(req.body?.mode || db.settings?.defaultProcessingMode || "lightweight");
  const external = externalAiStatus(db.settings);
  if (requestedMode === "external-ai" && !external.enabled) return res.status(409).json({ error: "external_ai_disabled", code: "external_ai_disabled" });
  let originalPath;
  try { originalPath = await ensureDocumentOriginal(doc); } catch (error) { return res.status(409).json({ error: error.message || "원본이 누락된 문서는 동일 Hash 원본을 다시 등록한 뒤 재처리할 수 있습니다." }); }
  const runtime = await runtimeStatus(); const modeResolution = resolveRequestedProcessingMode(requestedMode, { localAiAvailable: runtime.components["semantic-model"]?.applied === true, externalAiAvailable: external.ready, externalProvider: external.provider, externalModelId: external.modelId, externalFailureReason: external.failureReason }); const processingPolicy = { requestedMode: modeResolution.requestedMode, effectiveMode: modeResolution.effectiveMode, provider: modeResolution.provider, modelId: modeResolution.modelId, fallbackReason: modeResolution.fallbackReason }; const job = { id: crypto.randomUUID(), kind: "reprocess", name: doc.name, mode: requestedMode, requestedProcessingMode: modeResolution.requestedMode, effectiveMode: modeResolution.effectiveMode, processingModeFallback: modeResolution.fallbackReason, processingPolicy, status: "queued", progress: 0, detail: "대기열에 추가되었습니다. 기존 검색 결과는 유지됩니다.", documentId: doc.id, createdAt: new Date().toISOString() };
  db.jobs.unshift(job); await writeDb(db); void runQueue(); res.status(202).json({ job, document: { ...doc, units: undefined } });
});
app.post("/api/jobs/:id/action", async (req, res) => {
  const action = req.body?.action; if (!["pause", "resume", "start", "cancel", "retry", "dismiss"].includes(action)) return res.status(400).json({ error: "지원하지 않는 작업 명령입니다." });
  const db = await readDb(); const job = db.jobs.find((item) => item.id === req.params.id); if (!job) return res.status(404).json({ error: "작업을 찾을 수 없습니다." });
  if (action === "retry" && job.status === "failed") { if (!job.stagedPath || !fsSync.existsSync(job.stagedPath)) return res.status(409).json({ error: "재시도할 임시 원본이 없습니다. 파일을 다시 등록해 주세요." }); job.status = "queued"; job.progress = 0; job.detail = "실패한 작업을 다시 대기열에 추가했습니다."; delete job.failedAt; }
  else if (action === "dismiss" && job.status === "failed") { await fs.unlink(job.stagedPath || "").catch(() => {}); db.jobs = db.jobs.filter((item) => item.id !== job.id); db.audit.unshift({ id: crypto.randomUUID(), type: "job-dismissed", detail: `${job.name} 실패 작업 제거`, createdAt: new Date().toISOString() }); }
  else if (action === "pause" && ["queued", "processing"].includes(job.status)) { const wasProcessing = job.status === "processing"; job.status = "paused"; job.detail = wasProcessing ? "현재 페이지·슬라이드가 끝나면 일시중지합니다." : "사용자가 일시중지했습니다."; }
  else if (action === "resume" && job.status === "paused") { job.status = "queued"; job.detail = "대기열에 다시 추가되었습니다."; }
  else if (action === "start" && job.status === "queued") { job.priority = Math.max(1, ...db.jobs.map((item) => item.priority || 0)) + 1; job.detail = "대기열 맨 앞 실행을 요청했습니다."; }
  else if (action === "cancel" && ["queued", "paused", "processing"].includes(job.status)) { job.status = "cancelled"; job.detail = "취소 요청을 받았습니다. 현재 페이지·슬라이드가 끝나면 정리합니다. 기존 색인은 유지됩니다."; job.completedAt = new Date().toISOString(); }
  else return res.status(409).json({ error: "현재 상태에서는 이 명령을 실행할 수 없습니다." });
  await writeDb(db);
  if (["pause", "cancel"].includes(action)) await flushCheckpoint(job.id).catch(() => {});
  if (["resume", "start", "retry"].includes(action)) void runQueue();
  res.json({ job: action === "dismiss" ? null : job });
});
app.get("/api/documents/:id/original", async (req, res) => {
  const db = await readDb(); const doc = db.documents.find((item) => item.id === req.params.id);
  if (!doc) return res.status(404).json({ error: "문서를 찾을 수 없습니다." });
  try { const originalPath = await ensureDocumentOriginal(doc); res.download(originalPath, doc.name); } catch (error) { res.status(404).json({ error: error.message || "원본을 사용할 수 없습니다." }); }
});
app.get("/api/documents/:id/visual/:name", async (req, res) => {
  const db = await readDb(); const doc = db.documents.find((item) => item.id === req.params.id); const name = path.basename(req.params.name);
  if (!doc || !doc.units.some((unit) => unit.visualAssetName === name)) return res.status(404).end();
  try {
    const originalPath = await ensureDocumentOriginal(doc); const buffer = await fs.readFile(originalPath);
    if (/^page-\d+\.svg$/i.test(name) && documentRenderer && ["HWP", "HWPX"].includes(doc.format)) {
      const pageNumber = Number(name.match(/\d+/)[0]); const page = (await documentRenderer.extract(buffer))[pageNumber - 1]; if (!page?.renderedSvg) return res.status(404).end(); return res.type("image/svg+xml").send(page.renderedSvg);
    }
    if (/^page-\d+\.png$/i.test(name) && doc.format === "PDF") {
      const pageNumber = Number(name.match(/\d+/)[0]); return res.type("image/png").send(await renderPdfPagePng(buffer, pageNumber));
    }
    const zip = await JSZip.loadAsync(buffer); const prefixes = doc.format === "PPTX" ? ["ppt/media/"] : doc.format === "DOCX" ? ["word/media/"] : ["bindata/", "contents/"]; const assetPath = Object.keys(zip.files).find((item) => prefixes.some((prefix) => item.toLowerCase().startsWith(prefix)) && path.basename(item) === name); const asset = assetPath ? zip.file(assetPath) : null; if (!asset) return res.status(404).end(); const mime = name.match(/\.png$/i) ? "image/png" : name.match(/\.webp$/i) ? "image/webp" : name.match(/\.svg$/i) ? "image/svg+xml" : "image/jpeg"; res.type(mime).send(await asset.async("nodebuffer"));
  } catch { res.status(422).end(); }
});
app.delete("/api/data", async (req, res) => {
  try { await waitForQueueIdle(); } catch (error) { return res.status(409).json({ error: error.message || "Processing Queue가 비어 있고 Maintenance 작업이 없어야 합니다." }); }
  const db = await readDb(); if (activeJobs(db).length || db.maintenance) return res.status(409).json({ error: "Processing Queue가 비어 있고 Maintenance 작업이 없어야 합니다." });
  if (req.get("x-weki-confirmation") !== "DELETE ALL DOCUMENTS") return res.status(400).json({ error: "확인 문구가 일치하지 않습니다." });
  db.maintenance = { type: "delete-all", startedAt: new Date().toISOString() }; await writeDb(db);
  try { await fs.rm(originalsDir, { recursive: true, force: true }); await fs.rm(incomingDir, { recursive: true, force: true }); await fs.mkdir(originalsDir, { recursive: true }); await fs.mkdir(incomingDir, { recursive: true }); for (const document of db.documents) v2Store?.deleteDocument(document.id); await annIndex?.close(); await fs.rm(path.join(v2DataDir, "ann"), { recursive: true, force: true }); const cleared = { documents: [], jobs: [], synonyms: db.synonyms, feedback: db.feedback, audit: [{ id: crypto.randomUUID(), type: "delete-all", detail: "all document data deleted", createdAt: new Date().toISOString() }], maintenance: null }; await writeDb(cleared); res.status(204).end(); } catch (error) { db.maintenance = null; await writeDb(db); res.status(500).json({ error: "전체 데이터 삭제에 실패했습니다.", detail: error.message }); }
});
app.delete("/api/documents/:id", async (req, res) => {
  const db = await readDb(); if (db.maintenance) return res.status(409).json({ error: "Maintenance 작업 중에는 문서를 삭제할 수 없습니다." }); const doc = db.documents.find((item) => item.id === req.params.id);
  if (!doc) return res.status(404).json({ error: "문서를 찾을 수 없습니다." });
  if (activeJobs(db).some((job) => job.documentId === doc.id)) return res.status(409).json({ error: "이 문서는 처리 작업이 끝난 뒤 삭제할 수 있습니다." });
  const result = removeDocumentData(db, doc.id); const remainingHashReferences = result.database.documents.some((item) => item.hash && item.hash === doc.hash); await writeDb(result.database); v2Store?.deleteDocument(doc.id); scheduleAnnRebuild();
  const originalPath = resolveDocumentOriginalPath(dataDir, doc); if (originalPath && !remainingHashReferences) { await fs.unlink(originalPath).catch(() => {}); await fs.rmdir(path.dirname(originalPath)).catch(() => {}); } res.status(204).end();
});

const useViteMiddleware = process.env.WEKI_DEV_SERVER === "1" || process.env.WEKI_DESKTOP !== "1";
if (useViteMiddleware) {
  const vite = await createViteServer({ root, server: { middlewareMode: true } });
  app.use(vite.middlewares);
} else {
  const distDirectory = path.join(root, "dist");
  app.use(express.static(distDirectory, { index: "index.html" }));
  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/api/") && !path.extname(req.path)) return res.sendFile(path.join(distDirectory, "index.html"));
    return next();
  });
}
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (req.path.startsWith("/api/")) {
    const status = Number(error?.statusCode || error?.status || 500);
    return res.status(status >= 400 && status < 600 ? status : 500).json({ error: error?.message || "Weki 로컬 서버 처리에 실패했습니다.", code: error?.code || "api_error" });
  }
  return next(error);
});
await recoverInterruptedJobs();
await queueRendererUpgradeJobs();
const port = Number(process.env.WEKI_PORT || 5173);
function closeRuntimeStores() { try { v2Store?.close(); } catch { /* Shutdown should not mask the original signal. */ } }
process.once("beforeExit", closeRuntimeStores);
process.once("exit", closeRuntimeStores);
process.once("SIGTERM", () => { closeRuntimeStores(); process.exit(0); });
process.once("SIGINT", () => { closeRuntimeStores(); process.exit(0); });
app.listen(port, "127.0.0.1", () => {
  console.log(`Weki is running at http://127.0.0.1:${port}`);
  try { if (typeof process.send === "function") process.send({ type: "weki-server-ready" }); } catch {}
  void runQueue();
  if (process.env.WEKI_DISABLE_INITIAL_MYBOX_SYNC !== "1" && shouldRunInitialMyboxSync({ newlyCreated: initialStoreCreated, documentCount: 0, hasToken: Boolean(process.env.NAVER_MBOX_TOKEN) })) void runMyboxCatalogSync({ initial: true }).catch(() => {});
});
