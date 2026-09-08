import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeSearchRequest,
  reciprocalRankFusion,
  diversifyResults,
  selectEvidence,
  cosineSimilarity,
} from "../src/search/retrieval.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSearchStore, ftsLiteral } from "../src/search/sqlite-store.mjs";
import { createSearchService } from "../src/search/service.mjs";

test("normalizes v2 search requests deterministically", () => {
  assert.deepEqual(normalizeSearchRequest({
    query: "  버스   시간표 ",
    cursor: " 3 ",
    filters: { format: ["PDF", "pdf"], from: "2024-01-01", to: "bad" },
  }), {
    query: "버스 시간표",
    cursor: "3",
    sessionId: null,
    filters: { format: ["pdf"], dateCriterion: "modified", from: "2024-01-01", to: null },
  });
});

test("normalizes route-like query spacing without hardcoding a route number", () => {
  assert.equal(normalizeSearchRequest({ query: "  12  -  3번   변경구간 " }).query, "12-3번 변경구간");
  assert.equal(normalizeSearchRequest({ query: "  12 – 3번   변경구간 " }).query, "12-3번 변경구간");
});

test("escapes FTS literals instead of interpreting query operators", () => {
  assert.equal(ftsLiteral('버스 "시간표"'), '"버스" AND "시간표"');
  assert.equal(ftsLiteral("12-3번 변경구간"), '"12-3" AND "변경구간"');
  assert.equal(ftsLiteral("109번 우회경로"), '"109" AND "우회경로"');
});

test("keeps a route result when a natural-language qualifier is absent from the source text", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "weki-search-route-recall-"));
  const store = createSearchStore({ directory });
  store.upsertDocument({ id: "route-doc", name: "노선 안내.hwp", format: "hwp" });
  store.upsertEvidenceFragment({ id: "route-evidence", documentId: "route-doc", pageStart: 3, pageEnd: 3, type: "text", origin: "native", context: "돌산권 노선 목록: 12-3" });
  store.upsertKnowledgeUnit({ id: "route-unit", documentId: "route-doc", title: "노선 안내", text: "돌산권 노선 목록: 12-3", evidenceIds: ["route-evidence"] });
  assert.equal(store.searchLexical("12-3번 변경구간")[0].unitId, "route-unit");
  store.upsertEvidenceFragment({ id: "route-evidence-109", documentId: "route-doc", pageStart: 4, pageEnd: 4, type: "visual", origin: "ocr", context: "대상노선: 109" });
  store.upsertKnowledgeUnit({ id: "route-unit-109", documentId: "route-doc", title: "노선 안내", text: "대상노선: 109", ocrText: "대상노선: 109", evidenceIds: ["route-evidence-109"] });
  assert.equal(store.searchLexical("109번 우회경로")[0].unitId, "route-unit-109");
  store.close();
  await rm(directory, { recursive: true, force: true });
});

test("does not confuse a numeric route with a longer route number", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "weki-search-route-boundary-"));
  const store = createSearchStore({ directory });
  for (const [id, text] of [["route-1090", "1090번 우회경로"], ["route-109-10", "109-10번 우회경로"], ["route-109", "109번 우회경로"], ["route-109-1", "109-1번 우회경로"]]) {
    store.upsertDocument({ id, name: id, format: "hwp" });
    store.upsertEvidenceFragment({ id: `${id}-evidence`, documentId: id, pageStart: 1, pageEnd: 1, type: "text", origin: "native", context: text });
    store.upsertKnowledgeUnit({ id, documentId: id, title: id, text, nativeText: text, sourceRange: 1, evidenceIds: [`${id}-evidence`] });
  }
  assert.deepEqual(store.searchLexical("109번 우회경로").map((row) => row.unitId), ["route-109"]);
  assert.deepEqual(store.searchLexical("109-1번 우회경로").map((row) => row.unitId), ["route-109-1"]);
  store.close();
  await rm(directory, { recursive: true, force: true });
});

test("recovers Korean spacing and common particle variants", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "weki-search-korean-variants-"));
  const store = createSearchStore({ directory });
  store.upsertDocument({ id: "korean-doc", name: "버스 안내.hwp", format: "hwp" });
  store.upsertEvidenceFragment({ id: "korean-evidence", documentId: "korean-doc", pageStart: 1, pageEnd: 1, type: "text", origin: "native", context: "시내버스 우회운행과 OO시 인구는 증가했습니다." });
  store.upsertKnowledgeUnit({ id: "korean-unit", documentId: "korean-doc", title: "버스 안내", text: "시내버스 우회운행과 OO시 인구는 증가했습니다.", evidenceIds: ["korean-evidence"] });
  assert.equal(store.searchLexical("시내 버스")[0].unitId, "korean-unit");
  assert.equal(store.searchLexical("인구가")[0].unitId, "korean-unit");
  store.close();
  await rm(directory, { recursive: true, force: true });
});

