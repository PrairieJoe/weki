import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createSearchStore } from "../src/search/sqlite-store.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let nextPort = 5400;

async function startServer(dataDir, { searchV2 = "1" } = {}) {
  const port = nextPort++;
  const env = { ...process.env, WEKI_DATA_DIR: dataDir, WEKI_PORT: String(port), WEKI_DISABLE_INITIAL_MYBOX_SYNC: "1", WEKI_DISABLE_ENV_FILE: "1" };
  if (searchV2 !== null) env.WEKI_SEARCH_V2 = searchV2;
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: projectRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { const response = await fetch(`http://127.0.0.1:${port}/api/v2/status`); if (response.ok) return { child, port, output: () => output }; } catch {}
    await delay(100);
  }
  child.kill();
  throw new Error(`server did not become ready: ${output}`);
}

test("latest server defaults to v2 and migrates the legacy JSON index", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-v2-migration-"));
  await fs.writeFile(path.join(dataDir, "knowledge-base.json"), JSON.stringify({
    documents: [{ id: "legacy-doc", name: "연구.pdf", format: "PDF", processingStatus: "completed", sourceStatus: "local_available", units: [{ id: "legacy-unit", range: 33, text: "시 외 버 스 전 체 종 사 자 수 는 5,913명 감소", nativeText: "", ocrText: "시 외 버 스 전 체 종 사 자 수 는 5,913명 감소", evidenceType: "text" }] }],
    jobs: [], synonyms: [], feedback: [], audit: [],
  }));
  const server = await startServer(dataDir, { searchV2: null });
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  const status = await (await fetch(`http://127.0.0.1:${server.port}/api/status`)).json();
  assert.equal(status.searchVersion, "v2");
  const response = await fetch(`http://127.0.0.1:${server.port}/api/v2/search`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "시외버스 종사자수" }) });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.results[0].matchedEvidence.pageStart, 33);
  assert.match(body.results[0].matchedEvidence.context, /종\s*사\s*자\s*수/);
});

test("server starts when the source migration is already complete", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-v2-ready-migration-"));
  await fs.writeFile(path.join(dataDir, "knowledge-base.json"), JSON.stringify({ documents: [], jobs: [], synonyms: [], feedback: [], audit: [] }));
  const store = createSearchStore({ directory: path.join(dataDir, "v2") });
  store.setIndexState({ name: "source-migration", generation: crypto.createHash("sha256").update(JSON.stringify([])).digest("hex"), revision: Date.now(), status: "ready" });
  store.close();

  const server = await startServer(dataDir, { searchV2: null });
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  const status = await (await fetch(`http://127.0.0.1:${server.port}/api/status`)).json();
  assert.equal(status.search.migration.status, "ready");
  assert.equal(status.search.migration.completed, 0);
});

test("legacy search endpoint is retired after the v2 migration", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-v1-retired-"));
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const response = await fetch(`http://127.0.0.1:${server.port}/api/search`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "시외버스 종사자수" }) });
  const body = await response.json();
  assert.equal(response.status, 410);
  assert.equal(body.code, "legacy_search_removed");
});

test("v2 API returns cursor results and stores feedback", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-v2-api-"));
  const store = createSearchStore({ directory: path.join(dataDir, "v2") });
  store.upsertDocument({ id: "d1", name: "광화문.pdf", format: "pdf", sourceStatus: "local_available", cloudOriginalFile: null });
  store.upsertEvidenceFragment({ id: "e1", documentId: "d1", pageStart: 1, pageEnd: 1, type: "text", origin: "native", context: "광화문 버스" });
  store.upsertKnowledgeUnit({ id: "u1", documentId: "d1", title: "버스", text: "광화문 버스 시간표", evidenceIds: ["e1"] });
  store.close();
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  const response = await fetch(`http://127.0.0.1:${server.port}/api/v2/search`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "광화문" }) });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.results[0].unitId, "u1");
  assert.equal(body.results[0].matchedEvidence.pageStart, 1);
  assert.equal(body.results[0].sourceStatus, "local_available");
  const feedback = await fetch(`http://127.0.0.1:${server.port}/api/v2/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
    sessionId: body.sessionId, resultId: body.results[0].resultId, unitId: "u1", rank: 1, rankingVersion: body.rankingVersion, helpful: true,
  }) });
  assert.equal(feedback.status, 201);
});

test("v2 API applies approved synonym expansions to lexical search", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-v2-synonym-api-"));
  await fs.writeFile(path.join(dataDir, "knowledge-base.json"), JSON.stringify({ documents: [], jobs: [], synonyms: [{ id: "syn-payment", term: "결제", aliases: ["지급"], status: "approved", approved: true }], feedback: [], audit: [] }));
  const store = createSearchStore({ directory: path.join(dataDir, "v2") });
  store.upsertDocument({ id: "syn-doc", name: "지급 안내.pdf", format: "pdf", sourceStatus: "local_available" });
  store.upsertEvidenceFragment({ id: "syn-evidence", documentId: "syn-doc", pageStart: 1, pageEnd: 1, type: "text", origin: "native", context: "지급 절차 안내" });
  store.upsertKnowledgeUnit({ id: "syn-unit", documentId: "syn-doc", title: "지급 안내", text: "지급 절차 안내", evidenceIds: ["syn-evidence"] });
  store.close();
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  const response = await fetch(`http://127.0.0.1:${server.port}/api/v2/search`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "결제" }) });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.expansions, ["지급"]);
  assert.equal(body.results[0].unitId, "syn-unit");
});

