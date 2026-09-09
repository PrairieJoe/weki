import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createSearchStore } from "../src/search/sqlite-store.mjs";
import { runtimeAction, runtimeBatchMessage } from "../src/runtime/presentation.mjs";
import { DEFAULT_RUNTIME_MANIFEST } from "../src/runtime/semantic-manifest.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function startServer(dataDir, { searchV2 = "1", env: envOverrides = {} } = {}) {
  const port = await freePort();
  const env = { ...process.env, WEKI_DATA_DIR: dataDir, WEKI_PORT: String(port), WEKI_DISABLE_INITIAL_MYBOX_SYNC: "1", WEKI_DISABLE_ENV_FILE: "1", ...envOverrides };
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

async function writePublicRendererManifest(dataDir) {
  const bytes = Buffer.from("public renderer");
  const runtimeDir = path.join(dataDir, "runtime", "v1");
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.writeFile(path.join(runtimeDir, "manifest.json"), JSON.stringify({
    format: "weki-runtime-manifest",
    version: 1,
    appCompatibility: ">=1.0.0",
    license: "MIT",
    source: "public-test",
    components: [{
      id: "document-renderer",
      version: "1.0.0",
      files: [{
        path: "renderer.bin",
        url: `data:application/octet-stream;base64,${bytes.toString("base64")}`,
        size: bytes.length,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      }],
    }],
  }));
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

test("v2 API includes bounded evidence context only when requested", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-v2-context-api-"));
  const store = createSearchStore({ directory: path.join(dataDir, "v2") });
  store.upsertDocument({ id: "context-doc", name: "근거.pdf", format: "pdf", sourceStatus: "local_available" });
  store.upsertEvidenceFragment({ id: "context-evidence", documentId: "context-doc", pageStart: 7, pageEnd: 7, type: "text", origin: "native", context: "버스 노선의 변경 근거입니다." });
  store.upsertKnowledgeUnit({ id: "context-unit", documentId: "context-doc", title: "근거", text: "버스 노선의 변경 근거입니다.", sourceRange: 7, evidenceIds: ["context-evidence"] });
  store.close();
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  const plain = await (await fetch(`http://127.0.0.1:${server.port}/api/v2/search`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "버스 노선" }) })).json();
  assert.equal(Object.hasOwn(plain, "contextPack"), false);
  const contextual = await (await fetch(`http://127.0.0.1:${server.port}/api/v2/search`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "버스 노선", includeContext: true }) })).json();
  assert.equal(contextual.contextPack.citations[0].evidenceIds[0], "context-evidence");
  assert.equal(contextual.contextPack.citations[0].sourceRange, "7");
});

test("v2 API queues an explicit full search reindex and exposes progress", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-v2-reindex-api-"));
  await fs.writeFile(path.join(dataDir, "knowledge-base.json"), JSON.stringify({ documents: [], jobs: [], synonyms: [], feedback: [], audit: [] }));
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const response = await fetch(`http://127.0.0.1:${server.port}/api/v2/search/reindex`, { method: "POST" });
  const body = await response.json();
  assert.equal(response.status, 202, JSON.stringify(body));
  assert.ok(["indexing", "ready"].includes(body.status));
  const status = await (await fetch(`http://127.0.0.1:${server.port}/api/v2/status`)).json();
  assert.ok(["indexing", "ready"].includes(status.reindex.status));
});

test("full reindex swaps a verified shadow store and preserves searchable evidence", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-v2-shadow-reindex-"));
  await fs.writeFile(path.join(dataDir, "knowledge-base.json"), JSON.stringify({
    documents: [{ id: "shadow-doc", name: "shadow.pdf", format: "PDF", processingStatus: "completed", units: [{ id: "shadow-unit", range: 9, text: "shadow reindex 근거", nativeText: "shadow reindex 근거", ocrText: "", evidenceType: "text" }] }],
    jobs: [], synonyms: [], feedback: [], audit: [],
  }));
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const queuedResponse = await fetch(`http://127.0.0.1:${server.port}/api/v2/search/reindex`, { method: "POST" });
  const queuedText = await queuedResponse.text();
  assert.match(queuedResponse.headers.get("content-type") || "", /json/, queuedText);
  const queued = JSON.parse(queuedText);
  assert.equal(queued.status, "indexing");
  let status = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const statusResponse = await fetch(`http://127.0.0.1:${server.port}/api/v2/status`);
    const statusText = await statusResponse.text();
    assert.match(statusResponse.headers.get("content-type") || "", /json/, `${statusText}\nSERVER=${server.output()}`);
    status = JSON.parse(statusText);
    if (status.reindex.status !== "indexing") break;
    await delay(50);
  }
  assert.equal(status.reindex.status, "ready", JSON.stringify(status));
  const resultResponse = await fetch(`http://127.0.0.1:${server.port}/api/v2/search`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "shadow reindex" }) });
  const resultText = await resultResponse.text();
  assert.match(resultResponse.headers.get("content-type") || "", /json/, resultText);
  const result = JSON.parse(resultText);
  assert.ok(result.results[0], JSON.stringify(result));
  assert.equal(result.results[0].documentId, "shadow-doc");
  assert.equal(result.results[0].matchedEvidence.pageStart, 9);
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

