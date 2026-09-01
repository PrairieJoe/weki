import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
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

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, ".weki-data");
const originalsDir = path.join(dataDir, "originals");
const incomingDir = path.join(dataDir, "incoming");
const backupsDir = path.join(dataDir, "backups");
const tessdataDir = path.join(dataDir, "tessdata");
const dbPath = path.join(dataDir, "knowledge-base.json");
const allowed = new Set(["pdf", "pptx", "docx", "hwpx", "hwp"]);

async function ensureStore() {
  await fs.mkdir(originalsDir, { recursive: true });
  await fs.mkdir(incomingDir, { recursive: true });
  await fs.mkdir(backupsDir, { recursive: true });
  await fs.mkdir(tessdataDir, { recursive: true });
  for (const [language, source] of [["eng", engData.langPath], ["kor", korData.langPath]]) {
    const destination = path.join(tessdataDir, `${language}.traineddata.gz`);
    try { await fs.access(destination); } catch { await fs.copyFile(path.join(source, `${language}.traineddata.gz`), destination); }
  }
  try { await fs.access(dbPath); } catch { await fs.writeFile(dbPath, JSON.stringify({ documents: [] }, null, 2)); }
}
async function readDb() {
  await ensureStore();
  const db = JSON.parse(await fs.readFile(dbPath, "utf8"));
  db.documents ??= [];
  db.jobs ??= [];
  db.synonyms ??= [];
  db.feedback ??= [];
  db.audit ??= [];
  db.maintenance ??= null;
  for (const doc of db.documents) doc.name = normalizeFilename(doc.name);
  for (const job of db.jobs) job.name = normalizeFilename(job.name);
  return db;
}
async function writeDb(db) { await fs.writeFile(dbPath, JSON.stringify(db, null, 2)); }
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
    if (text) pages.push({ page: index + 1, text, nativeText, ocrText, tableText, visualAssets: slideAssets.get(paths[index]) || [] });
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
  }).filter((page) => page.text);
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
const activeJobs = (db) => db.jobs.filter((job) => ["queued", "processing", "paused"].includes(job.status));
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
          const originalPath = path.join(originalsDir, `${job.hash}.${job.ext}`); await fs.rename(job.stagedPath, originalPath).catch(async () => fs.copyFile(job.stagedPath, originalPath));
          const pdfOcr = job.ext === "pdf"; const now = new Date().toISOString(); const doc = { id: crypto.randomUUID(), name: job.name, format: job.ext.toUpperCase(), hash: job.hash, size: job.size, registeredAt: now, modifiedAt: job.modifiedAt, processingMode: job.mode, processingStatus: pdfOcr ? "completed" : "partial", sourceStatus: "available", nativeTextStatus: "success", ocrStatus: pdfOcr ? "success" : "unavailable", visualAnalysisStatus: "not_supported", originalPath, units: makeUnits(pages) };
          fresh.documents.push(doc); freshJob.documentId = doc.id; freshJob.status = "completed"; freshJob.progress = 100; freshJob.detail = `${doc.units.length}개 페이지 색인 완료`; freshJob.completedAt = now; delete freshJob.stagedPath; fresh.audit.unshift({ id: crypto.randomUUID(), type: "registration", documentId: doc.id, createdAt: now, detail: freshJob.detail }); await writeDb(fresh);
        } catch (error) { const fresh = await readDb(); const freshJob = fresh.jobs.find((item) => item.id === job.id); if (freshJob && error instanceof JobInterrupted) { freshJob.status = error.status; freshJob.detail = error.message; freshJob.interruptedAt = new Date().toISOString(); if (error.status === "cancelled") { await fs.unlink(freshJob.stagedPath || job.stagedPath).catch(() => {}); delete freshJob.stagedPath; } await writeDb(fresh); } else if (freshJob) { freshJob.status = "failed"; freshJob.progress = 0; freshJob.detail = error.message; await writeDb(fresh); } }
        continue;
      }
      const doc = db.documents.find((item) => item.id === job.documentId);
      if (!doc?.originalPath) { job.status = "failed"; job.detail = "원본이 없어 재처리할 수 없습니다."; await writeDb(db); continue; }
      job.status = "processing"; job.progress = 20; job.detail = "기존 색인을 유지한 채 로컬 재처리 중입니다."; await writeDb(db);
      try {
        const pages = await extract(await fs.readFile(doc.originalPath), doc.format.toLowerCase(), { onUnit: (completed, total) => checkpoint(job.id, completed, total) });
        const fresh = await readDb(); const freshJob = fresh.jobs.find((item) => item.id === job.id); const freshDoc = fresh.documents.find((item) => item.id === job.documentId);
        if (!freshJob || freshJob.status === "cancelled") continue;
        const pdfOcr = freshDoc.format === "PDF"; freshDoc.units = makeUnits(pages); freshDoc.processingStatus = pdfOcr ? "completed" : "partial"; freshDoc.nativeTextStatus = "success"; freshDoc.ocrStatus = pdfOcr ? "success" : "unavailable";
        freshJob.status = "completed"; freshJob.progress = 100; freshJob.detail = `${freshDoc.units.length}개 페이지 재색인 완료${pdfOcr ? " · OCR 완료" : ""}`; freshJob.completedAt = new Date().toISOString(); fresh.audit.unshift({ id: crypto.randomUUID(), type: "reprocess", documentId: freshDoc.id, createdAt: freshJob.completedAt, detail: freshJob.detail }); await writeDb(fresh);
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
    return { documentId: doc.id, fileName: doc.name, format: doc.format, matchedPage: unit.range, sourceRange: unit.range, locationPrefix, evidenceType: unit.evidenceType, evidenceOrigin, visualAssetName: unit.visualAssetName || null, text: unit.text.slice(0, 420), lexicalScore: lexical, semanticScore: semantic, score: Math.min(100, lexical + semantic + Math.min(15, frequency * 3)), lowRelevance: hits.length === 0, matchedTerms: hits };
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

await ensureStore();
const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024, files: 30 } });
app.get("/api/documents", async (_req, res) => { const db = await readDb(); res.json({ documents: db.documents.map(({ units, ...doc }) => ({ ...doc, pages: units.length })) }); });
app.get("/api/status", async (_req, res) => { const db = await readDb(); res.json({ documentCount: db.documents.length, indexedUnits: db.documents.reduce((count, doc) => count + doc.units.length, 0), engines: { lexical: "healthy", evidence: "healthy" } }); });
app.get("/api/jobs", async (_req, res) => { const db = await readDb(); res.json({ jobs: db.jobs }); });
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
    const payload = { type, createdAt: new Date().toISOString(), database: { ...db, maintenance: null, documents: db.documents.map((doc) => ({ ...doc, originalPath: type === "full" ? doc.originalPath : null })) }, originals: {} };
    if (type === "full") for (const doc of db.documents.filter((item) => item.sourceStatus === "available")) payload.originals[path.basename(doc.originalPath)] = (await fs.readFile(doc.originalPath)).toString("base64");
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
    if (payload.type === "search") restored.documents.forEach((doc) => { doc.sourceStatus = "missing"; doc.originalPath = null; });
    else { const restoreOriginalsDir = path.join(originalsDir, `restore-${crypto.randomUUID()}`); await fs.mkdir(restoreOriginalsDir, { recursive: true }); for (const doc of restored.documents) { const name = path.basename(doc.originalPath || `${doc.hash}.${doc.format.toLowerCase()}`); const data = payload.originals?.[name]; if (!data) { doc.sourceStatus = "missing"; doc.originalPath = null; } else { const originalPath = path.join(restoreOriginalsDir, name); await fs.writeFile(originalPath, Buffer.from(data, "base64")); doc.originalPath = originalPath; doc.sourceStatus = "available"; } } }
    restored.audit.unshift({ id: crypto.randomUUID(), type: "restore", detail: `${payload.type} backup restored`, createdAt: new Date().toISOString() }); await writeDb(restored);
    res.json({ type: payload.type, documents: restored.documents.length, sourceStatus: payload.type === "search" ? "missing" : "available" });
  } catch (error) { current.maintenance = null; await writeDb(current); res.status(422).json({ error: "복원에 실패했습니다. 기존 데이터는 유지됩니다.", detail: error.message }); }
});
app.post("/api/documents", upload.array("files"), async (req, res) => {
  const db = await readDb(); if (db.maintenance) return res.status(409).json({ error: "Maintenance 작업 중에는 문서 등록을 시작할 수 없습니다." }); const results = [];
  for (const file of req.files || []) {
    const fileName = normalizeFilename(file.originalname); const ext = path.extname(fileName).slice(1).toLowerCase();
    if (!allowed.has(ext)) { results.push({ name: fileName, status: "failed", error: "지원 형식은 PDF, PPTX, HWP, HWPX, DOCX입니다." }); continue; }
    const hash = crypto.createHash("sha256").update(file.buffer).digest("hex");
    const existing = db.documents.find((doc) => doc.hash === hash);
    if (existing && existing.sourceStatus === "available") {
      const job = { id: crypto.randomUUID(), kind: "registration", name: fileName, mode: req.body.mode || "lightweight", status: "skipped", progress: 100, detail: "동일 Hash 문서가 이미 등록되어 있습니다.", createdAt: new Date().toISOString(), completedAt: new Date().toISOString() };
      db.jobs.unshift(job); results.push({ name: fileName, status: "skipped", jobId: job.id, documentId: existing.id, message: job.detail }); continue;
    }
    if (existing && existing.sourceStatus === "missing") {
      const now = new Date().toISOString(); const originalPath = path.join(originalsDir, `${hash}.${ext}`);
      await fs.writeFile(originalPath, file.buffer); existing.sourceStatus = "available"; existing.originalPath = originalPath;
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
  if (doc.sourceStatus !== "available" || !doc.originalPath) return res.status(409).json({ error: "원본이 누락된 문서는 동일 Hash 원본을 다시 등록한 뒤 재처리할 수 있습니다." });
  const job = { id: crypto.randomUUID(), kind: "reprocess", name: doc.name, mode: req.body.mode || "lightweight", status: "queued", progress: 0, detail: "대기열에 추가되었습니다. 기존 검색 결과는 유지됩니다.", documentId: doc.id, createdAt: new Date().toISOString() };
  db.jobs.unshift(job); await writeDb(db); void runQueue(); res.status(202).json({ job, document: { ...doc, units: undefined } });
});
app.post("/api/jobs/:id/action", async (req, res) => {
  const action = req.body?.action; if (!["pause", "resume", "start", "cancel"].includes(action)) return res.status(400).json({ error: "지원하지 않는 작업 명령입니다." });
  const db = await readDb(); const job = db.jobs.find((item) => item.id === req.params.id); if (!job) return res.status(404).json({ error: "작업을 찾을 수 없습니다." });
  if (action === "pause" && ["queued", "processing"].includes(job.status)) { const wasProcessing = job.status === "processing"; job.status = "paused"; job.detail = wasProcessing ? "현재 페이지·슬라이드가 끝나면 일시중지합니다." : "사용자가 일시중지했습니다."; }
  else if (action === "resume" && job.status === "paused") { job.status = "queued"; job.detail = "대기열에 다시 추가되었습니다."; }
  else if (action === "start" && job.status === "queued") { job.priority = Math.max(1, ...db.jobs.map((item) => item.priority || 0)) + 1; job.detail = "대기열 맨 앞 실행을 요청했습니다."; }
  else if (action === "cancel" && ["queued", "paused", "processing"].includes(job.status)) { job.status = "cancelled"; job.detail = "취소 요청을 받았습니다. 현재 페이지·슬라이드가 끝나면 정리합니다. 기존 색인은 유지됩니다."; job.completedAt = new Date().toISOString(); }
  else return res.status(409).json({ error: "현재 상태에서는 이 명령을 실행할 수 없습니다." });
  await writeDb(db); if (["resume", "start"].includes(action)) void runQueue(); res.json({ job });
});
app.get("/api/documents/:id/original", async (req, res) => { const db = await readDb(); const doc = db.documents.find((item) => item.id === req.params.id); if (!doc || doc.sourceStatus !== "available") return res.status(404).json({ error: "원본을 사용할 수 없습니다." }); res.download(doc.originalPath, doc.name); });
app.get("/api/documents/:id/visual/:name", async (req, res) => {
  const db = await readDb(); const doc = db.documents.find((item) => item.id === req.params.id); const name = path.basename(req.params.name);
  if (!doc || doc.format !== "PPTX" || doc.sourceStatus !== "available" || !doc.units.some((unit) => unit.visualAssetName === name)) return res.status(404).end();
  try { const zip = await JSZip.loadAsync(await fs.readFile(doc.originalPath)); const asset = zip.file(`ppt/media/${name}`); if (!asset) return res.status(404).end(); const mime = name.match(/\.png$/i) ? "image/png" : name.match(/\.webp$/i) ? "image/webp" : "image/jpeg"; res.type(mime).send(await asset.async("nodebuffer")); } catch { res.status(422).end(); }
});
app.delete("/api/data", async (req, res) => {
  const db = await readDb(); if (activeJobs(db).length || db.maintenance) return res.status(409).json({ error: "Processing Queue가 비어 있고 Maintenance 작업이 없어야 합니다." });
  if (req.get("x-weki-confirmation") !== "DELETE ALL DOCUMENTS") return res.status(400).json({ error: "확인 문구가 일치하지 않습니다." });
  db.maintenance = { type: "delete-all", startedAt: new Date().toISOString() }; await writeDb(db);
  try { await fs.rm(originalsDir, { recursive: true, force: true }); await fs.rm(incomingDir, { recursive: true, force: true }); await fs.mkdir(originalsDir, { recursive: true }); await fs.mkdir(incomingDir, { recursive: true }); const cleared = { documents: [], jobs: [], synonyms: db.synonyms, feedback: db.feedback, audit: [{ id: crypto.randomUUID(), type: "delete-all", detail: "all document data deleted", createdAt: new Date().toISOString() }], maintenance: null }; await writeDb(cleared); res.status(204).end(); } catch (error) { db.maintenance = null; await writeDb(db); res.status(500).json({ error: "전체 데이터 삭제에 실패했습니다.", detail: error.message }); }
});
app.delete("/api/documents/:id", async (req, res) => { const db = await readDb(); if (db.maintenance) return res.status(409).json({ error: "Maintenance 작업 중에는 문서를 삭제할 수 없습니다." }); const doc = db.documents.find((item) => item.id === req.params.id); if (!doc) return res.status(404).json({ error: "문서를 찾을 수 없습니다." }); if (activeJobs(db).some((job) => job.documentId === doc.id)) return res.status(409).json({ error: "이 문서는 처리 작업이 끝난 뒤 삭제할 수 있습니다." }); db.documents = db.documents.filter((item) => item !== doc); await writeDb(db); if (doc.originalPath) await fs.unlink(doc.originalPath).catch(() => {}); res.status(204).end(); });

const vite = await createViteServer({ root, server: { middlewareMode: true } });
app.use(vite.middlewares);
await recoverInterruptedJobs();
app.listen(5173, "127.0.0.1", () => { console.log("Weki is running at http://127.0.0.1:5173"); void runQueue(); });
