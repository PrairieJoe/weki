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

test("escapes FTS literals instead of interpreting query operators", () => {
  assert.equal(ftsLiteral('버스 "시간표"'), '"버스" AND "시간표"');
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