test("v2 API rebuilds context and closes pagination when merging synonym queries", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-v2-synonym-context-"));
  await fs.writeFile(path.join(dataDir, "knowledge-base.json"), JSON.stringify({ documents: [], jobs: [], synonyms: [{ id: "syn-payment", term: "결제", aliases: ["지급"], status: "approved", approved: true }], feedback: [], audit: [] }));
  const store = createSearchStore({ directory: path.join(dataDir, "v2") });
  for (let index = 1; index <= 6; index += 1) {
    const id = `payment-unit-${index}`;
    const evidenceId = `payment-evidence-${index}`;
    const text = `결제 절차 ${index}`;
    store.upsertDocument({ id, name: `${id}.pdf`, format: "pdf", sourceStatus: "local_available" });
    store.upsertEvidenceFragment({ id: evidenceId, documentId: id, pageStart: index, pageEnd: index, type: "text", origin: "native", context: text });
    store.upsertKnowledgeUnit({ id, documentId: id, title: text, text, evidenceIds: [evidenceId] });
  }
  store.upsertDocument({ id: "payout-unit", name: "payout-unit.pdf", format: "pdf", sourceStatus: "local_available" });
  store.upsertEvidenceFragment({ id: "payout-evidence", documentId: "payout-unit", pageStart: 7, pageEnd: 7, type: "text", origin: "native", context: "지급 절차 안내" });
  store.upsertKnowledgeUnit({ id: "payout-unit", documentId: "payout-unit", title: "지급 절차 안내", text: "지급 절차 안내", evidenceIds: ["payout-evidence"] });
  store.close();
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  const response = await fetch(`http://127.0.0.1:${server.port}/api/v2/search`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "결제", includeContext: true }) });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.results.length, 7);
  assert.equal(body.hasMore, false);
  assert.equal(body.nextCursor, null);
  assert.equal(body.contextPack.query, "결제");
  assert.ok(body.contextPack.citations.some((citation) => citation.evidenceIds.includes("payout-evidence")), JSON.stringify(body.contextPack));
  assert.ok(body.contextPack.citations.some((citation) => citation.evidenceIds.includes("payment-evidence-1")), JSON.stringify(body.contextPack));
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

test("status exposes an automatic processing default and Local AI eligibility", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-processing-settings-"));
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  const response = await fetch(`http://127.0.0.1:${server.port}/api/status`);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.processing.defaultMode, "auto");
  assert.equal(body.processing.effectiveDefaultMode, "lightweight");
  assert.equal(body.processing.localAiEligible, false);
  assert.equal(body.processing.localAiEligibilityReason, "runtime_components_incomplete");
});

test("processing default can be changed without reprocessing existing documents", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-processing-settings-update-"));
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  const response = await fetch(`http://127.0.0.1:${server.port}/api/settings`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ defaultProcessingMode: "lightweight" }) });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.settings.defaultProcessingMode, "lightweight");
  assert.equal(body.processing.effectiveDefaultMode, "lightweight");
  const stored = JSON.parse(await fs.readFile(path.join(dataDir, "knowledge-base.json"), "utf8"));
  assert.equal(stored.settings.defaultProcessingMode, "lightweight");
  assert.deepEqual(stored.documents, []);
});

test("document registration uses the saved processing default only for new work", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-processing-default-upload-"));
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  const lightweightForm = new FormData();
  lightweightForm.append("files", new Blob(["not a supported document"]), "default.txt");
  const lightweightResponse = await fetch(`http://127.0.0.1:${server.port}/api/documents`, { method: "POST", body: lightweightForm });
  const lightweightBody = await lightweightResponse.json();
  assert.equal(lightweightBody.processing.requestedMode, "lightweight");

  const settingsResponse = await fetch(`http://127.0.0.1:${server.port}/api/settings`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ defaultProcessingMode: "local-ai" }) });
  assert.equal(settingsResponse.status, 200);
  const localAiForm = new FormData();
  localAiForm.append("files", new Blob(["not a supported document"]), "local-ai-default.txt");
  const localAiResponse = await fetch(`http://127.0.0.1:${server.port}/api/documents`, { method: "POST", body: localAiForm });
  const localAiBody = await localAiResponse.json();
  assert.equal(localAiBody.processing.requestedMode, "lightweight");
  assert.equal(localAiBody.processing.fallbackReason, null);
});

