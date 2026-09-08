import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createSearchStore } from "../src/search/sqlite-store.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let nextPort = 5400;

async function startServer(dataDir) {
  const port = nextPort++;
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: projectRoot,
    env: { ...process.env, WEKI_DATA_DIR: dataDir, WEKI_SEARCH_V2: "1", WEKI_PORT: String(port), WEKI_DISABLE_INITIAL_MYBOX_SYNC: "1", WEKI_DISABLE_ENV_FILE: "1" },
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
