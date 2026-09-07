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
import { createCanvas } from "@napi-rs/canvas";
import { createWorker } from "tesseract.js";
import engData from "@tesseract.js-data/eng";
import korData from "@tesseract.js-data/kor";
import { parse as parseHwp } from "hwp.js";
import { createServer as createViteServer } from "vite";
import { buildPageMetrics, createBackupSnapshot, createFolderSnapshot, reconcileFolderSnapshotOriginals, removeDocumentData } from "./src/server/backup.mjs";
import { ACTIVE_JOB_STATUSES, visibleJobs } from "./src/server/jobs.mjs";
import { createMyboxClient } from "./src/server/mybox.mjs";
import { CLOUD_CATALOG_NAME, downloadCloudOriginal, findCloudOriginalResource, findWekiFolderStructure, mergeCloudCatalog, readCloudCatalog, shouldRunInitialMyboxSync } from "./src/server/mybox-sync.mjs";
import { documentOriginalKey, migrateLegacyOriginals, normalizeOriginalName, originalNameOf, resolveDocumentOriginalPath } from "./src/server/original-storage.mjs";

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
const backupsDir = path.join(dataDir, "backups");
const tessdataDir = path.join(dataDir, "tessdata");
const credentialsDir = path.join(dataDir, "credentials");
const dbPath = path.join(dataDir, "knowledge-base.json");
const allowed = new Set(["pdf", "pptx", "docx", "hwpx", "hwp"]);