test("runtime status keeps all component rows when only one source manifest is available", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-runtime-catalog-"));
  await fs.mkdir(path.join(dataDir, "runtime", "v1"), { recursive: true });
  await fs.writeFile(path.join(dataDir, "runtime", "v1", "manifest.json"), JSON.stringify({
    format: "weki-runtime-manifest", version: 1, appCompatibility: ">=1.0.0", license: "MIT", source: "mybox",
    components: [{ id: "document-renderer", version: "1.0.0", files: [{ path: "renderer.mjs", size: 1, sha256: "a".repeat(64) }] }],
  }));
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  const body = await (await fetch(`http://127.0.0.1:${server.port}/api/runtime/components`)).json();
  assert.deepEqual(Object.keys(body.components).sort(), ["document-renderer", "semantic-model", "semantic-reranker"]);
  assert.equal(body.components["document-renderer"].sourceType, "mybox");
  assert.equal(body.components["document-renderer"].requiresMybox, true);
  assert.equal(body.components["semantic-reranker"].status, "missing");
  assert.equal(body.components["semantic-reranker"].installable, true);
  assert.equal(body.components["semantic-reranker"].sourceType, "bundled");
});

test("runtime status retains the source of an installed pack after another manifest replaces the root manifest", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-runtime-source-history-"));
  const runtimeDir = path.join(dataDir, "runtime", "v1");
  const rerankerPath = path.join(runtimeDir, "semantic-reranker", "1.0.0");
  await fs.mkdir(rerankerPath, { recursive: true });
  await fs.writeFile(path.join(runtimeDir, "component-state.json"), JSON.stringify({ format: "weki-runtime-state", version: 1, components: {
    "semantic-reranker": { id: "semantic-reranker", status: "ready", version: "1.0.0", path: rerankerPath, sourceType: "mybox", source: "mybox" },
  } }));
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  const body = await (await fetch(`http://127.0.0.1:${server.port}/api/runtime/components`)).json();
  assert.equal(body.components["semantic-reranker"].sourceType, "mybox");
  assert.equal(body.components["semantic-reranker"].installable, true);
  assert.equal(body.components["semantic-reranker"].availableVersion, "1.0.0");
});

test("document-renderer install and batch resolution reject public manifests", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-runtime-public-renderer-policy-"));
  await writePublicRendererManifest(dataDir);
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const base = `http://127.0.0.1:${server.port}`;

  const status = await (await fetch(`${base}/api/runtime/components`)).json();
  assert.equal(status.components["document-renderer"].sourceType, "mybox");
  assert.equal(status.components["document-renderer"].requiresMybox, true);
  assert.equal(status.components["document-renderer"].installable, false);
  assert.equal(status.installable["document-renderer"], undefined);
  const direct = await fetch(`${base}/api/runtime/components/install`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ componentId: "document-renderer", version: "1.0.0" }),
  });
  const directBody = await direct.json();
  assert.equal(direct.status, 400, JSON.stringify(directBody));
  assert.match(directBody.error, /MYBOX/);

  const explicit = await fetch(`${base}/api/runtime/components/install`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ componentId: "document-renderer", version: "1.0.0", manifest: status.installable["document-renderer"] }),
  });
  assert.equal(explicit.status, 400);

  const spoofedManifest = {
    format: "weki-runtime-manifest",
    version: 1,
    appCompatibility: ">=1.0.0",
    source: "mybox",
    components: [{
      id: "document-renderer",
      version: "1.0.0",
      files: [{
        path: "renderer.bin",
        url: "data:application/octet-stream;base64,c3Bvb2ZlZA==",
        size: 7,
        sha256: crypto.createHash("sha256").update("spoofed").digest("hex"),
      }],
    }],
  };
  const spoofedInstall = await fetch(`${base}/api/runtime/components/install`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ componentId: "document-renderer", version: "1.0.0", manifest: spoofedManifest }),
  });
  const spoofedInstallBody = await spoofedInstall.json();
  assert.equal(spoofedInstall.status, 400, JSON.stringify(spoofedInstallBody));
  assert.match(spoofedInstallBody.error, /MYBOX/);

  const contradictorySource = await fetch(`${base}/api/runtime/components/install`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ componentId: "semantic-model", version: "1.0.0", source: "public", manifest: spoofedManifest }),
  });
  const contradictorySourceBody = await contradictorySource.json();
  assert.equal(contradictorySource.status, 400, JSON.stringify(contradictorySourceBody));
  assert.match(contradictorySourceBody.error, /출처/);

  const batchResponse = await fetch(`${base}/api/runtime/components/install-all`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ componentIds: ["document-renderer"] }),
  });
  assert.equal(batchResponse.status, 202);
  let runtime = (await batchResponse.json()).runtime;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    runtime = await (await fetch(`${base}/api/runtime/components`)).json();
    if (runtime.installBatch.status !== "indexing") break;
    await delay(50);
  }
  assert.equal(runtime.installBatch.results["document-renderer"].status, "unavailable", JSON.stringify(runtime.installBatch));
  assert.deepEqual(runtime.installBatch.failed, []);
});