test("v2 API merges approved synonym results even when the original term matches", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-v2-synonym-merge-"));
  await fs.writeFile(path.join(dataDir, "knowledge-base.json"), JSON.stringify({ documents: [], jobs: [], synonyms: [{ id: "syn-payment", term: "결제", aliases: ["지급"], status: "approved", approved: true }], feedback: [], audit: [] }));
  const store = createSearchStore({ directory: path.join(dataDir, "v2") });
  for (const [id, text] of [["payment-unit", "결제 절차 안내"], ["payout-unit", "지급 절차 안내"]]) {
    store.upsertDocument({ id, name: `${id}.pdf`, format: "pdf", sourceStatus: "local_available" });
    store.upsertEvidenceFragment({ id: `${id}-evidence`, documentId: id, pageStart: 1, pageEnd: 1, type: "text", origin: "native", context: text });
    store.upsertKnowledgeUnit({ id, documentId: id, title: text, text, evidenceIds: [`${id}-evidence`] });
  }
  store.close();
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  const response = await fetch(`http://127.0.0.1:${server.port}/api/v2/search`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "결제" }) });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(new Set(body.results.map((result) => result.unitId)), new Set(["payment-unit", "payout-unit"]));
});

test("local-ai registration reports an explicit lightweight fallback when the model is unavailable", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-local-ai-fallback-"));
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const form = new FormData();
  form.append("mode", "local-ai");
  form.append("files", new Blob(["not a real document"]), "fallback.docx");
  const response = await fetch(`http://127.0.0.1:${server.port}/api/documents`, { method: "POST", body: form });
  const body = await response.json();
  assert.equal(response.status, 202, JSON.stringify(body));
  assert.equal(body.processing.requestedMode, "local-ai");
  assert.equal(body.processing.effectiveMode, "lightweight");
  assert.equal(body.processing.fallbackReason, "semantic_model_unavailable");
});

test("runtime component API reports degraded optional packs and validates install requests", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-runtime-api-"));
  await fs.mkdir(path.join(dataDir, "runtime", "v1"), { recursive: true });
  await fs.writeFile(path.join(dataDir, "runtime", "v1", "component-state.json"), JSON.stringify({ format: "weki-runtime-state", version: 1, components: { "document-renderer": { id: "document-renderer", status: "ready", version: "1.0.0", path: path.join(dataDir, "runtime", "v1", "document-renderer", "1.0.0") } } }));
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const status = await (await fetch(`http://127.0.0.1:${server.port}/api/runtime/components`)).json();
  assert.equal(status.components["semantic-model"].status, "missing");
  assert.equal(status.components["document-renderer"].status, "missing");
  const runtime = await fetch(`http://127.0.0.1:${server.port}/api/mybox/runtime`);
  assert.equal(runtime.status, 503);
  const response = await fetch(`http://127.0.0.1:${server.port}/api/runtime/components/install`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ componentId: "unknown", version: "1.0.0", manifest: { format: "bad" } }) });
  assert.equal(response.status, 400);
});

test("runtime install batch records an unavailable renderer and a successful bundled reranker", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-runtime-install-outcome-"));
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const base = `http://127.0.0.1:${server.port}`;

  const response = await fetch(`${base}/api/runtime/components/install-all`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ componentIds: ["semantic-reranker", "document-renderer"] }),
  });
  const queued = await response.json();
  assert.equal(response.status, 202, JSON.stringify(queued));

  let runtime = queued.runtime;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    runtime = await (await fetch(`${base}/api/runtime/components`)).json();
    if (runtime.installBatch.status !== "indexing") break;
    await delay(50);
  }
  const batch = runtime.installBatch;
  assert.equal(batch.status, "partial", JSON.stringify(batch));
  assert.equal(batch.results["semantic-reranker"].status, "installed");
  assert.equal(batch.results["document-renderer"].status, "unavailable");
  assert.deepEqual(batch.failed, []);
  assert.ok(batch.installed.includes("semantic-reranker"));
  assert.ok(batch.unavailable.includes("document-renderer"));
});