async function ensureStore() {
  let databaseCreated = false;
  await fs.mkdir(originalsDir, { recursive: true });
  await fs.mkdir(incomingDir, { recursive: true });
  await fs.mkdir(backupsDir, { recursive: true });
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
    if (doc.sourceStatus !== nextSourceStatus && (doc.sourceStatus || verified)) { doc.sourceStatus = nextSourceStatus; changed = true; }
  }
  return { changed };
}
let originalStorageMigrated = false;
let originalReferencesReconciled = false;
async function readDb() {
  await ensureStore();
  const db = JSON.parse(await fs.readFile(dbPath, "utf8"));
  db.documents ??= [];
  db.jobs ??= [];
  db.synonyms ??= [];
  db.feedback ??= [];
  db.audit ??= [];
  db.maintenance ??= null;
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
  const next = JSON.parse(JSON.stringify(db));
  for (const doc of next.documents || []) { doc.originalKey = documentOriginalKey(doc); delete doc.originalPath; }
  return next;
};
async function writeDb(db) { await fs.writeFile(dbPath, JSON.stringify(persistableDatabase(db), null, 2)); }
async function writeDbAtomic(db) {
  const temporaryPath = `${dbPath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(persistableDatabase(db), null, 2));
  try { await fs.rename(temporaryPath, dbPath); } catch (error) { await fs.copyFile(temporaryPath, dbPath); await fs.unlink(temporaryPath).catch(() => {}); if (error.code !== "EEXIST") throw error; }
}
async function readStorageStats() {
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
    return { usage: Math.max(0, total - available), available, total, dataUsage: await directoryBytes(dataDir) };
  } catch {
    return { usage: 0, available: 0, total: 0, dataUsage: 0 };
  }
}
class JobInterrupted extends Error {
  constructor(status) { super(status === "paused" ? "작업이 일시중지되었습니다." : "작업이 취소되었습니다."); this.status = status; }
}
async function checkpoint(jobId, completed, total) {
  const db = await readDb(); const job = db.jobs.find((item) => item.id === jobId);
  if (!job || job.status === "cancelled") throw new JobInterrupted("cancelled");
  if (job.status === "paused") throw new JobInterrupted("paused");
  job.completedUnits = completed; job.totalUnits = total;
  job.progress = Math.max(1, Math.min(95, Math.round((completed / Math.max(1, total)) * 95)));
  job.detail = `${completed}/${total} 페이지·슬라이드 처리 완료`; await writeDb(db);
}
const textOnly = (value) => value.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
const normalizeFilename = (name) => {
  if (!/[ìëêíÃÂ]/.test(name)) return name;
  const decoded = Buffer.from(name, "latin1").toString("utf8");
  return /[가-힣]/.test(decoded) ? decoded : name;
};

async function extractPdf(buffer, options = {}) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true }).promise;
  const worker = await createLocalOcrWorker();
  const pages = [];
  try {
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo); const content = await page.getTextContent(); const nativeText = content.items.map((item) => item.str).join(" ").replace(/\s+/g, " ").trim();
      const viewport = page.getViewport({ scale: 1.5 }); const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      const { data: { text: ocrText } } = await worker.recognize(canvas.toBuffer("image/png"));
      const normalizedOcr = ocrText.replace(/\s+/g, " ").trim();
      pages.push({ page: pageNo, text: [nativeText, normalizedOcr].filter(Boolean).filter((value, index, list) => list.indexOf(value) === index).join(" "), nativeText, ocrText: normalizedOcr });
      await options.onUnit?.(pageNo, pdf.numPages);
    }
  } finally { await worker.terminate(); }
  return pages;
}
async function extractZip(buffer, ext, options = {}) {
  const zip = await JSZip.loadAsync(buffer);
  const files = Object.keys(zip.files);
  let paths;
  if (ext === "pptx") paths = files.filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  else if (ext === "docx") paths = files.filter((p) => p === "word/document.xml");
  else paths = files.filter((p) => /(?:Contents|section)\/.*\.xml$|^Contents\/content\.xml$/i.test(p));
  const slideOcr = new Map();
  const slideAssets = new Map();
  if (ext === "pptx") {
    const worker = await createLocalOcrWorker();
    try {
      for (const slidePath of paths) {
        const relPath = slidePath.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
        const rel = zip.file(relPath) ? await zip.file(relPath).async("string") : "";
        const targets = [...rel.matchAll(/Target="[^"]*media\/([^"]+)"/g)].map((match) => match[1]);
        const parts = []; const assets = [];
        for (const target of targets) {
          if (!/\.(?:png|jpe?g|webp)$/i.test(target)) continue;
          const asset = zip.file(`ppt/media/${target}`);
          if (!asset) continue;
          try {
            const { data: { text } } = await worker.recognize(await asset.async("nodebuffer"));
            const visualText = text.replace(/\s+/g, " ").trim(); if (visualText) parts.push(visualText);
            assets.push({ name: target, text: visualText, mime: target.match(/\.png$/i) ? "image/png" : target.match(/\.webp$/i) ? "image/webp" : "image/jpeg" });
          } catch { /* Unsupported or damaged visual assets remain a documented partial OCR failure. */ }
        }
        slideOcr.set(slidePath, parts.join(" "));
        slideAssets.set(slidePath, assets);
      }
    } finally { await worker.terminate(); }
  }
  const pages = [];
  for (let index = 0; index < paths.length; index++) {
    const xml = await zip.file(paths[index]).async("string");
    const tagged = [...xml.matchAll(/<(?:w:t|a:t|hp:t)[^>]*>([\s\S]*?)<\/(?:w:t|a:t|hp:t)>/g)].map((m) => textOnly(m[1])).filter(Boolean).join(" ");
    const tablePattern = ext === "docx" ? /<w:tbl[\s\S]*?<\/w:tbl>/g : ext === "pptx" ? /<a:tbl[\s\S]*?<\/a:tbl>/g : /<hp:tbl[\s\S]*?<\/hp:tbl>/g;
    const tableText = [...xml.matchAll(tablePattern)].map((match) => textOnly(match[0])).filter((value) => value.length > 2);
    const nativeText = tagged || textOnly(xml); const ocrText = slideOcr.get(paths[index]) || "";
    const text = [nativeText, ocrText].filter(Boolean).filter((value, itemIndex, list) => list.indexOf(value) === itemIndex).join(" ");
    pages.push({ page: index + 1, text, nativeText, ocrText, tableText, visualAssets: slideAssets.get(paths[index]) || [] });
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
  for (let index = 0; index < pages.length; index++) await options.onUnit?.(index + 1, pages.length);
  if (!pages.length) throw new Error("HWP에서 검색 가능한 텍스트를 추출하지 못했습니다.");
  return pages;
}
async function extract(buffer, ext, options) {
  if (ext === "pdf") return extractPdf(buffer, options);
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
const makeUnits = (pages) => pages.filter((page) => page.text).flatMap((page) => {
  const textUnit = { id: crypto.randomUUID(), range: page.page, text: page.nativeText || page.text, nativeText: page.nativeText || page.text, ocrText: page.ocrText || "", embedding: embedding(page.nativeText || page.text), evidenceType: "text" };
  const visualUnits = (page.visualAssets || []).filter((asset) => asset.text).map((asset) => ({ id: crypto.randomUUID(), range: page.page, text: asset.text, nativeText: "", ocrText: asset.text, embedding: embedding(asset.text), evidenceType: "visual", visualAssetName: asset.name, visualMime: asset.mime }));
  const tableUnits = (page.tableText || []).map((text) => ({ id: crypto.randomUUID(), range: page.page, text, nativeText: text, ocrText: "", embedding: embedding(text), evidenceType: "table" }));
  return [textUnit, ...tableUnits, ...visualUnits];
});
const activeJobs = (db) => db.jobs.filter((job) => ACTIVE_JOB_STATUSES.includes(job.status));
async function recoverInterruptedJobs() {
  const db = await readDb(); let changed = false;
  for (const job of db.jobs) {
    if (job.status === "processing") { job.status = "queued"; job.detail = "앱 종료 전 작업을 감지했습니다. 안전 지점부터 자동 재개합니다."; job.recoveredAt = new Date().toISOString(); changed = true; }
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
        job.status = "processing"; job.progress = 15; job.detail = "원본을 보관하고 페이지별 텍스트를 추출 중입니다."; await writeDb(db);
        try {
          const buffer = await fs.readFile(job.stagedPath); const pages = await extract(buffer, job.ext, { onUnit: (completed, total) => checkpoint(job.id, completed, total) });
          if (!pages.length) throw new Error("검색 가능한 텍스트를 추출하지 못했습니다.");
          const fresh = await readDb(); const freshJob = fresh.jobs.find((item) => item.id === job.id); if (!freshJob || freshJob.status === "cancelled") { await fs.unlink(job.stagedPath).catch(() => {}); continue; }
          const originalName = normalizeOriginalName(job.name, `${job.hash}.${job.ext}`); const originalKey = `${job.hash}/${originalName}`; const originalPath = path.join(originalsDir, job.hash, originalName); await writeOriginalAtomically(originalPath, buffer); await fs.unlink(job.stagedPath).catch(() => {});
          const pdfOcr = job.ext === "pdf"; const now = new Date().toISOString(); const units = makeUnits(pages); const metrics = buildPageMetrics(pages, units); const doc = { id: crypto.randomUUID(), name: job.name, originalName, format: job.ext.toUpperCase(), hash: job.hash, originalKey, size: job.size, registeredAt: now, modifiedAt: job.modifiedAt, updatedAt: now, processingMode: job.mode, ...metrics, sourceStatus: "local_available", nativeTextStatus: "success", ocrStatus: pdfOcr ? "success" : "unavailable", visualAnalysisStatus: "not_supported", units };
          fresh.documents.push(doc); freshJob.documentId = doc.id; freshJob.status = "completed"; freshJob.progress = 100; freshJob.detail = `${metrics.pageCount}개 페이지 처리 완료${metrics.failedPageCount ? ` · ${metrics.failedPageCount}개 페이지 검색 불가` : ""}`; freshJob.completedAt = now; delete freshJob.stagedPath; fresh.audit.unshift({ id: crypto.randomUUID(), type: "registration", documentId: doc.id, createdAt: now, detail: freshJob.detail }); await writeDb(fresh);
        } catch (error) { const fresh = await readDb(); const freshJob = fresh.jobs.find((item) => item.id === job.id); if (freshJob && error instanceof JobInterrupted) { freshJob.status = error.status; freshJob.detail = error.message; freshJob.interruptedAt = new Date().toISOString(); if (error.status === "cancelled") { await fs.unlink(freshJob.stagedPath || job.stagedPath).catch(() => {}); delete freshJob.stagedPath; } await writeDb(fresh); } else if (freshJob) { freshJob.status = "failed"; freshJob.progress = 0; freshJob.detail = error.message; await writeDb(fresh); } }
        continue;
      }
       const doc = db.documents.find((item) => item.id === job.documentId);
       let originalPath;
       try { originalPath = await ensureDocumentOriginal(doc); } catch (error) { job.status = "failed"; job.detail = error.message || "원본이 없어 재처리할 수 없습니다."; await writeDb(db); continue; }
      job.status = "processing"; job.progress = 20; job.detail = "기존 색인을 유지한 채 로컬 재처리 중입니다."; await writeDb(db);
      try {
        const pages = await extract(await fs.readFile(originalPath), doc.format.toLowerCase(), { onUnit: (completed, total) => checkpoint(job.id, completed, total) });
        const fresh = await readDb(); const freshJob = fresh.jobs.find((item) => item.id === job.id); const freshDoc = fresh.documents.find((item) => item.id === job.documentId);
        if (!freshJob || freshJob.status === "cancelled") continue;
        const pdfOcr = freshDoc.format === "PDF"; freshDoc.units = makeUnits(pages); Object.assign(freshDoc, buildPageMetrics(pages, freshDoc.units)); freshDoc.updatedAt = new Date().toISOString(); freshDoc.nativeTextStatus = "success"; freshDoc.ocrStatus = pdfOcr ? "success" : "unavailable";
        freshJob.status = "completed"; freshJob.progress = 100; freshJob.detail = `${freshDoc.pageCount}개 페이지 재처리 완료${freshDoc.failedPageCount ? ` · ${freshDoc.failedPageCount}개 페이지 검색 불가` : ""}${pdfOcr ? " · OCR 완료" : ""}`; freshJob.completedAt = new Date().toISOString(); fresh.audit.unshift({ id: crypto.randomUUID(), type: "reprocess", documentId: freshDoc.id, createdAt: freshJob.completedAt, detail: freshJob.detail }); await writeDb(fresh);
      } catch (error) { const fresh = await readDb(); const freshJob = fresh.jobs.find((item) => item.id === job.id); if (freshJob && error instanceof JobInterrupted) { freshJob.status = error.status; freshJob.detail = error.message; freshJob.interruptedAt = new Date().toISOString(); await writeDb(fresh); } else if (freshJob) { freshJob.status = "failed"; freshJob.progress = 0; freshJob.detail = error.message; await writeDb(fresh); } }
    }
  } finally { queueRunning = false; }
}
const encryptBackup = (payload, passphrase) => {
  const salt = crypto.randomBytes(16); const iv = crypto.randomBytes(12); const key = crypto.scryptSync(passphrase, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv); const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return JSON.stringify({ format: "weki-backup", version: 1, salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") });
};
const decryptBackup = (raw, passphrase) => {
  const envelope = JSON.parse(raw); if (envelope.format !== "weki-backup" || envelope.version !== 1) throw new Error("지원하지 않는 백업 형식입니다.");
  const key = crypto.scryptSync(passphrase, Buffer.from(envelope.salt, "base64"), 32); const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64")); decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8"));
};
const createLocalOcrWorker = () => createWorker("eng+kor", 1, { langPath: tessdataDir, gzip: true, cacheMethod: "none" });
const tokens = (query) => query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
function search(db, query) {
  const terms = tokens(query); const queryEmbedding = embedding(query);
  return db.documents.filter((doc) => ["completed", "partial"].includes(doc.processingStatus)).flatMap((doc) => doc.units.map((unit) => {
    const haystack = `${unit.text} ${doc.name}`.toLowerCase();
    const hits = terms.filter((term) => haystack.includes(term));
    const lexical = terms.length ? Math.round((hits.length / terms.length) * 70) : 0;
    const semantic = Math.round(Math.max(0, cosine(queryEmbedding, unit.embedding || embedding(unit.text))) * 30);
    const frequency = hits.reduce((count, term) => count + (haystack.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length || 0), 0);
    const locationPrefix = doc.format === "HWP" ? "섹션" : doc.format === "PPTX" ? "슬라이드" : "p.";
    const evidenceOrigin = unit.evidenceType === "visual" ? "ocr" : unit.evidenceType === "table" ? "native" : unit.nativeText && unit.ocrText ? "native+ocr" : unit.ocrText ? "ocr" : "native";
    return { documentId: doc.id, fileName: doc.name, format: doc.format, sourceStatus: doc.sourceStatus, cloudOriginalFile: doc.cloudOriginalFile || null, matchedPage: unit.range, sourceRange: unit.range, locationPrefix, evidenceType: unit.evidenceType, evidenceOrigin, visualAssetName: unit.visualAssetName || null, text: unit.text.slice(0, 420), lexicalScore: lexical, semanticScore: semantic, score: Math.min(100, lexical + semantic + Math.min(15, frequency * 3)), lowRelevance: hits.length === 0, matchedTerms: hits };
  })).filter((result) => (result.matchedTerms.length > 0 || result.semanticScore >= 12) && result.text.trim().length > 3).sort((a, b) => b.score - a.score || a.fileName.localeCompare(b.fileName)).slice(0, 30);
}
function expandQuery(db, query) {
  const lower = query.toLowerCase(); const expansions = [];
  for (const entry of db.synonyms.filter((item) => item.approved)) {
    const forms = [entry.term, ...entry.aliases].map((item) => item.toLowerCase());
    if (forms.some((form) => lower.includes(form))) expansions.push(...forms.filter((form) => form !== lower));
  }
  return { normalized: query.trim().replace(/\s+/g, " "), expansions: [...new Set(expansions)] };
}

const mybox = createMyboxClient({ apiBase: process.env.WEKI_MYBOX_API_BASE || undefined });
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
        if (currentDoc) { currentDoc.sourceStatus = status; await writeDb(current); }
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
        if (currentDoc) { currentDoc.originalKey = originalKey; currentDoc.sourceStatus = "local_available"; currentDoc.cloudOriginalFile = document.cloudOriginalFile; delete currentDoc.originalPath; await writeDbAtomic(current); }
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
  for (const entry of ["knowledge-base.json", "originals", "incoming", "backups", "tessdata", "credentials", "storage-location.json", ".weki-storage-root"]) {
    const source = path.join(dataDir, entry); const destination = path.join(targetDir, entry);
    try { await fs.cp(source, destination, { recursive: true, force: false, errorOnExist: false }); } catch (error) { if (error.code !== "EEXIST") throw error; }
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
  const managedDirectories = ["originals", "incoming", "backups", "tessdata", "credentials"];
  if (!(process.platform === "win32" && process.env.WEKI_DESKTOP === "1")) managedDirectories.push(".runtime");
  for (const entry of managedDirectories) await fs.rm(path.join(rootDir, entry), { recursive: true, force: true });
  for (const entry of ["knowledge-base.json", "storage-location.json", ".weki-storage-root"]) await fs.rm(path.join(rootDir, entry), { force: true });
  try {
    const remaining = await fs.readdir(rootDir);
    if (remaining.length) return false;
    await fs.rmdir(rootDir);
    return !(await fs.stat(rootDir).catch(() => null));
  } catch { return false; }
}

const initialStoreCreated = await ensureStore();
const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024, files: 30 } });
app.get("/api/documents", async (_req, res) => { const db = await readDb(); res.json({ documents: db.documents.map((doc) => publicDocument(db, doc)) }); });
app.get("/api/status", async (_req, res) => {
  const db = await readDb();
  const storage = await readStorageStats();
  res.json({
    documentCount: db.documents.length,
    indexedUnits: db.documents.reduce((count, doc) => count + doc.units.length, 0),
    storage,
    dataDirectory: dataDir,
    maintenance: db.maintenance ?? null,
    engines: { lexical: "healthy", evidence: "healthy" },
  });
});
app.get("/api/mybox/status", async (_req, res) => {
  if (configuredCredentialState === "unreadable") return res.json({ connected: false, credentialState: "unreadable", reason: "credential_unreadable", message: myboxCredentialMessage.unreadable, sync: { ...myboxSyncState } });
  if (!process.env.NAVER_MBOX_TOKEN) return res.json({ connected: false, credentialState: "missing", reason: "token_missing", message: myboxCredentialMessage.missing, sync: { ...myboxSyncState } });
  try { const storage = await mybox.storage(); res.json({ connected: true, credentialState: "available", message: "연결됨", storage, sync: { ...myboxSyncState } }); } catch (error) { res.json({ connected: false, ...publicMyboxError(error), sync: { ...myboxSyncState } }); }
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
  };
};
const publicDocument = (db, doc) => { const metrics = documentMetrics(db, doc); return { ...doc, ...metrics, pages: metrics.pageCount, units: undefined }; };
app.get("/api/jobs", async (_req, res) => { const db = await readDb(); res.json({ jobs: visibleJobs(db.jobs) }); });
app.get("/api/audit", async (_req, res) => { const db = await readDb(); res.json({ entries: db.audit.slice(0, 40) }); });
app.post("/api/search", async (req, res) => { const db = await readDb(); const query = expandQuery(db, req.body.query || ""); res.json({ query: query.normalized, expansions: query.expansions, results: search(db, [query.normalized, ...query.expansions].join(" ")) }); });
app.get("/api/synonyms", async (_req, res) => { const db = await readDb(); res.json({ entries: db.synonyms }); });
app.post("/api/synonyms", async (req, res) => {
  const term = String(req.body?.term || "").trim(); const aliases = [...new Set((req.body?.aliases || []).map((value) => String(value).trim()).filter(Boolean))];
  if (!term || !aliases.length) return res.status(400).json({ error: "기준어와 하나 이상의 동의어·약어가 필요합니다." });
  const db = await readDb(); if (db.maintenance) return res.status(409).json({ error: "Maintenance 작업 중에는 동의어를 변경할 수 없습니다." }); const entry = { id: crypto.randomUUID(), term, aliases, approved: true, source: "user", createdAt: new Date().toISOString() }; db.synonyms.unshift(entry); db.audit.unshift({ id: crypto.randomUUID(), type: "synonym", detail: `${term} synonym added`, createdAt: entry.createdAt }); await writeDb(db); res.status(201).json({ entry });
});
app.delete("/api/synonyms/:id", async (req, res) => {
  const db = await readDb(); if (db.maintenance) return res.status(409).json({ error: "Maintenance 작업 중에는 동의어를 변경할 수 없습니다." }); const before = db.synonyms.length;
  db.synonyms = db.synonyms.filter((entry) => entry.id !== req.params.id);
  if (before === db.synonyms.length) return res.status(404).json({ error: "동의어 항목을 찾을 수 없습니다." });
  db.audit.unshift({ id: crypto.randomUUID(), type: "synonym", detail: "synonym removed", createdAt: new Date().toISOString() });
  await writeDb(db); res.status(204).end();
});
app.post("/api/feedback", async (req, res) => { const db = await readDb(); if (db.maintenance) return res.status(409).json({ error: "Maintenance 작업 중에는 피드백을 기록할 수 없습니다." }); const feedback = { id: crypto.randomUUID(), query: String(req.body?.query || ""), documentId: req.body?.documentId || null, helpful: Boolean(req.body?.helpful), createdAt: new Date().toISOString() }; db.feedback.unshift(feedback); await writeDb(db); res.status(201).json({ feedback }); });
app.post("/api/backups", async (req, res) => {
  const { type = "search", passphrase } = req.body || {};
  if (!["search", "full"].includes(type)) return res.status(400).json({ error: "백업 유형이 올바르지 않습니다." });
  if (!passphrase || passphrase.length < 8) return res.status(400).json({ error: "백업 암호는 8자 이상이어야 합니다." });
  const db = await readDb(); if (activeJobs(db).length || db.maintenance) return res.status(409).json({ error: "Processing Queue가 비어 있고 Maintenance 작업이 없어야 합니다." });
  db.maintenance = { type: `${type}-backup`, startedAt: new Date().toISOString() }; await writeDb(db);
  try {
    const payload = { type, createdAt: new Date().toISOString(), database: { ...db, maintenance: null, documents: db.documents.map((doc) => ({ ...doc, originalKey: type === "full" ? documentOriginalKey(doc) : null })) }, originals: {} };
    if (type === "full") for (const doc of db.documents.filter((item) => ["available", "local_available"].includes(item.sourceStatus))) { const originalPath = resolveDocumentOriginalPath(dataDir, doc); const hash = String(doc.hash || "").toLowerCase(); if (!originalPath || !/^[a-f0-9]{64}$/.test(hash)) continue; payload.originals[hash] = { name: originalNameOf(doc, path.basename(originalPath)), format: doc.format, data: (await fs.readFile(originalPath)).toString("base64") }; }
    const fileName = `weki-${type}-${Date.now()}.weki`; await fs.writeFile(path.join(backupsDir, fileName), encryptBackup(payload, passphrase));
    db.maintenance = null; db.audit.unshift({ id: crypto.randomUUID(), type: "backup", detail: `${type} backup created`, createdAt: new Date().toISOString() }); await writeDb(db);
    res.status(201).json({ fileName, path: path.join(backupsDir, fileName), type });
  } catch (error) { db.maintenance = null; await writeDb(db); res.status(500).json({ error: error.message }); }
});
app.post("/api/backups/restore", upload.single("backup"), async (req, res) => {
  const passphrase = req.body?.passphrase; if (!req.file || !passphrase) return res.status(400).json({ error: "백업 파일과 암호가 필요합니다." });
  const current = await readDb(); if (activeJobs(current).length || current.maintenance) return res.status(409).json({ error: "Processing Queue가 비어 있고 Maintenance 작업이 없어야 합니다." });
  current.maintenance = { type: "restore", startedAt: new Date().toISOString() }; await writeDb(current);
  try {
    const payload = decryptBackup(req.file.buffer.toString("utf8"), passphrase); if (!payload.database?.documents || !["search", "full"].includes(payload.type)) throw new Error("유효하지 않은 백업 내용입니다.");
    const restored = payload.database; restored.maintenance = null; restored.jobs = []; restored.audit ??= [];
    if (payload.type === "search") restored.documents.forEach((doc) => { doc.sourceStatus = "unavailable"; doc.originalKey = null; delete doc.originalPath; });
    else { await fs.mkdir(originalsDir, { recursive: true }); for (const doc of restored.documents) { const currentKey = documentOriginalKey(doc); const stored = (doc.hash && payload.originals?.[doc.hash]) || (currentKey && payload.originals?.[currentKey]); const data = typeof stored === "string" ? stored : stored?.data; const originalName = normalizeOriginalName(stored?.name || doc.originalName || doc.name, doc.hash ? `${doc.hash}.${String(doc.format || "bin").toLowerCase()}` : "original.bin"); const originalKey = doc.hash && data ? `${doc.hash}/${originalName}` : currentKey; if (!data || !originalKey) { doc.sourceStatus = "unavailable"; doc.originalKey = originalKey; delete doc.originalPath; } else { doc.originalName = doc.originalName || originalName; doc.originalKey = originalKey; const originalPath = resolveDocumentOriginalPath(dataDir, doc); await writeOriginalAtomically(originalPath, Buffer.from(data, "base64")); delete doc.originalPath; doc.sourceStatus = "local_available"; } } }
    restored.audit.unshift({ id: crypto.randomUUID(), type: "restore", detail: `${payload.type} backup restored`, createdAt: new Date().toISOString() }); await writeDb(restored);
    res.json({ type: payload.type, documents: restored.documents.length, sourceStatus: payload.type === "search" ? "unavailable" : "local_available" });
  } catch (error) { current.maintenance = null; await writeDb(current); res.status(422).json({ error: "복원에 실패했습니다. 기존 데이터는 유지됩니다.", detail: error.message }); }
});
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
    const sourceRemoved = await removeManagedStore(currentPath);
    const sourceCleanupPending = !sourceRemoved && process.platform === "win32" && process.env.WEKI_DESKTOP === "1";
    res.json({ path: resolvedTarget, restartRequired: true, sourceRemoved, sourceCleanupPending });
  }
  catch (error) { await fs.rm(staging, { recursive: true, force: true }).catch(() => {}); res.status(422).json({ error: `저장소 이전에 실패했습니다: ${error.message}` }); }
});
app.post("/api/documents", upload.array("files"), async (req, res) => {
  const db = await readDb(); if (db.maintenance) return res.status(409).json({ error: "Maintenance 작업 중에는 문서 등록을 시작할 수 없습니다." }); const results = [];
  for (const file of req.files || []) {
    const fileName = normalizeFilename(file.originalname); const ext = path.extname(fileName).slice(1).toLowerCase();
    if (!allowed.has(ext)) { results.push({ name: fileName, status: "failed", error: "지원 형식은 PDF, PPTX, HWP, HWPX, DOCX입니다." }); continue; }
    const hash = crypto.createHash("sha256").update(file.buffer).digest("hex");
    const existing = db.documents.find((doc) => doc.hash === hash);
    if (existing && ["available", "local_available"].includes(existing.sourceStatus)) {
      const job = { id: crypto.randomUUID(), kind: "registration", name: fileName, mode: req.body.mode || "lightweight", status: "skipped", progress: 100, detail: "동일 Hash 문서가 이미 등록되어 있습니다.", createdAt: new Date().toISOString(), completedAt: new Date().toISOString() };
      db.jobs.unshift(job); results.push({ name: fileName, status: "skipped", jobId: job.id, documentId: existing.id, message: job.detail }); continue;
    }
    if (existing && ["missing", "unavailable", "cloud_available"].includes(existing.sourceStatus)) {
      const now = new Date().toISOString(); const originalName = originalNameOf(existing, normalizeOriginalName(fileName, `${hash}.${ext}`)); const originalKey = documentOriginalKey({ ...existing, originalName }) || `${hash}/${originalName}`; const originalPath = resolveDocumentOriginalPath(dataDir, { ...existing, originalKey });
      await writeOriginalAtomically(originalPath, file.buffer); existing.originalName ??= originalName; existing.sourceStatus = "local_available"; existing.originalKey = originalKey; delete existing.originalPath;
      const job = { id: crypto.randomUUID(), kind: "source-relink", name: fileName, mode: req.body.mode || "lightweight", status: "completed", progress: 100, detail: "기존 Document 원본을 자동 재연결했습니다.", documentId: existing.id, createdAt: now, completedAt: now };
      db.jobs.unshift(job); results.push({ name: fileName, status: "relinked", jobId: job.id, documentId: existing.id, pages: existing.units.length }); continue;
    }
    const now = new Date().toISOString(); const job = { id: crypto.randomUUID(), kind: "registration", name: fileName, mode: req.body.mode || "lightweight", status: "queued", progress: 0, detail: "대기열에 추가되었습니다.", hash, ext, size: file.size, modifiedAt: new Date(file.lastModified || Date.now()).toISOString(), createdAt: now };
    job.stagedPath = path.join(incomingDir, `${job.id}.${ext}`); await fs.writeFile(job.stagedPath, file.buffer); db.jobs.unshift(job); results.push({ name: fileName, status: "queued", jobId: job.id, message: job.detail });
  }
  await writeDb(db); void runQueue(); res.status(202).json({ results });
});
app.post("/api/documents/:id/reprocess", async (req, res) => {
  const db = await readDb(); const doc = db.documents.find((item) => item.id === req.params.id);
  if (!doc) return res.status(404).json({ error: "문서를 찾을 수 없습니다." });
  if (db.maintenance) return res.status(409).json({ error: "Maintenance 작업 중에는 재처리를 시작할 수 없습니다." });
  let originalPath;
  try { originalPath = await ensureDocumentOriginal(doc); } catch (error) { return res.status(409).json({ error: error.message || "원본이 누락된 문서는 동일 Hash 원본을 다시 등록한 뒤 재처리할 수 있습니다." }); }
  const job = { id: crypto.randomUUID(), kind: "reprocess", name: doc.name, mode: req.body.mode || "lightweight", status: "queued", progress: 0, detail: "대기열에 추가되었습니다. 기존 검색 결과는 유지됩니다.", documentId: doc.id, createdAt: new Date().toISOString() };
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
  await writeDb(db); if (["resume", "start", "retry"].includes(action)) void runQueue(); res.json({ job: action === "dismiss" ? null : job });
});
app.get("/api/documents/:id/original", async (req, res) => {
  const db = await readDb(); const doc = db.documents.find((item) => item.id === req.params.id);
  if (!doc) return res.status(404).json({ error: "문서를 찾을 수 없습니다." });
  try { const originalPath = await ensureDocumentOriginal(doc); res.download(originalPath, doc.name); } catch (error) { res.status(404).json({ error: error.message || "원본을 사용할 수 없습니다." }); }
});
app.get("/api/documents/:id/visual/:name", async (req, res) => {
  const db = await readDb(); const doc = db.documents.find((item) => item.id === req.params.id); const name = path.basename(req.params.name);
  if (!doc || doc.format !== "PPTX" || !doc.units.some((unit) => unit.visualAssetName === name)) return res.status(404).end();
  try { const originalPath = await ensureDocumentOriginal(doc); const zip = await JSZip.loadAsync(await fs.readFile(originalPath)); const asset = zip.file(`ppt/media/${name}`); if (!asset) return res.status(404).end(); const mime = name.match(/\.png$/i) ? "image/png" : name.match(/\.webp$/i) ? "image/webp" : "image/jpeg"; res.type(mime).send(await asset.async("nodebuffer")); } catch { res.status(422).end(); }
});
app.delete("/api/data", async (req, res) => {
  const db = await readDb(); if (activeJobs(db).length || db.maintenance) return res.status(409).json({ error: "Processing Queue가 비어 있고 Maintenance 작업이 없어야 합니다." });
  if (req.get("x-weki-confirmation") !== "DELETE ALL DOCUMENTS") return res.status(400).json({ error: "확인 문구가 일치하지 않습니다." });
  db.maintenance = { type: "delete-all", startedAt: new Date().toISOString() }; await writeDb(db);
  try { await fs.rm(originalsDir, { recursive: true, force: true }); await fs.rm(incomingDir, { recursive: true, force: true }); await fs.mkdir(originalsDir, { recursive: true }); await fs.mkdir(incomingDir, { recursive: true }); const cleared = { documents: [], jobs: [], synonyms: db.synonyms, feedback: db.feedback, audit: [{ id: crypto.randomUUID(), type: "delete-all", detail: "all document data deleted", createdAt: new Date().toISOString() }], maintenance: null }; await writeDb(cleared); res.status(204).end(); } catch (error) { db.maintenance = null; await writeDb(db); res.status(500).json({ error: "전체 데이터 삭제에 실패했습니다.", detail: error.message }); }
});
app.delete("/api/documents/:id", async (req, res) => {
  const db = await readDb(); if (db.maintenance) return res.status(409).json({ error: "Maintenance 작업 중에는 문서를 삭제할 수 없습니다." }); const doc = db.documents.find((item) => item.id === req.params.id);
  if (!doc) return res.status(404).json({ error: "문서를 찾을 수 없습니다." });
  if (activeJobs(db).some((job) => job.documentId === doc.id)) return res.status(409).json({ error: "이 문서는 처리 작업이 끝난 뒤 삭제할 수 있습니다." });
  const result = removeDocumentData(db, doc.id); const remainingHashReferences = result.database.documents.some((item) => item.hash && item.hash === doc.hash); await writeDb(result.database);
  const originalPath = resolveDocumentOriginalPath(dataDir, doc); if (originalPath && !remainingHashReferences) { await fs.unlink(originalPath).catch(() => {}); await fs.rmdir(path.dirname(originalPath)).catch(() => {}); } res.status(204).end();
});

const vite = await createViteServer({ root, server: { middlewareMode: true } });
app.use(vite.middlewares);
await recoverInterruptedJobs();
const port = Number(process.env.WEKI_PORT || 5173);
app.listen(port, "127.0.0.1", () => {
  console.log(`Weki is running at http://127.0.0.1:${port}`);
  void runQueue();
  if (process.env.WEKI_DISABLE_INITIAL_MYBOX_SYNC !== "1" && shouldRunInitialMyboxSync({ newlyCreated: initialStoreCreated, documentCount: 0, hasToken: Boolean(process.env.NAVER_MBOX_TOKEN) })) void runMyboxCatalogSync({ initial: true }).catch(() => {});
});