test("runtime component API reports degraded optional packs and validates install requests", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-runtime-api-"));
  await fs.mkdir(path.join(dataDir, "runtime", "v1"), { recursive: true });
  await fs.writeFile(path.join(dataDir, "runtime", "v1", "component-state.json"), JSON.stringify({ format: "weki-runtime-state", version: 1, components: { "document-renderer": { id: "document-renderer", status: "ready", version: "1.0.0", path: path.join(dataDir, "runtime", "v1", "document-renderer", "1.0.0") } } }));
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const status = await (await fetch(`http://127.0.0.1:${server.port}/api/runtime/components`)).json();
  assert.equal(status.components["semantic-model"].status, "missing");
  assert.equal(status.components["semantic-reranker"].status, "missing");
  assert.equal(status.components["semantic-reranker"].installable, true);
  assert.equal(status.components["semantic-reranker"].availableVersion, "1.0.0");
  assert.equal(status.components["document-renderer"].status, "missing");
  const runtime = await fetch(`http://127.0.0.1:${server.port}/api/mybox/runtime`);
  assert.equal(runtime.status, 503);
  const response = await fetch(`http://127.0.0.1:${server.port}/api/runtime/components/install`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ componentId: "unknown", version: "1.0.0", manifest: { format: "bad" } }) });
  assert.equal(response.status, 400);
  const batchResponse = await fetch(`http://127.0.0.1:${server.port}/api/runtime/components/install-all`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ componentIds: ["unknown"] }) });
  assert.equal(batchResponse.status, 400);
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

test("ordered runtime install uses bundled transport after the default manifest is persisted", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-runtime-ordered-bundled-"));
  const runtimeDir = path.join(dataDir, "runtime", "v1");
  const semanticModelPath = path.join(runtimeDir, "semantic-model", "1.0.0");
  await fs.mkdir(semanticModelPath, { recursive: true });
  await fs.writeFile(path.join(runtimeDir, "manifest.json"), JSON.stringify(DEFAULT_RUNTIME_MANIFEST));
  await fs.writeFile(path.join(runtimeDir, "component-state.json"), JSON.stringify({ format: "weki-runtime-state", version: 1, components: {
    "semantic-model": { id: "semantic-model", status: "ready", version: "1.0.0", path: semanticModelPath, sourceType: "bundled", source: "Weki bundled runtime pack" },
  } }));
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  const response = await fetch(`http://127.0.0.1:${server.port}/api/runtime/components/install-all`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ componentIds: ["semantic-reranker", "semantic-model"] }),
  });
  const queued = await response.json();
  assert.equal(response.status, 202, JSON.stringify(queued));
  assert.deepEqual(queued.runtime.installBatch.componentIds, ["semantic-model", "semantic-reranker"]);
  let runtime = queued.runtime;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    runtime = await (await fetch(`http://127.0.0.1:${server.port}/api/runtime/components`)).json();
    if (runtime.installBatch.status !== "indexing") break;
    await delay(50);
  }
  const batch = runtime.installBatch;
  assert.equal(batch.status, "ready", JSON.stringify(batch));
  assert.equal(batch.results["semantic-model"].status, "already-ready");
  assert.equal(batch.results["semantic-reranker"].status, "installed", JSON.stringify(batch));
  assert.equal(batch.failed.length, 0);
  assert.equal(batch.installed.includes("semantic-reranker"), true);
  assert.equal(runtime.components["semantic-reranker"].sourceType, "bundled");
  assert.deepEqual(
    await fs.readFile(path.join(runtimeDir, "semantic-reranker", "1.0.0", "reranker.mjs")),
    await fs.readFile(path.join(projectRoot, "src", "runtime", "packs", "semantic-reranker", "1.0.0", "reranker.mjs")),
  );
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