test("runtime install batch continues after a real reranker failure", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-runtime-install-failure-"));
  const runtimeDir = path.join(dataDir, "runtime", "v1");
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.writeFile(path.join(runtimeDir, "manifest.json"), JSON.stringify({
    format: "weki-runtime-manifest",
    version: 1,
    appCompatibility: ">=1.0.0",
    source: "local-test",
    components: [{
      id: "semantic-reranker",
      version: "1.0.0",
      files: [{
        path: "reranker.mjs",
        url: pathToFileURL(path.join(dataDir, "missing-reranker.mjs")).href,
        size: 1,
        sha256: "0".repeat(64),
      }],
    }],
  }));
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const base = `http://127.0.0.1:${server.port}`;

  const response = await fetch(`${base}/api/runtime/components/install-all`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ componentIds: ["semantic-reranker", "document-renderer"] }),
  });
  const queued = await response.json();
  assert.equal(response.status, 202, JSON.stringify(queued));

  let runtime = queued.runtime;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    runtime = await (await fetch(`${base}/api/runtime/components`)).json();
    if (runtime.installBatch.status !== "indexing") break;
    await delay(50);
  }
  const batch = runtime.installBatch;
  assert.equal(batch.status, "failed", JSON.stringify(batch));
  assert.equal(batch.results["semantic-reranker"].status, "failed");
  assert.equal(batch.results["document-renderer"].status, "unavailable");
  assert.equal(batch.failed[0].id, "semantic-reranker");
  assert.equal(batch.currentComponent, null);
  assert.ok(batch.finishedAt);
});

test("clean installs keep the document renderer uninstalled until a runtime pack is present", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-runtime-renderer-missing-"));
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  const status = await (await fetch(`http://127.0.0.1:${server.port}/api/runtime/components`)).json();
  assert.equal(status.components["document-renderer"].status, "missing");
  assert.equal(status.components["document-renderer"].applied, false);
  assert.equal(status.components["document-renderer"].reason, "runtime_pack_not_configured");
});

test("PDF image pages expose a visual evidence preview", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-pdf-visual-api-"));
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  const fileName = "01 시내버스 개편 방향 및 효과, 개편사항.pdf";
  const form = new FormData();
  form.append("files", new Blob([await fs.readFile(path.join(projectRoot, "test_data", fileName))], { type: "application/pdf" }), fileName);
  const queued = await fetch(`http://127.0.0.1:${server.port}/api/documents`, { method: "POST", body: form });
  assert.equal(queued.status, 202);
  let document = null;
  let lastJob = null;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const jobs = await (await fetch(`http://127.0.0.1:${server.port}/api/jobs`)).json();
    const job = jobs.jobs.find((item) => item.name === fileName);
    lastJob = job;
    if (job?.status === "failed") throw new Error(job.detail);
    document = (await (await fetch(`http://127.0.0.1:${server.port}/api/documents`)).json()).documents.find((item) => item.name === fileName);
    if (document) break;
    await delay(250);
  }
  assert.ok(document, JSON.stringify(lastJob ?? null));
  const preview = await fetch(`http://127.0.0.1:${server.port}/api/documents/${document.id}/visual/page-4.png`);
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get("content-type") || "", /image\/png/);
  assert.equal((await preview.arrayBuffer()).byteLength > 10_000, true);
});

test("runtime component API confirms when the document renderer is actually applied", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-renderer-applied-"));
  await fs.mkdir(path.join(dataDir, "runtime", "v1"), { recursive: true });
  await fs.writeFile(path.join(dataDir, "runtime", "v1", "component-state.json"), JSON.stringify({
    format: "weki-runtime-state",
    version: 1,
    components: {
      "document-renderer": {
        id: "document-renderer",
        status: "ready",
        version: "0.8.4",
        path: path.join(projectRoot, "node_modules", "@rhwp", "core"),
      },
    },
  }));
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  const status = await (await fetch(`http://127.0.0.1:${server.port}/api/runtime/components`)).json();
  assert.equal(status.components["document-renderer"].status, "ready");
  assert.equal(status.components["document-renderer"].applied, true);
  assert.equal(status.components["document-renderer"].version, "0.8.4");
});

