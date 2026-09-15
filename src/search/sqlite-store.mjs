import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { compactKoreanSpacing, hasRequiredSearchTerms, matchesRouteConstraints, normalizeSearchText, searchTermVariants } from "./query-normalization.mjs";

const require = createRequire(import.meta.url);
let BetterSqlite3 = null;
try { BetterSqlite3 = require("better-sqlite3"); } catch { /* Node's built-in sqlite remains the development fallback. */ }

const SCHEMA_VERSION = 3;

function clean(value) {
  return value === undefined || value === null ? "" : String(value);
}

function indexableText(value) {
  const raw = normalizeSearchText(value);
  const compact = compactKoreanSpacing(raw);
  return [...new Set([raw, compact].filter(Boolean))].join(" ");
}

function generatedMetadataJson(value) {
  return value && typeof value === "object" ? JSON.stringify(value) : null;
}

function parseGeneratedMetadata(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function vectorBlob(vector = []) {
  const values = Array.isArray(vector) || ArrayBuffer.isView(vector) ? Array.from(vector) : [];
  return Buffer.from(Float32Array.from(values).buffer);
}

function vectorFromBlob(blob) {
  if (!blob) return null;
  try {
    const bytes = Buffer.from(blob);
    if (bytes.byteLength % 4 !== 0) return null;
    return Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4));
  } catch {
    return null;
  }
}

function structuredSearchFields(unit = {}) {
  const structured = unit.structured && typeof unit.structured === "object" ? unit.structured : {};
  const table = unit.table || structured.table || null;
  const chart = unit.chart || structured.chart || (unit.type === "chart" ? structured : null);
  const tableCells = Array.isArray(table?.cells)
    ? table.cells.map((cell) => cell?.value).filter((value) => value !== undefined && value !== null && String(value).trim())
    : Array.isArray(table?.rows) ? table.rows.flatMap((row) => (Array.isArray(row) ? row : [row])).filter((value) => value !== undefined && value !== null && String(value).trim()) : [];
  const series = Array.isArray(chart?.series) ? chart.series : [];
  return {
    textSource: clean(unit.textSource || unit.origin || ""),
    confidence: Number.isFinite(Number(unit.confidence)) ? Math.max(0, Math.min(1, Number(unit.confidence))) : null,
    caption: clean(unit.caption),
    chartTitle: clean(chart?.title),
    chartSeries: series.flatMap((item) => [item?.name, ...(item?.values || [])]).filter((value) => value !== undefined && value !== null && String(value).trim()).join(" "),
    chartCategory: [ ...(chart?.categories || []), ...series.flatMap((item) => item?.categories || []) ].filter((value) => value !== undefined && value !== null && String(value).trim()).join(" "),
    chartValue: series.flatMap((item) => item?.values || []).filter((value) => value !== undefined && value !== null && String(value).trim()).join(" "),
    tableCell: tableCells.filter(Boolean).join(" "),
  };
}

function evidenceMetadataJson(fragment = {}) {
  if (!(fragment.metadata || fragment.structured || fragment.diagnostics || fragment.sourceRef || fragment.caption)) return null;
  return JSON.stringify({ structured: fragment.structured || null, diagnostics: fragment.diagnostics || [], sourceRef: fragment.sourceRef || null, caption: fragment.caption || "" });
}

export function ftsLiteral(query) {
  return normalizeSearchText(query).split(/\s+/u).filter(Boolean)
      .map((token) => token.replace(/^(\p{N}+(?:-\p{N})*)번$/u, "$1"))
    .map((token) => `"${token.replaceAll('"', "")}"`).join(" AND ");
}

export function ftsPrefixLiteral(query) {
  return normalizeSearchText(query).split(/\s+/u).filter(Boolean)
    .map((token) => `"${token.replaceAll('"', "")}"*`).join(" AND ");
}