test("runtime install batch persists non-unavailable resolver failures for every optional component", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-runtime-resolver-failure-state-"));
  const runtimeDir = path.join(dataDir, "runtime", "v1");
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.writeFile(path.join(runtimeDir, "manifest.json"), JSON.stringify({
    format: "weki-runtime-manifest",
    version: 1,
    appCompatibility: ">=1.0.0",
    source: "mybox",
    components: ["semantic-model", "semantic-reranker", "document-renderer"].map((id) => ({
      id,
      version: "2.0.0",
      files: [{ path: `${id}.bin`, size: 0, sha256: "0".repeat(64) }],
    })),
  }));
  await fs.writeFile(path.join(runtimeDir, "component-state.json"), JSON.stringify({
    format: "weki-runtime-state",
    version: 1,
    components: Object.fromEntries(["semantic-model", "semantic-reranker", "document-renderer"].map((id) => [id, {
      id,
      status: "failed",
      version: null,
      sourceType: "mybox",
      source: "existing-source-metadata",
      requiresMybox: true,
      reason: "runtime_install_failed",
      error: "previous resolver failure",
    }])),
  }));
  let apiBase = "";
  const provider = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const json = (value) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); };
    if (url.pathname === "/v1/drive/resources") return json({ resources: [{ resourceId: "wiki-id", name: "wiki", type: "folder" }] });
    if (url.pathname === "/v1/drive/folders/wiki-id/resources") return json({ resources: [{ resourceId: "runtime-id", name: "runtime", type: "folder" }] });
    if (url.pathname === "/v1/drive/folders/runtime-id/resources") return json({ resources: [{ resourceId: "v1-id", name: "v1", type: "folder" }] });
    if (url.pathname === "/v1/drive/folders/v1-id/resources") return json({ resources: [{ resourceId: "manifest-id", name: "manifest.json", type: "file" }] });
    if (url.pathname === "/v1/drive/files/manifest-id/download") return json({ downloadUrl: `${apiBase}/v1/malformed-manifest` });
    if (url.pathname === "/v1/malformed-manifest") { res.setHeader("Content-Type", "application/json"); return res.end("{malformed"); }
    res.statusCode = 404;
    return res.end();
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  apiBase = `http://127.0.0.1:${provider.address().port}`;
  const server = await startServer(dataDir, { env: { NAVER_MBOX_TOKEN: "test-token", WEKI_MYBOX_API_BASE: `${apiBase}/v1` } });
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); await new Promise((resolve) => provider.close(resolve)); });

  const response = await fetch(`http://127.0.0.1:${server.port}/api/runtime/components/install-all`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ componentIds: ["semantic-model", "semantic-reranker", "document-renderer"] }),
  });
  assert.equal(response.status, 202);
  let runtime = (await response.json()).runtime;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    runtime = await (await fetch(`http://127.0.0.1:${server.port}/api/runtime/components`)).json();
    if (runtime.installBatch.status !== "indexing") break;
    await delay(50);
  }
  assert.equal(runtime.installBatch.status, "failed", JSON.stringify(runtime.installBatch));
  assert.deepEqual(runtime.installBatch.failed.map((entry) => entry.id), ["semantic-model", "semantic-reranker", "document-renderer"]);
  assert.deepEqual(runtime.installBatch.unavailable, []);

  const persisted = JSON.parse(await fs.readFile(path.join(runtimeDir, "component-state.json"), "utf8"));
  for (const id of ["semantic-model", "semantic-reranker", "document-renderer"]) {
    const component = persisted.components[id];
    assert.equal(component.status, "failed");
    assert.equal(component.version, "2.0.0");
    assert.equal(component.sourceType, "mybox");
    assert.equal(component.source, "existing-source-metadata");
    assert.equal(component.requiresMybox, true);
    assert.match(component.error, /MYBOX runtime manifest를 읽을 수 없습니다/);
  }
});

