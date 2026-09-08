import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { createSearchStore } from "../src/search/sqlite-store.mjs";
import { createSearchService } from "../src/search/service.mjs";

const pageCount = Math.max(1, Number(process.argv[2] || 1000));
const queryCount = Math.max(3, Number(process.argv[3] || 100));
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "weki-benchmark-v2-"));
const store = createSearchStore({ directory });
store.upsertDocument({ id: "benchmark-document", name: "benchmark.pdf", format: "pdf", modifiedAt: new Date().toISOString() });
for (let page = 1; page <= pageCount; page += 1) {
  const evidenceId = `benchmark-e${page}`;
  const unitId = `benchmark-u${page}`;
  const text = `교통 정책 분석 페이지 ${page} 버스 노선 운영 데이터`;
  store.upsertEvidenceFragment({ id: evidenceId, documentId: "benchmark-document", pageStart: page, pageEnd: page, type: "text", origin: "native", context: text });
  store.upsertKnowledgeUnit({ id: unitId, documentId: "benchmark-document", title: "benchmark", text, evidenceIds: [evidenceId] });
}
const service = createSearchService({ store, pageSize: 5 });
const samples = [];
for (let index = 0; index < queryCount; index += 1) {
  const started = performance.now();
  await service.search({ query: index % 2 ? "버스 노선" : "교통 정책" });
  samples.push(performance.now() - started);
}
samples.sort((a, b) => a - b);
const percentile = (value) => samples[Math.min(samples.length - 1, Math.floor(samples.length * value))];
console.log(JSON.stringify({ pageCount, queryCount, p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: samples.at(-1), rssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024) }, null, 2));
store.close();
await fs.rm(directory, { recursive: true, force: true });