test("matches spaced Korean OCR keywords while requiring every content term", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "weki-search-ocr-spacing-"));
  const store = createSearchStore({ directory });
  const rows = [
    ["correct-unit", "시 외 버 스 전 체 종 사 자 수 는 5,913명 감소"],
    ["wrong-unit", "시 외 버 스 운 전 자 부족과 외국인 버스운전자 고용여건"],
  ];
  for (const [id, text] of rows) {
    store.upsertDocument({ id, name: `${id}.pdf`, format: "pdf" });
    store.upsertEvidenceFragment({ id: `${id}-evidence`, documentId: id, pageStart: 1, pageEnd: 1, type: "text", origin: "ocr", context: text });
    store.upsertKnowledgeUnit({ id, documentId: id, title: id, text, ocrText: text, evidenceIds: [`${id}-evidence`] });
  }
  assert.deepEqual(store.searchLexical("시외버스 종사자수").map((row) => row.unitId), ["correct-unit"]);
  store.close();
  await rm(directory, { recursive: true });
});

test("does not return a semantic-only page as a direct search result", async () => {
  const unit = {
    unitId: "page-62", documentId: "doc", documentName: "연구.pdf", format: "pdf", title: "연구", text: "시 외 버 스 운 전 자 부족", nativeText: "", ocrText: "시 외 버 스 운 전 자 부족", sourceRange: 62,
    evidence: [{ id: "page-62-evidence", pageStart: 62, pageEnd: 62, type: "text", origin: "ocr", context: "시 외 버 스 운 전 자 부족" }],
  };
  const store = { searchLexical: () => [], hydrateUnits: () => [unit], health: () => ({ fts: "healthy" }), recordSearch: () => {} };
  const service = createSearchService({ store, semanticSearch: async () => [{ id: "page-62", unitId: "page-62", documentId: "doc" }] });
  const result = await service.search({ query: "시외버스 종사자수" });
  assert.deepEqual(result.results, []);
});

test("fuses lexical and semantic rankings with RRF k=60", () => {
  const fused = reciprocalRankFusion([
    [{ id: "a" }, { id: "b" }, { id: "c" }],
    [{ id: "b" }, { id: "d" }, { id: "a" }],
  ], { k: 60 });
  assert.deepEqual(fused.map((row) => row.id), ["b", "a", "d", "c"]);
  assert.ok(fused[0].score > fused[1].score);
});

test("limits duplicate evidence to two results per document", () => {
  const rows = diversifyResults([
    { id: "1", documentId: "d1", score: .9 },
    { id: "2", documentId: "d1", score: .8 },
    { id: "3", documentId: "d1", score: .7 },
    { id: "4", documentId: "d2", score: .6 },
  ], { limit: 3, maxPerDocument: 2 });
  assert.deepEqual(rows.map((row) => row.id), ["1", "2", "4"]);
});

test("selects evidence and marks low relevance without hiding it", () => {
  const rows = selectEvidence([
    { id: "u1", score: .8, evidence: [{ pageStart: 2, pageEnd: 2, type: "text" }] },
    { id: "u2", score: .1, evidence: [{ pageStart: 7, pageEnd: 7, type: "table" }] },
  ], { limit: 5, lowRelevanceThreshold: .25 });
  assert.equal(rows[0].matchedEvidence.pageStart, 2);
  assert.equal(rows[1].lowRelevance, true);
});

test("selects the evidence fragment that actually matches the query", () => {
  const rows = selectEvidence([
    {
      id: "visual-unit",
      score: .8,
      evidence: [
        { pageStart: 3, pageEnd: 3, type: "text", context: "문서 앞부분의 안내 문구" },
        { pageStart: 4, pageEnd: 4, type: "visual", assetName: "page-4-image-1.png", context: "12-3번 변경구간 우회 노선도" },
      ],
    },
  ], { query: "12-3번 변경구간", limit: 5 });
  assert.equal(rows[0].matchedEvidence.type, "visual");
  assert.equal(rows[0].matchedEvidence.pageStart, 4);
});