test("MYBOX manifest parse failures remain failed with their concrete error", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-runtime-mybox-manifest-failure-"));
  let apiBase = "";
  const provider = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const json = (value) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); };
    if (url.pathname === "/v1/drive/resources") return json({ resources: [{ resourceId: "wiki-id", name: "wiki", type: "folder" }] });
    if (url.pathname === "/v1/drive/folders/wiki-id/resources") return json({ resources: [{ resourceId: "runtime-id", name: "runtime", type: "folder" }] });
    if (url.pathname === "/v1/drive/folders/runtime-id/resources") return json({ resources: [{ resourceId: "v1-id", name: "v1", type: "folder" }] });
    if (url.pathname === "/v1/drive/folders/v1-id/resources") return json({ resources: [{ resourceId: "manifest-id", name: "manifest.json", type: "file" }] });
    if (url.pathname === "/v1/drive/files/manifest-id/download") return json({ downloadUrl: `${apiBase}/v1/malformed-manifest` });
    if (url.pathname === "/v1/malformed-manifest") { res.setHeader("Content-Type", "application/json"); return res.end("{malformed"); }
    res.statusCode = 404;
    return res.end();
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  apiBase = `http://127.0.0.1:${provider.address().port}`;
  const server = await startServer(dataDir, { env: { NAVER_MBOX_TOKEN: "test-token", WEKI_MYBOX_API_BASE: `${apiBase}/v1` } });
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); await new Promise((resolve) => provider.close(resolve)); });

  const response = await fetch(`http://127.0.0.1:${server.port}/api/runtime/components/install-all`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ componentIds: ["document-renderer"] }),
  });
  assert.equal(response.status, 202);
  let runtime = (await response.json()).runtime;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    runtime = await (await fetch(`http://127.0.0.1:${server.port}/api/runtime/components`)).json();
    if (runtime.installBatch.status !== "indexing") break;
    await delay(50);
  }
  assert.equal(runtime.installBatch.status, "failed", JSON.stringify(runtime.installBatch));
  assert.equal(runtime.installBatch.results["document-renderer"].status, "failed");
  assert.match(runtime.installBatch.results["document-renderer"].error, /MYBOX runtime manifest를 읽을 수 없습니다/);
  assert.equal(runtime.installBatch.failed[0].id, "document-renderer");
  assert.equal(runtime.installBatch.unavailable.length, 0);

  const refreshed = await (await fetch(`http://127.0.0.1:${server.port}/api/runtime/components`)).json();
  const renderer = refreshed.components["document-renderer"];
  assert.equal(renderer.status, "failed");
  assert.match(renderer.error, /MYBOX runtime manifest를 읽을 수 없습니다/);
  assert.equal(renderer.sourceType, "mybox");
  assert.equal(renderer.requiresMybox, true);
  assert.equal(renderer.installable, true);
  assert.equal(refreshed.installable["document-renderer"].sourceType, "mybox");
  assert.deepEqual(runtimeAction(renderer, refreshed.installable["document-renderer"]), { label: "재시도", disabled: false });
  const persisted = JSON.parse(await fs.readFile(path.join(dataDir, "runtime", "v1", "component-state.json"), "utf8"));
  assert.equal(persisted.components["document-renderer"].version, null);
  assert.equal(persisted.components["document-renderer"].sourceType, "mybox");
});

test("public runtime retry still requires a manifest and version", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-runtime-public-retry-validation-"));
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  for (const body of [{ source: "public", version: "1.0.0" }, { source: "public", manifest: DEFAULT_RUNTIME_MANIFEST }]) {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/runtime/components/semantic-reranker/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, 400, JSON.stringify(result));
    assert.equal(result.error, "재시도에는 manifest와 version이 필요합니다.");
  }
});

test("valid MYBOX manifests without the requested component are unavailable", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-runtime-mybox-missing-component-"));
  const manifest = {
    format: "weki-runtime-manifest",
    version: 1,
    appCompatibility: ">=1.0.0",
    source: "mybox",
    components: [{
      id: "semantic-reranker",
      version: "1.0.0",
      files: [{ path: "reranker.mjs", size: 0, sha256: "0".repeat(64) }],
    }],
  };
  let apiBase = "";
  const provider = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const json = (value) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); };
    if (url.pathname === "/v1/drive/resources") return json({ resources: [{ resourceId: "wiki-id", name: "wiki", type: "folder" }] });
    if (url.pathname === "/v1/drive/folders/wiki-id/resources") return json({ resources: [{ resourceId: "runtime-id", name: "runtime", type: "folder" }] });
    if (url.pathname === "/v1/drive/folders/runtime-id/resources") return json({ resources: [{ resourceId: "v1-id", name: "v1", type: "folder" }] });
    if (url.pathname === "/v1/drive/folders/v1-id/resources") return json({ resources: [{ resourceId: "manifest-id", name: "manifest.json", type: "file" }] });
    if (url.pathname === "/v1/drive/files/manifest-id/download") return json({ downloadUrl: `${apiBase}/v1/mybox-manifest` });
    if (url.pathname === "/v1/mybox-manifest") return json(manifest);
    res.statusCode = 404;
    return res.end();
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  apiBase = `http://127.0.0.1:${provider.address().port}`;
  const server = await startServer(dataDir, { env: { NAVER_MBOX_TOKEN: "test-token", WEKI_MYBOX_API_BASE: `${apiBase}/v1` } });
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); await new Promise((resolve) => provider.close(resolve)); });

  const response = await fetch(`http://127.0.0.1:${server.port}/api/runtime/components/install-all`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ componentIds: ["document-renderer"] }),
  });
  assert.equal(response.status, 202);
  let runtime = (await response.json()).runtime;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    runtime = await (await fetch(`http://127.0.0.1:${server.port}/api/runtime/components`)).json();
    if (runtime.installBatch.status !== "indexing") break;
    await delay(50);
  }
  const batch = runtime.installBatch;
  assert.equal(batch.status, "partial", JSON.stringify(batch));
  assert.deepEqual(batch.results["document-renderer"], { status: "unavailable", reason: "runtime_pack_not_configured" });
  assert.deepEqual(batch.unavailable, ["document-renderer"]);
  assert.deepEqual(batch.failed, []);
  assert.equal(runtime.components["document-renderer"].reason, "runtime_pack_not_configured");
  assert.match(runtimeBatchMessage(batch), /MYBOX 배포본/);
});