test("v2 store can reconcile source availability without rebuilding the document index", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "weki-v2-source-"));
  const store = createSearchStore({ directory });
  store.upsertDocument({ id: "doc-source", name: "원본.pdf", format: "pdf", sourceStatus: "unavailable" });
  assert.equal(store.updateDocumentSource({ id: "doc-source", sourceStatus: "local_available", cloudOriginalFile: "data/hash/original.pdf" }), true);
  store.upsertEvidenceFragment({ id: "ev-source", documentId: "doc-source", pageStart: 1, pageEnd: 1, type: "text", origin: "native", context: "원본 확인" });
  store.upsertKnowledgeUnit({ id: "unit-source", documentId: "doc-source", title: "원본.pdf", heading: "", text: "원본 확인", nativeText: "원본 확인", ocrText: "", sourceRange: 1, evidenceIds: ["ev-source"] });
  assert.equal(store.hydrateUnits(["unit-source"])[0].sourceStatus, "local_available");
  assert.equal(store.hydrateUnits(["unit-source"])[0].cloudOriginalFile, "data/hash/original.pdf");
  store.close();
  await fs.rm(directory, { recursive: true, force: true });
});

test("v2 search applies approved synonyms and returns display evidence", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-v1-display-"));
  await fs.writeFile(path.join(dataDir, "knowledge-base.json"), JSON.stringify({
    documents: [{
      id: "legacy-doc", name: "결제 정책.pdf", format: "PDF", processingStatus: "completed", sourceStatus: "unavailable",
      units: [{ id: "legacy-unit", range: 2, text: `${"서두 설명입니다. ".repeat(30)}결제 절차는 지급 승인 후 완료됩니다. ${"부가 설명입니다. ".repeat(30)}`, nativeText: "결제 절차는 지급 승인 후 완료됩니다.", ocrText: "", embedding: Array(128).fill(0.01), evidenceType: "text" }],
    }],
    jobs: [], synonyms: [], feedback: [], audit: [],
  }, null, 2));
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  const synonym = await fetch(`http://127.0.0.1:${server.port}/api/synonyms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ term: "결제", aliases: ["지급"] }) });
  assert.equal(synonym.status, 201);
  const response = await fetch(`http://127.0.0.1:${server.port}/api/v2/search`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "결제" }) });
  const body = await response.json();
  assert.deepEqual(body.expansions, ["지급"]);
  assert.equal(body.results[0].matchedEvidence.snippet.includes("결제"), true);
  assert.equal(body.results[0].matchedEvidence.snippet.length <= 222, true);
  assert.equal(Number.isInteger(body.results[0].displayScore), true);
});

test("v2 search respects numeric route boundaries", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-legacy-route-boundary-"));
  await fs.writeFile(path.join(dataDir, "knowledge-base.json"), JSON.stringify({
    documents: [
      { id: "route-1090", name: "1090.pdf", format: "PDF", processingStatus: "completed", units: [{ id: "u1090", range: 1, text: "1090번 우회경로", nativeText: "1090번 우회경로", ocrText: "", embedding: Array(128).fill(0.01), evidenceType: "text" }] },
      { id: "route-109", name: "109.pdf", format: "PDF", processingStatus: "completed", units: [{ id: "u109", range: 1, text: "109번 우회경로", nativeText: "109번 우회경로", ocrText: "", embedding: Array(128).fill(0.01), evidenceType: "text" }] },
    ],
    jobs: [], synonyms: [], feedback: [], audit: [],
  }));
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  const response = await fetch(`http://127.0.0.1:${server.port}/api/v2/search`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "109번" }) });
  const body = await response.json();
  assert.deepEqual(body.results.map((result) => result.documentId), ["route-109"]);
});

test("synonym suggestions stay draft until explicitly approved", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-synonym-api-"));
  await fs.writeFile(path.join(dataDir, "knowledge-base.json"), JSON.stringify({
    documents: [{ id: "d1", name: "정책.pdf", format: "PDF", processingStatus: "completed", units: [{ text: "결제 지급 승인 절차 안내" }] }],
    jobs: [], synonyms: [], feedback: [{ query: "결제", documentId: "d1", helpful: true }], audit: [],
  }));
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  const suggestions = await (await fetch(`http://127.0.0.1:${server.port}/api/synonyms/suggestions`)).json();
  assert.deepEqual(suggestions.suggestions, [{ term: "결제", aliases: ["지급"], status: "draft", source: "suggested" }]);
  const created = await fetch(`http://127.0.0.1:${server.port}/api/synonyms/suggestions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(suggestions.suggestions[0]) });
  const createdBody = await created.json();
  assert.equal(created.status, 201);
  assert.equal(createdBody.entry.status, "draft");
  const decision = await fetch(`http://127.0.0.1:${server.port}/api/synonyms/${createdBody.entry.id}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "approved" }) });
  assert.equal(decision.status, 200);
  assert.equal((await decision.json()).entry.status, "approved");
});