test("prioritizes OCR-backed visual evidence over nearby-page context", async () => {
  const units = new Map([
    ["nearby-unit", { unitId: "nearby-unit", documentId: "d1", documentName: "노선도.hwp", format: "hwp", title: "노선도", text: "앞 페이지에 111-1번 노선 목록", ocrText: "", sourceRange: "3", evidence: [{ pageStart: 3, pageEnd: 3, type: "visual", origin: "native", context: "앞 페이지에 111-1번 노선 목록" }] }],
    ["ocr-unit", { unitId: "ocr-unit", documentId: "d1", documentName: "노선도.hwp", format: "hwp", title: "노선도", text: "111-1번 우회 노선도", ocrText: "111-1번 우회 노선도", sourceRange: "4", evidence: [{ pageStart: 4, pageEnd: 4, type: "visual", origin: "ocr", context: "111-1번 우회 노선도" }] }],
  ]);
  const store = {
    searchLexical: () => [{ id: "nearby-unit", engine: "fts" }, { id: "ocr-unit", engine: "fts" }],
    hydrateUnits: (ids) => ids.map((id) => units.get(id)).filter(Boolean),
    health: () => ({ fts: "healthy" }),
    recordSearch: () => {},
  };
  const result = await createSearchService({ store }).search({ query: "111-1번 변경구간" });
  assert.equal(result.results[0].sourceRange, "4");
});

test("does not treat nearby page context as direct visual evidence", async () => {
  const unit = { unitId: "visual-nearby", documentId: "d1", documentName: "노선도.hwp", format: "hwp", title: "노선도", text: "앞 페이지의 111-1번 노선 목록", ocrText: "", sourceRange: "3", evidence: [{ pageStart: 3, pageEnd: 3, type: "visual", origin: "native", context: "앞 페이지의 111-1번 노선 목록" }] };
  const store = { searchLexical: () => [{ id: "visual-nearby", engine: "fts" }], hydrateUnits: () => [unit], health: () => ({ fts: "healthy" }), recordSearch: () => {} };
  const result = await createSearchService({ store }).search({ query: "111-1번 변경구간" });
  assert.deepEqual(result.results, []);
});

test("collapses text and visual cards for the same page", async () => {
  const units = new Map([
    ["text-unit", { unitId: "text-unit", documentId: "d1", documentName: "노선도.hwp", format: "hwp", title: "노선도", text: "12-3번 변경구간 우회 노선도", ocrText: "", sourceRange: "4", evidence: [{ pageStart: 4, pageEnd: 4, type: "text", origin: "native", context: "12-3번 변경구간 우회 노선도" }] }],
    ["visual-unit", { unitId: "visual-unit", documentId: "d1", documentName: "노선도.hwp", format: "hwp", title: "노선도", text: "12-3번 변경구간", ocrText: "12-3번 변경구간", sourceRange: "4", evidence: [{ pageStart: 4, pageEnd: 4, type: "visual", origin: "ocr", context: "12-3번 변경구간" }] }],
  ]);
  const store = { searchLexical: () => [{ id: "text-unit", engine: "fts" }, { id: "visual-unit", engine: "fts" }], hydrateUnits: (ids) => ids.map((id) => units.get(id)).filter(Boolean), health: () => ({ fts: "healthy" }), recordSearch: () => {} };
  const result = await createSearchService({ store }).search({ query: "12-3번 변경구간" });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].unitId, "visual-unit");
});

test("cosine similarity is dimension-safe", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1], [1, 0]), 0);
  assert.equal(cosineSimilarity([], []), 0);
});

test("sqlite store persists FTS evidence and hydrates only candidate ids", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "weki-search-"));
  const store = createSearchStore({ directory });
  store.upsertDocument({ id: "d1", name: "버스 안내서.pdf", format: "pdf", modifiedAt: "2024-01-02" });
  store.upsertEvidenceFragment({ id: "e1", documentId: "d1", pageStart: 3, pageEnd: 3, type: "text", origin: "native", context: "광화문 버스 시간표" });
  store.upsertKnowledgeUnit({ id: "u1", documentId: "d1", title: "시내버스", heading: "광화문", text: "광화문 버스 시간표", evidenceIds: ["e1"] });
  const lexical = store.searchLexical("광화문", { limit: 200 });
  assert.equal(lexical[0].unitId, "u1");
  assert.equal(store.searchLexical("광화문", { filters: { format: ["docx"] } }).length, 0);
  assert.equal(store.searchLexical("광화문", { filters: { format: ["pdf"], from: "2024-01-01", to: "2024-01-03" } }).length, 1);
  const hydrated = store.hydrateUnits(["u1"]);
  assert.equal(hydrated[0].evidence[0].pageStart, 3);
  assert.equal(store.health().fts, "healthy");
  store.close();
  const reopened = createSearchStore({ directory });
  assert.equal(reopened.hydrateUnits(["u1"])[0].unitId, "u1");
  reopened.close();
  await rm(directory, { recursive: true, force: true });
});