test("clean installs keep the document renderer uninstalled until a runtime pack is present", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-runtime-renderer-missing-"));
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  const status = await (await fetch(`http://127.0.0.1:${server.port}/api/runtime/components`)).json();
  assert.equal(status.components["document-renderer"].status, "missing");
  assert.equal(status.components["document-renderer"].applied, false);
  assert.equal(status.components["document-renderer"].sourceType, "mybox");
  assert.equal(status.components["document-renderer"].requiresMybox, true);
  assert.equal(status.components["document-renderer"].installable, false);
  assert.equal(status.components["document-renderer"].reason, "runtime_pack_not_configured");
});

test("persisted public renderer state stays non-installable without MYBOX metadata", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-runtime-renderer-public-state-"));
  const runtimeDir = path.join(dataDir, "runtime", "v1");
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.writeFile(path.join(runtimeDir, "component-state.json"), JSON.stringify({ format: "weki-runtime-state", version: 1, components: {
    "document-renderer": { id: "document-renderer", status: "failed", version: "1.0.0", sourceType: "public", requiresMybox: true, source: "public-test", error: "download failed" },
  } }));
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  const status = await (await fetch(`http://127.0.0.1:${server.port}/api/runtime/components`)).json();
  const renderer = status.components["document-renderer"];
  assert.equal(renderer.status, "failed");
  assert.equal(renderer.installable, false);
  assert.equal(renderer.sourceType, "mybox");
  assert.equal(renderer.requiresMybox, true);
  assert.equal(renderer.reason, "runtime_pack_not_configured");
  assert.equal(status.installable["document-renderer"], undefined);
  assert.equal(runtimeAction(renderer, status.installable["document-renderer"]), null);
});