export function createSearchStore({ directory, filename = "knowledge-base.sqlite" }) {
  fs.mkdirSync(directory, { recursive: true });
  const dbPath = path.join(directory, filename);
  const db = BetterSqlite3 ? new BetterSqlite3(dbPath) : new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      format TEXT,
      created_at TEXT,
      modified_at TEXT,
      accessed_at TEXT,
      source_hash TEXT,
      source_status TEXT NOT NULL DEFAULT 'unavailable',
      cloud_original_file TEXT
    );
    CREATE TABLE IF NOT EXISTS evidence_fragments (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      page_start INTEGER NOT NULL,
      page_end INTEGER NOT NULL,
      type TEXT NOT NULL,
      origin TEXT,
      asset_name TEXT,
      context TEXT NOT NULL DEFAULT '',
      confidence REAL,
      metadata_json TEXT
    );
    CREATE TABLE IF NOT EXISTS knowledge_units (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      heading TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      native_text TEXT NOT NULL DEFAULT '',
      ocr_text TEXT NOT NULL DEFAULT '',
      generated_metadata TEXT,
      search_auxiliary_text TEXT NOT NULL DEFAULT '',
      source_range TEXT NOT NULL DEFAULT '',
      text_source TEXT,
      confidence REAL,
      caption TEXT NOT NULL DEFAULT '',
      chart_title TEXT NOT NULL DEFAULT '',
      chart_series TEXT NOT NULL DEFAULT '',
      chart_category TEXT NOT NULL DEFAULT '',
      chart_value TEXT NOT NULL DEFAULT '',
      table_cell TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS unit_evidence_refs (
      unit_id TEXT NOT NULL REFERENCES knowledge_units(id) ON DELETE CASCADE,
      evidence_id TEXT NOT NULL REFERENCES evidence_fragments(id) ON DELETE CASCADE,
      PRIMARY KEY(unit_id, evidence_id)
    );
    CREATE TABLE IF NOT EXISTS embeddings (
      unit_id TEXT PRIMARY KEY REFERENCES knowledge_units(id) ON DELETE CASCADE,
      dimension INTEGER NOT NULL,
      vector_json TEXT NOT NULL,
      vector_blob BLOB,
      model TEXT,
      generation TEXT
    );
    CREATE TABLE IF NOT EXISTS search_sessions (
      id TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      ranking_version TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS search_results (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES search_sessions(id) ON DELETE CASCADE,
      unit_id TEXT NOT NULL REFERENCES knowledge_units(id) ON DELETE CASCADE,
      rank INTEGER NOT NULL,
      score REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS search_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES search_sessions(id) ON DELETE CASCADE,
      result_id TEXT NOT NULL REFERENCES search_results(id) ON DELETE CASCADE,
      unit_id TEXT NOT NULL REFERENCES knowledge_units(id) ON DELETE CASCADE,
      rank INTEGER NOT NULL,
      ranking_version TEXT NOT NULL,
      helpful INTEGER NOT NULL CHECK(helpful IN (0, 1)),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS index_state (
      name TEXT PRIMARY KEY,
      generation TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ready',
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_document_page ON evidence_fragments(document_id, page_start, id);
    CREATE INDEX IF NOT EXISTS idx_units_document ON knowledge_units(document_id, id);
    CREATE INDEX IF NOT EXISTS idx_unit_evidence_unit ON unit_evidence_refs(unit_id, evidence_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      unit_id UNINDEXED,
      document_id UNINDEXED,
      title,
      heading,
      text,
      native_text,
      ocr_text,
      search_auxiliary_text,
      caption,
      chart_title,
      chart_series,
      chart_category,
      chart_value,
      table_cell,
      tokenize='unicode61 remove_diacritics 2'
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_trigram USING fts5(
      unit_id UNINDEXED,
      text,
      tokenize='trigram'
    );
    PRAGMA user_version = ${SCHEMA_VERSION};
  `);
  try { db.exec("ALTER TABLE documents ADD COLUMN accessed_at TEXT"); } catch { /* Existing v2 stores already have the column. */ }
  try { db.exec("ALTER TABLE documents ADD COLUMN source_status TEXT NOT NULL DEFAULT 'unavailable'"); } catch { /* Existing v2 stores already have the column. */ }
  try { db.exec("ALTER TABLE documents ADD COLUMN cloud_original_file TEXT"); } catch { /* Existing v2 stores already have the column. */ }
  try { db.exec("ALTER TABLE evidence_fragments ADD COLUMN confidence REAL"); } catch { /* Existing stores already have the column. */ }
  try { db.exec("ALTER TABLE evidence_fragments ADD COLUMN metadata_json TEXT"); } catch { /* Existing stores already have the column. */ }
  try { db.exec("ALTER TABLE knowledge_units ADD COLUMN generated_metadata TEXT"); } catch { /* Existing v2 stores already have the column. */ }
  try { db.exec("ALTER TABLE knowledge_units ADD COLUMN search_auxiliary_text TEXT NOT NULL DEFAULT ''"); } catch { /* Existing v2 stores already have the column. */ }
  try { db.exec("ALTER TABLE knowledge_units ADD COLUMN text_source TEXT"); } catch { /* Existing stores already have the column. */ }
  try { db.exec("ALTER TABLE knowledge_units ADD COLUMN confidence REAL"); } catch { /* Existing stores already have the column. */ }
  try { db.exec("ALTER TABLE knowledge_units ADD COLUMN caption TEXT NOT NULL DEFAULT ''"); } catch { /* Existing stores already have the column. */ }
  try { db.exec("ALTER TABLE knowledge_units ADD COLUMN chart_title TEXT NOT NULL DEFAULT ''"); } catch { /* Existing stores already have the column. */ }
  try { db.exec("ALTER TABLE knowledge_units ADD COLUMN chart_series TEXT NOT NULL DEFAULT ''"); } catch { /* Existing stores already have the column. */ }
  try { db.exec("ALTER TABLE knowledge_units ADD COLUMN chart_category TEXT NOT NULL DEFAULT ''"); } catch { /* Existing stores already have the column. */ }
  try { db.exec("ALTER TABLE knowledge_units ADD COLUMN chart_value TEXT NOT NULL DEFAULT ''"); } catch { /* Existing stores already have the column. */ }
  try { db.exec("ALTER TABLE knowledge_units ADD COLUMN table_cell TEXT NOT NULL DEFAULT ''"); } catch { /* Existing stores already have the column. */ }
  try { db.exec("ALTER TABLE embeddings ADD COLUMN vector_blob BLOB"); } catch { /* Existing stores already have the column. */ }
  const ftsColumns = db.prepare("PRAGMA table_info(knowledge_fts)").all().map((column) => column.name);
  const requiredFtsColumns = ["search_auxiliary_text", "caption", "chart_title", "chart_series", "chart_category", "chart_value", "table_cell"];
  if (requiredFtsColumns.some((column) => !ftsColumns.includes(column))) {
    db.exec(`DROP TABLE knowledge_fts; CREATE VIRTUAL TABLE knowledge_fts USING fts5(
      unit_id UNINDEXED, document_id UNINDEXED, title, heading, text, native_text, ocr_text,
      search_auxiliary_text, caption, chart_title, chart_series, chart_category, chart_value, table_cell,
      tokenize='unicode61 remove_diacritics 2'
    );`);
    const migrateFts = db.prepare(`INSERT INTO knowledge_fts(unit_id, document_id, title, heading, text, native_text, ocr_text, search_auxiliary_text, caption, chart_title, chart_series, chart_category, chart_value, table_cell)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const unit of db.prepare("SELECT id, document_id, title, heading, text, native_text, ocr_text, search_auxiliary_text, caption, chart_title, chart_series, chart_category, chart_value, table_cell FROM knowledge_units").all()) {
      migrateFts.run(unit.id, unit.document_id, indexableText(unit.title), indexableText(unit.heading), indexableText(unit.text), indexableText(unit.native_text), indexableText(unit.ocr_text), indexableText(unit.search_auxiliary_text), indexableText(unit.caption), indexableText(unit.chart_title), indexableText(unit.chart_series), indexableText(unit.chart_category), indexableText(unit.chart_value), indexableText(unit.table_cell));
    }
  }

  const statements = {
    document: db.prepare(`INSERT INTO documents(id, name, format, created_at, modified_at, accessed_at, source_hash, source_status, cloud_original_file)
      VALUES(@id, @name, @format, @createdAt, @modifiedAt, @accessedAt, @sourceHash, @sourceStatus, @cloudOriginalFile)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, format=excluded.format,
      created_at=excluded.created_at, modified_at=excluded.modified_at, accessed_at=excluded.accessed_at, source_hash=excluded.source_hash,
      source_status=excluded.source_status, cloud_original_file=excluded.cloud_original_file`),
    evidence: db.prepare(`INSERT INTO evidence_fragments(id, document_id, page_start, page_end, type, origin, asset_name, context, confidence, metadata_json)
      VALUES(@id, @documentId, @pageStart, @pageEnd, @type, @origin, @assetName, @context, @confidence, @metadataJson)
      ON CONFLICT(id) DO UPDATE SET page_start=excluded.page_start, page_end=excluded.page_end,
      type=excluded.type, origin=excluded.origin, asset_name=excluded.asset_name, context=excluded.context, confidence=excluded.confidence, metadata_json=excluded.metadata_json`),
    unit: db.prepare(`INSERT INTO knowledge_units(id, document_id, title, heading, text, native_text, ocr_text, generated_metadata, search_auxiliary_text, source_range, text_source, confidence, caption, chart_title, chart_series, chart_category, chart_value, table_cell)
      VALUES(@id, @documentId, @title, @heading, @text, @nativeText, @ocrText, @generatedMetadata, @searchAuxiliaryText, @sourceRange, @textSource, @confidence, @caption, @chartTitle, @chartSeries, @chartCategory, @chartValue, @tableCell)
      ON CONFLICT(id) DO UPDATE SET document_id=excluded.document_id, title=excluded.title,
      heading=excluded.heading, text=excluded.text, native_text=excluded.native_text,
      ocr_text=excluded.ocr_text, generated_metadata=excluded.generated_metadata,
      search_auxiliary_text=excluded.search_auxiliary_text, source_range=excluded.source_range, text_source=excluded.text_source,
      confidence=excluded.confidence, caption=excluded.caption, chart_title=excluded.chart_title, chart_series=excluded.chart_series,
      chart_category=excluded.chart_category, chart_value=excluded.chart_value, table_cell=excluded.table_cell`),
    deleteFts: db.prepare("DELETE FROM knowledge_fts WHERE unit_id = ?"),
    insertFts: db.prepare(`INSERT INTO knowledge_fts(unit_id, document_id, title, heading, text, native_text, ocr_text, search_auxiliary_text, caption, chart_title, chart_series, chart_category, chart_value, table_cell)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    deleteTrigram: db.prepare("DELETE FROM knowledge_trigram WHERE unit_id = ?"),
    insertTrigram: db.prepare("INSERT INTO knowledge_trigram(unit_id, text) VALUES(?, ?)"),
    unlinkEvidence: db.prepare("DELETE FROM unit_evidence_refs WHERE unit_id = ?"),
    linkEvidence: db.prepare("INSERT OR IGNORE INTO unit_evidence_refs(unit_id, evidence_id) VALUES(?, ?)"),
    embedding: db.prepare(`INSERT INTO embeddings(unit_id, dimension, vector_json, vector_blob, model, generation) VALUES(?, ?, ?, ?, ?, ?)
      ON CONFLICT(unit_id) DO UPDATE SET dimension=excluded.dimension, vector_json=excluded.vector_json, vector_blob=excluded.vector_blob, model=excluded.model, generation=excluded.generation`),
    search: db.prepare(`SELECT f.unit_id AS unitId, f.document_id AS documentId, d.format,
      d.created_at AS createdAt, d.modified_at AS modifiedAt, d.accessed_at AS accessedAt,
      f.title, f.heading, f.text, f.native_text AS nativeText, f.ocr_text AS ocrText,
      f.search_auxiliary_text AS searchAuxiliaryText, f.caption, f.chart_title AS chartTitle, f.chart_series AS chartSeries,
      f.chart_category AS chartCategory, f.chart_value AS chartValue, f.table_cell AS tableCell,
      bm25(knowledge_fts, 0.0, 0.0, 8.0, 5.0, 3.0, 2.0, 1.5, 1.0, 3.0, 4.0, 3.0, 3.0, 3.0, 3.0) AS bm25
      FROM knowledge_fts f JOIN documents d ON d.id = f.document_id
      WHERE knowledge_fts MATCH @query ORDER BY bm25 LIMIT @limit`),
    trigramSearch: db.prepare(`SELECT t.unit_id AS unitId, u.document_id AS documentId, d.format,
      d.created_at AS createdAt, d.modified_at AS modifiedAt, d.accessed_at AS accessedAt,
      u.title, u.heading, u.text, u.native_text AS nativeText, u.ocr_text AS ocrText,
      u.search_auxiliary_text AS searchAuxiliaryText, u.caption, u.chart_title AS chartTitle, u.chart_series AS chartSeries,
      u.chart_category AS chartCategory, u.chart_value AS chartValue, u.table_cell AS tableCell, 0.0 AS bm25
      FROM knowledge_trigram t JOIN knowledge_units u ON u.id = t.unit_id JOIN documents d ON d.id = u.document_id
      WHERE knowledge_trigram MATCH @query LIMIT @limit`),
    hydrate: db.prepare(`SELECT u.id AS unitId, u.document_id AS documentId, d.name AS documentName, d.format,
      d.source_status AS sourceStatus, d.cloud_original_file AS cloudOriginalFile,
      u.title, u.heading, u.text, u.native_text AS nativeText, u.ocr_text AS ocrText,
      u.generated_metadata AS generatedMetadataJson, u.search_auxiliary_text AS searchAuxiliaryText, u.text_source AS textSource, u.confidence,
      u.caption, u.chart_title AS chartTitle, u.chart_series AS chartSeries, u.chart_category AS chartCategory, u.chart_value AS chartValue, u.table_cell AS tableCell,
      u.source_range AS sourceRange, e.id AS evidenceId, e.page_start AS pageStart,
      e.page_end AS pageEnd, e.type, e.origin, e.asset_name AS assetName, e.context, e.confidence AS evidenceConfidence, e.metadata_json AS evidenceMetadataJson
      FROM knowledge_units u JOIN documents d ON d.id = u.document_id
      LEFT JOIN unit_evidence_refs r ON r.unit_id = u.id
      LEFT JOIN evidence_fragments e ON e.id = r.evidence_id
      WHERE u.id IN (SELECT value FROM json_each(@ids)) ORDER BY u.id, e.page_start, e.id`),
    health: db.prepare("SELECT name, generation, revision, status FROM index_state"),
    setIndex: db.prepare(`INSERT INTO index_state(name, generation, revision, status, updated_at)
      VALUES(@name, @generation, @revision, @status, @updatedAt)
      ON CONFLICT(name) DO UPDATE SET generation=excluded.generation, revision=excluded.revision,
      status=excluded.status, updated_at=excluded.updated_at`),
    sourceStatus: db.prepare(`UPDATE documents SET source_status = @sourceStatus,
      cloud_original_file = @cloudOriginalFile WHERE id = @id`),
  };

  function transaction(callback) {
    db.exec("BEGIN IMMEDIATE");
    try { const value = callback(); db.exec("COMMIT"); return value; }
    catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  }

  function upsertDocument(document) {
    statements.document.run({ id: clean(document.id), name: clean(document.name), format: clean(document.format),
      createdAt: document.createdAt ?? null, modifiedAt: document.modifiedAt ?? null, accessedAt: document.accessedAt ?? null, sourceHash: document.sourceHash ?? document.hash ?? null,
      sourceStatus: clean(document.sourceStatus || "unavailable"), cloudOriginalFile: document.cloudOriginalFile ?? null });
  }

  function updateDocumentSource(document) {
    const id = clean(document?.id);
    if (!id) return false;
    const result = statements.sourceStatus.run({
      id,
      sourceStatus: clean(document?.sourceStatus || "unavailable"),
      cloudOriginalFile: document?.cloudOriginalFile ?? null,
    });
    return result.changes > 0;
  }

  function upsertEvidenceFragment(fragment) {
    statements.evidence.run({ id: clean(fragment.id), documentId: clean(fragment.documentId), pageStart: Number(fragment.pageStart) || 1,
      pageEnd: Number(fragment.pageEnd) || Number(fragment.pageStart) || 1, type: clean(fragment.type) || "text", origin: fragment.origin ?? null,
      assetName: fragment.assetName ?? null, context: clean(fragment.context),
      confidence: Number.isFinite(Number(fragment.confidence)) ? Math.max(0, Math.min(1, Number(fragment.confidence))) : null,
      metadataJson: evidenceMetadataJson(fragment) });
  }

  function upsertKnowledgeUnit(unit) {
    const text = clean(unit.text);
    const fields = structuredSearchFields(unit);
    transaction(() => {
      statements.unit.run({ id: clean(unit.id), documentId: clean(unit.documentId), title: clean(unit.title), heading: clean(unit.heading),
        text, nativeText: clean(unit.nativeText), ocrText: clean(unit.ocrText), generatedMetadata: generatedMetadataJson(unit.generatedMetadata),
        searchAuxiliaryText: clean(unit.searchAuxiliaryText), sourceRange: typeof unit.sourceRange === "string" ? unit.sourceRange : JSON.stringify(unit.sourceRange ?? {}), ...fields });
      statements.deleteFts.run(clean(unit.id));
      statements.insertFts.run(clean(unit.id), clean(unit.documentId), indexableText(unit.title), indexableText(unit.heading), indexableText(text), indexableText(unit.nativeText), indexableText(unit.ocrText), indexableText(unit.searchAuxiliaryText),
        indexableText(fields.caption), indexableText(fields.chartTitle), indexableText(fields.chartSeries), indexableText(fields.chartCategory), indexableText(fields.chartValue), indexableText(fields.tableCell));
      statements.deleteTrigram.run(clean(unit.id));
      statements.insertTrigram.run(clean(unit.id), indexableText(`${clean(unit.title)} ${clean(unit.heading)} ${text} ${clean(unit.nativeText)} ${clean(unit.ocrText)} ${clean(unit.searchAuxiliaryText)} ${fields.caption} ${fields.chartTitle} ${fields.chartSeries} ${fields.chartCategory} ${fields.chartValue} ${fields.tableCell}`));
      statements.unlinkEvidence.run(clean(unit.id));
      for (const evidenceId of unit.evidenceIds || []) statements.linkEvidence.run(clean(unit.id), clean(evidenceId));
    });
  }

  function searchLexical(query, { limit = 200, filters = {} } = {}) {
    const normalizedQuery = normalizeSearchText(query);
    const match = ftsLiteral(normalizedQuery);
    if (!match) return [];
    const maxRows = Math.min(200, Math.max(1, Number(limit) || 200));
    let rows = statements.search.all({ query: match, limit: maxRows });
    if (!rows.length) {
      const terms = normalizedQuery.split(/\s+/u).filter(Boolean);
      const fallbackRows = [];
      const known = new Set();
      const compactQuery = compactKoreanSpacing(normalizedQuery);
      if (compactQuery !== normalizedQuery) {
        for (const row of statements.search.all({ query: ftsLiteral(compactQuery), limit: maxRows })) {
          if (!known.has(row.unitId)) { fallbackRows.push(row); known.add(row.unitId); }
        }
      }
      for (const term of terms) {
        for (const variant of searchTermVariants(term)) {
          const variantQuery = variant === term ? ftsLiteral(variant) : ftsPrefixLiteral(variant);
          for (const row of statements.search.all({ query: variantQuery, limit: maxRows })) {
            if (!known.has(row.unitId)) { fallbackRows.push(row); known.add(row.unitId); }
          }
        }
        if (fallbackRows.length >= maxRows) break;
      }
      rows = fallbackRows.slice(0, maxRows);
    }
    if (rows.length < maxRows && clean(query).trim().length >= 3) {
      const known = new Set(rows.map((row) => row.unitId));
      const trigramRows = statements.trigramSearch.all({ query: match, limit: maxRows });
      for (const row of trigramRows) if (!known.has(row.unitId)) { rows.push(row); known.add(row.unitId); }
    }
    if (filters?.format?.length) {
      const formats = new Set(filters.format.map((value) => String(value).toLowerCase()));
      rows = rows.filter((row) => formats.has(String(row.format || "").toLowerCase()));
    }
    const criterion = filters?.dateCriterion === "created" ? "createdAt" : filters?.dateCriterion === "accessed" ? "accessedAt" : "modifiedAt";
    if (filters?.from) rows = rows.filter((row) => row[criterion] && String(row[criterion]) >= filters.from);
    if (filters?.to) rows = rows.filter((row) => row[criterion] && String(row[criterion]).slice(0, 10) <= filters.to);
    const searchValues = (row) => [row.title, row.heading, row.text, row.nativeText, row.ocrText, row.searchAuxiliaryText, row.caption, row.chartTitle, row.chartSeries, row.chartCategory, row.chartValue, row.tableCell];
    rows = rows.filter((row) => matchesRouteConstraints(normalizedQuery, searchValues(row)));
    rows = rows.filter((row) => hasRequiredSearchTerms(normalizedQuery, searchValues(row)));
    return rows.map((row, index) => ({ ...row, engine: "fts", score: 1 / (index + 1) }));
  }

  function getDocumentFormat(documentId) { return db.prepare("SELECT format FROM documents WHERE id = ?").get(documentId)?.format; }

  function hydrateUnits(unitIds) {
    const ids = [...new Set((unitIds || []).map(String).filter(Boolean))];
    if (!ids.length) return [];
    const grouped = new Map();
    for (const row of statements.hydrate.all({ ids: JSON.stringify(ids) })) {
      if (!grouped.has(row.unitId)) grouped.set(row.unitId, { unitId: row.unitId, documentId: row.documentId, documentName: row.documentName,
        format: row.format, sourceStatus: row.sourceStatus || "unavailable", cloudOriginalFile: row.cloudOriginalFile || null, title: row.title,
        heading: [row.heading, row.searchAuxiliaryText].filter(Boolean).join(" "), text: row.text, nativeText: row.nativeText, ocrText: row.ocrText,
        generatedMetadata: parseGeneratedMetadata(row.generatedMetadataJson), searchAuxiliaryText: row.searchAuxiliaryText, sourceRange: row.sourceRange,
        textSource: row.textSource || "native", confidence: row.confidence, caption: row.caption,
        structured: { chart: row.chartTitle || row.chartSeries || row.chartCategory || row.chartValue ? {
          title: row.chartTitle, series: row.chartSeries ? [{ name: row.chartSeries, values: row.chartValue ? row.chartValue.split(/\s+/u).filter(Boolean) : [] }] : [],
          categories: row.chartCategory ? row.chartCategory.split(/\s+/u).filter(Boolean) : [],
        } : null, table: row.tableCell ? { cells: row.tableCell.split(/\s+/u).filter(Boolean).map((value) => ({ value })) } : null }, evidence: [] });
      if (row.evidenceId) {
        const evidence = { id: row.evidenceId, pageStart: row.pageStart, pageEnd: row.pageEnd,
          type: row.type, origin: row.origin, assetName: row.assetName, context: row.context, ...parseJson(row.evidenceMetadataJson, {}) };
        if (row.evidenceConfidence !== null && row.evidenceConfidence !== undefined) evidence.confidence = row.evidenceConfidence;
        grouped.get(row.unitId).evidence.push(evidence);
      }
    }
    return ids.map((id) => grouped.get(id)).filter(Boolean);
  }

  function upsertEmbedding(embedding) {
    const vector = Array.isArray(embedding.vector) || ArrayBuffer.isView(embedding.vector) ? Array.from(embedding.vector) : [];
    statements.embedding.run(clean(embedding.unitId), Number(embedding.dimension || vector.length || 0), JSON.stringify(vector), vectorBlob(vector), embedding.model ?? null, embedding.generation ?? null);
  }

  function deleteDocument(documentId) {
    const ids = db.prepare("SELECT id FROM knowledge_units WHERE document_id = ?").all(clean(documentId)).map((row) => row.id);
    transaction(() => {
      for (const id of ids) { statements.deleteFts.run(id); statements.deleteTrigram.run(id); }
      db.prepare("DELETE FROM documents WHERE id = ?").run(clean(documentId));
    });
  }

  function replaceDocumentIndex({ document, entries = [] }) {
    const documentId = clean(document?.id);
    if (!documentId) throw new Error("document id is required");
    const oldUnitIds = db.prepare("SELECT id FROM knowledge_units WHERE document_id = ?").all(documentId).map((row) => row.id);
    transaction(() => {
      for (const id of oldUnitIds) { statements.deleteFts.run(id); statements.deleteTrigram.run(id); }
      db.prepare("DELETE FROM documents WHERE id = ?").run(documentId);
      statements.document.run({ id: documentId, name: clean(document.name), format: clean(document.format),
        createdAt: document.createdAt ?? document.registeredAt ?? null, modifiedAt: document.modifiedAt ?? null, accessedAt: document.accessedAt ?? null,
        sourceHash: document.sourceHash ?? document.hash ?? null, sourceStatus: clean(document.sourceStatus || "unavailable"), cloudOriginalFile: document.cloudOriginalFile ?? null });
      for (const entry of entries) {
        const fragment = entry.evidence || {};
        statements.evidence.run({ id: clean(fragment.id), documentId, pageStart: Number(fragment.pageStart) || 1,
          pageEnd: Number(fragment.pageEnd) || Number(fragment.pageStart) || 1, type: clean(fragment.type) || "text", origin: fragment.origin ?? null,
          assetName: fragment.assetName ?? null, context: clean(fragment.context),
          confidence: Number.isFinite(Number(fragment.confidence)) ? Math.max(0, Math.min(1, Number(fragment.confidence))) : null,
          metadataJson: evidenceMetadataJson(fragment) });
        const unit = entry.unit || {};
        const unitId = clean(unit.id);
        const text = clean(unit.text);
        const fields = structuredSearchFields(unit);
        statements.unit.run({ id: unitId, documentId, title: clean(unit.title), heading: clean(unit.heading), text,
          nativeText: clean(unit.nativeText), ocrText: clean(unit.ocrText), generatedMetadata: generatedMetadataJson(unit.generatedMetadata),
          searchAuxiliaryText: clean(unit.searchAuxiliaryText), sourceRange: typeof unit.sourceRange === "string" ? unit.sourceRange : JSON.stringify(unit.sourceRange ?? {}), ...fields });
        statements.deleteFts.run(unitId);
        statements.insertFts.run(unitId, documentId, indexableText(unit.title), indexableText(unit.heading), indexableText(text), indexableText(unit.nativeText), indexableText(unit.ocrText), indexableText(unit.searchAuxiliaryText),
          indexableText(fields.caption), indexableText(fields.chartTitle), indexableText(fields.chartSeries), indexableText(fields.chartCategory), indexableText(fields.chartValue), indexableText(fields.tableCell));
        statements.deleteTrigram.run(unitId);
        statements.insertTrigram.run(unitId, indexableText(`${clean(unit.title)} ${clean(unit.heading)} ${text} ${clean(unit.nativeText)} ${clean(unit.ocrText)} ${clean(unit.searchAuxiliaryText)} ${fields.caption} ${fields.chartTitle} ${fields.chartSeries} ${fields.chartCategory} ${fields.chartValue} ${fields.tableCell}`));
        statements.unlinkEvidence.run(unitId);
        for (const evidenceId of unit.evidenceIds || []) statements.linkEvidence.run(unitId, clean(evidenceId));
        if (entry.embedding?.vector?.length) {
          const vector = Array.from(entry.embedding.vector);
          statements.embedding.run(unitId, Number(entry.embedding.dimension || vector.length), JSON.stringify(vector), vectorBlob(vector), entry.embedding.model ?? null, entry.embedding.generation ?? null);
        }
      }
    });
  }

  function listEmbeddings({ dimension = null, model = null, generation = null } = {}) {
    let sql = "SELECT unit_id AS unitId, dimension, vector_json AS vectorJson, vector_blob AS vectorBlob, model, generation FROM embeddings";
    const params = [];
    const conditions = [];
    if (dimension !== null) { conditions.push("dimension = ?"); params.push(Number(dimension)); }
    if (model) { conditions.push("model = ?"); params.push(String(model)); }
    if (generation) { conditions.push("generation = ?"); params.push(String(generation)); }
    if (conditions.length) sql += ` WHERE ${conditions.join(" AND ")}`;
    return db.prepare(sql).all(...params).map((row) => ({ ...row, vector: vectorFromBlob(row.vectorBlob) || parseJson(row.vectorJson, []) }));
  }

  function listEmbeddingIds({ dimension = null, model = null, generation = null } = {}) {
    let sql = "SELECT unit_id AS unitId, model, generation FROM embeddings";
    const params = [];
    const conditions = [];
    if (dimension !== null) { conditions.push("dimension = ?"); params.push(Number(dimension)); }
    if (model) { conditions.push("model = ?"); params.push(String(model)); }
    if (generation) { conditions.push("generation = ?"); params.push(String(generation)); }
    if (conditions.length) sql += ` WHERE ${conditions.join(" AND ")}`;
    return db.prepare(sql).all(...params);
  }

  function filterUnitIds(unitIds, filters = {}) {
    const ids = [...new Set((unitIds || []).map(String).filter(Boolean))];
    if (!ids.length) return new Set();
    const rows = db.prepare(`SELECT u.id AS unitId, d.format, d.created_at AS createdAt, d.modified_at AS modifiedAt, d.accessed_at AS accessedAt
      FROM knowledge_units u JOIN documents d ON d.id = u.document_id
      WHERE u.id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(ids));
    const formats = new Set((filters.format || []).map((value) => String(value).toLowerCase()));
    const criterion = filters.dateCriterion === "created" ? "createdAt" : filters.dateCriterion === "accessed" ? "accessedAt" : "modifiedAt";
    return new Set(rows.filter((row) => {
      if (formats.size && !formats.has(String(row.format || "").toLowerCase())) return false;
      if (filters.from && (!row[criterion] || String(row[criterion]) < filters.from)) return false;
      if (filters.to && (!row[criterion] || String(row[criterion]).slice(0, 10) > filters.to)) return false;
      return true;
    }).map((row) => String(row.unitId)));
  }

  function health() {
    let fts = "healthy";
    try { db.prepare("SELECT count(*) AS count FROM knowledge_fts").get(); } catch { fts = "unavailable"; }
    const state = Object.fromEntries(statements.health.all().map((row) => [row.name, row]));
    return { sqlite: "healthy", sqliteDriver: BetterSqlite3 ? "better-sqlite3" : "node:sqlite", fts, ann: state.ann?.status || "unavailable", model: state.model?.status || "unavailable", indexGeneration: state.fts?.generation || null };
  }

  function getIndexState(name) {
    return statements.health.all().find((row) => row.name === String(name)) || null;
  }

  function recordSearch({ sessionId = crypto.randomUUID(), query = "", results = [], rankingVersion = "unknown" }) {
    const createdAt = new Date().toISOString();
    transaction(() => {
      db.prepare(`INSERT INTO search_sessions(id, query, ranking_version, created_at) VALUES(?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET query=excluded.query, ranking_version=excluded.ranking_version`).run(sessionId, query, rankingVersion, createdAt);
      const insert = db.prepare(`INSERT OR REPLACE INTO search_results(id, session_id, unit_id, rank, score) VALUES(?, ?, ?, ?, ?)`);
      for (const row of results) insert.run(row.resultId, sessionId, row.unitId, Number(row.rank) || 0, Number(row.relevanceScore) || 0);
    });
    return sessionId;
  }

  function recordFeedback(feedback) {
    db.prepare(`INSERT INTO search_feedback(session_id, result_id, unit_id, rank, ranking_version, helpful, created_at)
      VALUES(@sessionId, @resultId, @unitId, @rank, @rankingVersion, @helpful, @createdAt)`).run({
      sessionId: clean(feedback.sessionId), resultId: clean(feedback.resultId), unitId: clean(feedback.unitId), rank: Number(feedback.rank) || 0,
      rankingVersion: clean(feedback.rankingVersion), helpful: feedback.helpful ? 1 : 0, createdAt: new Date().toISOString(),
    });
  }

  return {
    dbPath,
    transaction,
    upsertDocument,
    updateDocumentSource,
    upsertEvidenceFragment,
    upsertKnowledgeUnit,
    upsertEmbedding,
    deleteDocument,
    replaceDocumentIndex,
    listEmbeddings,
    listEmbeddingIds,
    filterUnitIds,
    searchLexical,
    hydrateUnits,
    setIndexState: (state) => statements.setIndex.run({ name: clean(state.name), generation: clean(state.generation), revision: Number(state.revision) || 0, status: clean(state.status) || "ready", updatedAt: new Date().toISOString() }),
    getIndexState,
    recordSearch,
    recordFeedback,
    health,
    close: () => {
      try { db.exec("PRAGMA wal_checkpoint(TRUNCATE);"); } catch { /* The database may already be closing. */ }
      db.close();
    },
  };
}

export async function ensureSearchDirectory(directory) {
  await fsp.mkdir(directory, { recursive: true });
  return directory;
}