test("replaces one document's index atomically when visual evidence is refreshed", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "weki-search-replace-"));
  const store = createSearchStore({ directory });
  store.upsertDocument({ id: "d1", name: "노선도.hwp", format: "hwp" });
  store.upsertEvidenceFragment({ id: "old-e", documentId: "d1", pageStart: 3, pageEnd: 3, type: "text", context: "이전 결과" });
  store.upsertKnowledgeUnit({ id: "old-u", documentId: "d1", title: "노선도.hwp", text: "이전 결과", evidenceIds: ["old-e"] });
  store.replaceDocumentIndex({
    document: { id: "d1", name: "노선도.hwp", format: "hwp", sourceStatus: "local_available" },
    entries: [{
      evidence: { id: "new-e", documentId: "d1", pageStart: 4, pageEnd: 4, type: "visual", origin: "ocr", assetName: "page-4-image-1.png", context: "12-3번 변경구간 우회 노선도" },
      unit: { id: "new-u", documentId: "d1", title: "노선도.hwp", heading: "", text: "12-3번 변경구간 우회 노선도", nativeText: "", ocrText: "12-3번 변경구간 우회 노선도", sourceRange: 4, evidenceIds: ["new-e"] },
    }],
  });
  assert.equal(store.searchLexical("이전 결과").length, 0);
  assert.equal(store.searchLexical("12-3번 변경구간")[0].unitId, "new-u");
  assert.equal(store.hydrateUnits(["new-u"])[0].sourceStatus, "local_available");
  store.close();
  await rm(directory, { recursive: true, force: true });
});

test("search service returns stable cursor pagination and engine timings", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "weki-search-service-"));
  const store = createSearchStore({ directory });
  store.upsertDocument({ id: "d1", name: "문서.pdf", format: "pdf" });
  for (let index = 1; index <= 3; index += 1) {
    store.upsertEvidenceFragment({ id: `e${index}`, documentId: "d1", pageStart: index, pageEnd: index, type: "text", context: `버스 ${index}` });
    store.upsertKnowledgeUnit({ id: `u${index}`, documentId: "d1", title: "버스", text: `버스 안내 ${index}`, evidenceIds: [`e${index}`] });
  }
  const service = createSearchService({ store, pageSize: 2 });
  const first = await service.search({ query: "버스" });
  assert.equal(first.results.length, 2);
  assert.equal(first.hasMore, true);
  assert.ok(first.nextCursor);
  assert.deepEqual(first.results[0].matchedEvidence.pageStart, 1);
  const second = await service.search({ query: "버스", cursor: first.nextCursor });
  assert.equal(second.results.length, 1);
  assert.equal(second.results[0].resultId, first.results[1].resultId === second.results[0].resultId ? "never" : second.results[0].resultId);
  assert.equal(second.engines.lexical, "healthy");
  store.close();
  await rm(directory, { recursive: true, force: true });
});

test("search service returns a bounded matched snippet and display score", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "weki-search-display-"));
  const store = createSearchStore({ directory });
  store.upsertDocument({ id: "d1", name: "인구 보고서.pdf", format: "pdf" });
  const context = `${"서두의 설명입니다. ".repeat(20)}OO시 인구는 2025년 기준으로 증가했습니다. ${"뒤쪽의 부가 설명입니다. ".repeat(20)}`;
  store.upsertEvidenceFragment({ id: "e1", documentId: "d1", pageStart: 4, pageEnd: 4, type: "text", origin: "native", context });
  store.upsertKnowledgeUnit({ id: "u1", documentId: "d1", title: "인구", text: context, nativeText: context, evidenceIds: ["e1"] });
  const service = createSearchService({ store, pageSize: 5 });

  const result = await service.search({ query: "OO시 인구" });

  assert.equal(result.results[0].matchedEvidence.truncated, true);
  assert.equal(result.results[0].matchedEvidence.snippet.includes("OO시 인구"), true);
  assert.equal(result.results[0].matchedEvidence.snippet.length <= 222, true);
  assert.deepEqual(result.results[0].matchedEvidence.matchedTerms, ["OO시", "인구"]);
  assert.equal(Number.isInteger(result.results[0].displayScore), true);
  assert.equal(result.results[0].relevanceScore > 0, true);
  store.close();
  await rm(directory, { recursive: true, force: true });
});