test("MYBOX renderer retry uses the MYBOX transport for relative runtime files", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-runtime-mybox-retry-"));
  const bytes = Buffer.from("renderer runtime");
  const manifest = {
    format: "weki-runtime-manifest",
    version: 1,
    appCompatibility: ">=1.0.0",
    source: "mybox",
    components: [{
      id: "document-renderer",
      version: "1.0.0",
      files: [{ path: "renderer.bin", size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") }],
    }],
  };
  let remoteManifest = {
    ...manifest,
    components: [{ ...manifest.components[0], files: [{ ...manifest.components[0].files[0], sha256: "0".repeat(64) }] }],
  };
  let apiBase = "";
  const provider = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const json = (value) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); };
    if (url.pathname === "/v1/drive/resources") return json({ resources: [{ resourceId: "wiki-id", name: "wiki", type: "folder" }] });
    if (url.pathname === "/v1/drive/folders/wiki-id/resources") return json({ resources: [{ resourceId: "runtime-id", name: "runtime", type: "folder" }] });
    if (url.pathname === "/v1/drive/folders/runtime-id/resources") return json({ resources: [{ resourceId: "v1-id", name: "v1", type: "folder" }] });
    if (url.pathname === "/v1/drive/folders/v1-id/resources") return json({ resources: [{ resourceId: "manifest-id", name: "manifest.json", type: "file" }, { resourceId: "renderer-id", name: "document-renderer", type: "folder" }] });
    if (url.pathname === "/v1/drive/folders/renderer-id/resources") return json({ resources: [{ resourceId: "version-id", name: "1.0.0", type: "folder" }] });
    if (url.pathname === "/v1/drive/folders/version-id/resources") return json({ resources: [{ resourceId: "renderer-file-id", name: "renderer.bin", type: "file" }] });
    if (url.pathname === "/v1/drive/files/manifest-id/download") return json({ downloadUrl: `${apiBase}/mock/manifest` });
    if (url.pathname === "/v1/drive/files/renderer-file-id/download") return json({ downloadUrl: `${apiBase}/mock/renderer` });
    if (url.pathname === "/v1/mock/manifest") return json(remoteManifest);
    if (url.pathname === "/v1/mock/renderer") { res.setHeader("Content-Type", "application/octet-stream"); return res.end(bytes); }
    res.statusCode = 404;
    return res.end();
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  apiBase = `http://127.0.0.1:${provider.address().port}/v1`;
  const server = await startServer(dataDir, { env: { NAVER_MBOX_TOKEN: "test-token", WEKI_MYBOX_API_BASE: apiBase } });
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); await new Promise((resolve) => provider.close(resolve)); });

  const failedInstall = await fetch(`http://127.0.0.1:${server.port}/api/runtime/components/install`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "mybox", componentId: "document-renderer", version: "1.0.0" }),
  });
  const failedBody = await failedInstall.json();
  assert.equal(failedInstall.status, 400, JSON.stringify(failedBody));
  const failedRenderer = failedBody.runtime.components["document-renderer"];
  assert.equal(failedRenderer.status, "failed");
  assert.equal(failedRenderer.sourceType, "mybox");
  assert.equal(failedRenderer.requiresMybox, true);
  assert.equal(failedRenderer.installable, true);
  assert.deepEqual(runtimeAction(failedRenderer, failedBody.runtime.installable["document-renderer"]), { label: "재시도", disabled: false });

  remoteManifest = manifest;

  const spoofedRetry = await fetch(`http://127.0.0.1:${server.port}/api/runtime/components/document-renderer/retry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: "1.0.0", manifest: { ...manifest, components: [{ ...manifest.components[0], files: [{ ...manifest.components[0].files[0], url: "data:application/octet-stream;base64,c3Bvb2ZlZA==" }] }] } }),
  });
  const spoofedRetryBody = await spoofedRetry.json();
  assert.equal(spoofedRetry.status, 400, JSON.stringify(spoofedRetryBody));
  assert.match(spoofedRetryBody.error, /MYBOX/);

  const contradictoryRetry = await fetch(`http://127.0.0.1:${server.port}/api/runtime/components/document-renderer/retry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "public", version: "1.0.0", manifest }),
  });
  const contradictoryRetryBody = await contradictoryRetry.json();
  assert.equal(contradictoryRetry.status, 400, JSON.stringify(contradictoryRetryBody));
  assert.match(contradictoryRetryBody.error, /출처/);

  const response = await fetch(`http://127.0.0.1:${server.port}/api/runtime/components/document-renderer/retry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "mybox" }),
  });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.component.status, "ready");
  assert.deepEqual(await fs.readFile(path.join(dataDir, "runtime", "v1", "document-renderer", "1.0.0", "renderer.bin")), bytes);
});

test("default runtime catalog installs the bundled semantic reranker pack", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-runtime-reranker-default-"));
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  const status = await (await fetch(`http://127.0.0.1:${server.port}/api/runtime/components`)).json();
  assert.equal(status.installable["semantic-model"].sourceType, "public");
  assert.equal(status.installable["semantic-model"].source, "https://huggingface.co/intfloat/multilingual-e5-small");
  assert.equal(status.installable["semantic-reranker"].sourceType, "bundled");

  const response = await fetch(`http://127.0.0.1:${server.port}/api/runtime/components/install`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ componentId: "semantic-reranker", version: "1.0.0" }),
  });
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.component.id, "semantic-reranker");
  assert.equal(body.component.status, "ready");
  assert.equal(body.component.sourceType, "bundled");
  assert.equal(body.component.source, "Weki bundled runtime pack");
  assert.equal(await fs.readFile(path.join(dataDir, "runtime", "v1", "semantic-reranker", "1.0.0", "reranker.mjs"), "utf8").then((value) => value.includes("export async function rerank")), true);
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
        sourceType: "bundled",
        source: "Weki bundled runtime pack",
        requiresMybox: false,
      },
    },
  }));
  const server = await startServer(dataDir);
  t.after(async () => { server.child.kill(); await delay(200); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  const status = await (await fetch(`http://127.0.0.1:${server.port}/api/runtime/components`)).json();
  assert.equal(status.components["document-renderer"].status, "ready");
  assert.equal(status.components["document-renderer"].applied, true);
  assert.equal(status.components["document-renderer"].version, "0.8.4");
  assert.equal(status.components["document-renderer"].sourceType, "bundled");
  assert.equal(status.components["document-renderer"].requiresMybox, false);
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
