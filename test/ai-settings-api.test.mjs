import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createAiCredentialsStore } from "../src/server/ai-credentials.mjs";
import JSZip from "jszip";

let nextPort = 5450;
async function startServer(t, env = {}, initialDatabase = null, { useIpc = false, initialFiles = [] } = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-ai-settings-api-"));
  if (initialDatabase) {
    const seededDatabase = JSON.parse(JSON.stringify(initialDatabase));
    for (const job of seededDatabase.jobs || []) if (typeof job.stagedPath === "string" && job.stagedPath.startsWith("$DATA_DIR/")) job.stagedPath = path.join(dataDir, job.stagedPath.slice("$DATA_DIR/".length));
    await fs.writeFile(path.join(dataDir, "knowledge-base.json"), JSON.stringify(seededDatabase));
  }
  for (const [relativePath, contents] of initialFiles) {
    const target = path.join(dataDir, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
  }
  const port = nextPort++;
  const child = spawn(process.execPath, ["server.mjs"], { cwd: path.resolve("."), env: { ...process.env, WEKI_DATA_DIR: dataDir, WEKI_PORT: String(port), WEKI_DISABLE_ENV_FILE: "1", WEKI_DISABLE_INITIAL_MYBOX_SYNC: "1", ...env }, stdio: useIpc ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/status`)).ok) break; } catch {}
    if (attempt === 99) throw new Error(`server did not start: ${output}`);
    await delay(100);
  }
  t.after(async () => { child.kill(); await delay(150); await fs.rm(dataDir, { recursive: true, force: true }); });
  return { port, dataDir, child };
}
const json = async (response) => ({ response, body: await response.json() });
const testSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(Buffer.from(value, "utf8").toString("base64"), "utf8"),
  decryptString: (value) => Buffer.from(value.toString("utf8"), "base64").toString("utf8"),
};
const sendStoredCredential = (child, apiKey) => new Promise((resolve, reject) => {
  let settled = false;
  const finish = (error) => {
    if (settled) return;
    settled = true;
    child.removeListener("message", onMessage);
    if (error) reject(error); else resolve();
  };
  const onMessage = (message) => { if (message?.type === "weki-gemini-credential-applied") finish(); };
  child.on("message", onMessage);
  try { child.send({ type: "weki:gemini-credential", apiKey }, (error) => { if (error) finish(error); }); }
  catch (error) { finish(error); }
});
async function docxFixture(text = "external enrichment fixture") {
  const zip = new JSZip();
  zip.file("word/document.xml", `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

test("AI status exposes provider state without credential material", async (t) => {
  const server = await startServer(t, { WEKI_GEMINI_API_KEY: "AIza-settings-contract-secret" });
  const result = await json(await fetch(`http://127.0.0.1:${server.port}/api/status`));
  assert.equal(result.response.status, 200);
  assert.doesNotMatch(JSON.stringify(result.body), /AIza-settings-contract-secret/);
  assert.equal(result.body.processing.externalAi.provider, "gemini");
  assert.equal(result.body.processing.externalAi.enabled, false);
});

test("external AI requires consent version 1 on every off-to-on transition", async (t) => {
  const server = await startServer(t);
  const call = (body) => fetch(`http://127.0.0.1:${server.port}/api/settings`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await call({ defaultProcessingMode: "external-ai" })).status, 409);
  assert.equal((await call({ defaultProcessingMode: "external-ai", externalAi: { consentVersion: 0 } })).status, 409);
  assert.equal((await call({ defaultProcessingMode: "external-ai", externalAi: { consentVersion: 1 } })).status, 200);
  assert.equal((await call({ defaultProcessingMode: "auto" })).status, 200);
  assert.equal((await call({ defaultProcessingMode: "external-ai" })).status, 409);
  assert.equal((await call({ defaultProcessingMode: "external-ai", externalAi: { consentVersion: 1 } })).status, 200);
});

test("preference saving is allowed before key/model setup but reports not-ready", async (t) => {
  const server = await startServer(t);
  const result = await json(await fetch(`http://127.0.0.1:${server.port}/api/settings`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ defaultProcessingMode: "external-ai", externalAi: { consentVersion: 1 } }) }));
  assert.equal(result.response.status, 200);
  assert.equal(result.body.processing.externalAi.ready, false);
  assert.equal(result.body.processing.externalAi.configured, false);
  assert.equal(result.body.processing.externalAi.modelSelected, false);
});

test("model and connection routes omit raw provider responses and document bodies", async (t) => {
  const secret = "AIza-provider-response-secret";
  let checkBody = "";
  let providerReceivedConfiguredKey = false;
  const provider = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      providerReceivedConfiguredKey ||= new URL(`http://provider${req.url}`).searchParams.get("key") === secret;
      res.setHeader("content-type", "application/json");
      if (req.url.startsWith("/v1beta/models/") && req.url.includes(":generateContent")) { checkBody = body; return res.end(JSON.stringify({ secret, candidates: [{ content: { parts: [{ text: "ping response" }] } }] })); }
      if (req.url.startsWith("/v1beta/models")) return res.end(JSON.stringify({ secret, models: [{ name: "models/gemini-test", displayName: "Test", supportedGenerationMethods: ["generateContent"] }] }));
      res.statusCode = 404; return res.end("{}");
    });
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const server = await startServer(t, { WEKI_GEMINI_API_BASE: `http://127.0.0.1:${provider.address().port}/v1beta` }, null, { useIpc: true });
  t.after(async () => { await new Promise((resolve) => provider.close(resolve)); });
  const credentialStore = createAiCredentialsStore({ filePath: path.join(server.dataDir, "credentials", "gemini-api-key.json"), safeStorage: testSafeStorage });
  await credentialStore.saveApiKey(secret);
  await sendStoredCredential(server.child, await credentialStore.getApiKeyForServer());
  const patch = await json(await fetch(`http://127.0.0.1:${server.port}/api/settings`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ defaultProcessingMode: "external-ai", externalAi: { modelId: "gemini-test", consentVersion: 1 } }) }));
  assert.equal(patch.response.status, 200);
  const models = await json(await fetch(`http://127.0.0.1:${server.port}/api/ai/gemini/models`));
  assert.equal(models.response.status, 200, JSON.stringify(models.body));
  assert.deepEqual(models.body.models, [{ id: "gemini-test", displayName: "Test", supportsGenerateContent: true }]);
  const check = await json(await fetch(`http://127.0.0.1:${server.port}/api/ai/gemini/check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ document: "must not be sent" }) }));
  assert.equal(check.response.status, 200, JSON.stringify(check.body));
  assert.equal(providerReceivedConfiguredKey, true);
  assert.match(checkBody, /"ping"/);
  assert.doesNotMatch(checkBody, /must not be sent/);
  assert.doesNotMatch(JSON.stringify({ patch: patch.body, models: models.body, check: check.body }), /AIza-provider-response-secret|ping response/);
});

test("credential reload clears a persisted external connection status without exposing the key", async (t) => {
  const secret = "AIza-credential-reload-secret";
  const server = await startServer(t, {}, {
    settings: {
      defaultProcessingMode: "external-ai",
      externalAi: {
        modelId: "gemini-test",
        consentVersion: 1,
        lastConnection: { status: "ready", checkedAt: "2026-09-11T00:00:00.000Z", errorCode: null },
      },
    },
    documents: [], jobs: [], audit: [],
  }, { useIpc: true });
  const credentialStore = createAiCredentialsStore({ filePath: path.join(server.dataDir, "credentials", "gemini-api-key.json"), safeStorage: testSafeStorage });
  await credentialStore.saveApiKey(secret);
  await sendStoredCredential(server.child, await credentialStore.getApiKeyForServer());

  const result = await json(await fetch(`http://127.0.0.1:${server.port}/api/settings`));
  assert.equal(result.response.status, 200);
  assert.equal(result.body.externalAi.configured, true);
  assert.equal(result.body.externalAi.ready, false);
  assert.equal(result.body.externalAi.lastConnection.status, "unknown");
  assert.equal(result.body.settings.externalAi.lastConnection.status, "unknown");
  assert.doesNotMatch(JSON.stringify(result.body), new RegExp(secret));
  const stored = JSON.parse(await fs.readFile(path.join(server.dataDir, "knowledge-base.json"), "utf8"));
  assert.equal(stored.settings.externalAi.lastConnection.status, "unknown");
  assert.doesNotMatch(JSON.stringify(stored), new RegExp(secret));
});

test("legacy queued jobs execute from mode when no processing policy snapshot exists", async (t) => {
  const localBytes = await docxFixture("legacy local ai page");
  const lightweightBytes = await docxFixture("legacy lightweight page");
  const fallbackBytes = await docxFixture("snapshotted fallback page");
  const server = await startServer(t, {}, {
    settings: {},
    documents: [],
    jobs: [
      { id: "legacy-local-job", kind: "registration", name: "legacy-local.docx", mode: "local-ai", status: "queued", progress: 0, hash: "legacy-local-hash", ext: "docx", size: localBytes.length, stagedPath: "$DATA_DIR/incoming/legacy-local.docx", createdAt: "2026-09-11T00:00:00.000Z" },
      { id: "legacy-lightweight-job", kind: "registration", name: "legacy-lightweight.docx", mode: "lightweight", status: "queued", progress: 0, hash: "legacy-lightweight-hash", ext: "docx", size: lightweightBytes.length, stagedPath: "$DATA_DIR/incoming/legacy-lightweight.docx", createdAt: "2026-09-11T00:00:01.000Z" },
      { id: "snapshotted-fallback-job", kind: "registration", name: "snapshotted-fallback.docx", mode: "external-ai", processingPolicy: { requestedMode: "external-ai", effectiveMode: "lightweight", provider: null, modelId: null, fallbackReason: "external_ai_not_configured" }, status: "queued", progress: 0, hash: "snapshotted-fallback-hash", ext: "docx", size: fallbackBytes.length, stagedPath: "$DATA_DIR/incoming/snapshotted-fallback.docx", createdAt: "2026-09-11T00:00:02.000Z" },
    ],
    audit: [],
  }, { initialFiles: [["incoming/legacy-local.docx", localBytes], ["incoming/legacy-lightweight.docx", lightweightBytes], ["incoming/snapshotted-fallback.docx", fallbackBytes]] });
  const database = await waitForDatabase(server.dataDir, (value) => value.documents.length === 3 && value.jobs.every((job) => job.status === "completed"), 25_000);
  const localDocument = database.documents.find((document) => document.name === "legacy-local.docx");
  const lightweightDocument = database.documents.find((document) => document.name === "legacy-lightweight.docx");
  const fallbackDocument = database.documents.find((document) => document.name === "snapshotted-fallback.docx");
  const localJob = database.jobs.find((job) => job.id === "legacy-local-job");
  const lightweightJob = database.jobs.find((job) => job.id === "legacy-lightweight-job");
  const fallbackJob = database.jobs.find((job) => job.id === "snapshotted-fallback-job");

  assert.equal(localDocument.processingPolicy.requestedMode, "local-ai");
  assert.equal(localDocument.processingMode, "lightweight");
  assert.equal(localDocument.processingModeFallback, "semantic_model_unavailable");
  assert.equal(localJob.requestedProcessingMode, "local-ai");
  assert.equal(localJob.processingModeFallback, "semantic_model_unavailable");
  assert.equal(lightweightDocument.processingPolicy.requestedMode, "lightweight");
  assert.equal(lightweightDocument.processingMode, "lightweight");
  assert.equal(lightweightJob.requestedProcessingMode, "lightweight");
  assert.equal(fallbackDocument.processingPolicy.requestedMode, "external-ai");
  assert.equal(fallbackDocument.processingPolicy.effectiveMode, "lightweight");
  assert.equal(fallbackDocument.processingModeFallback, "external_ai_not_configured");
  assert.match(fallbackJob.detail, /^경량 처리/);
});

test("reprocess progress uses the snapshotted effective mode", async (t) => {
  const bytes = await docxFixture("reprocess snapshot page");
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  const name = "reprocess-snapshot.docx";
  const server = await startServer(t, {}, {
    settings: {},
    documents: [{ id: "reprocess-snapshot-document", name, originalName: name, format: "DOCX", hash, originalKey: `${hash}/${name}`, sourceStatus: "local_available", processingStatus: "completed", units: [{ id: "old-unit", range: 1, text: "old text" }] }],
    jobs: [{ id: "reprocess-snapshot-job", kind: "reprocess", name, documentId: "reprocess-snapshot-document", mode: "external-ai", processingPolicy: { requestedMode: "external-ai", effectiveMode: "lightweight", provider: null, modelId: null, fallbackReason: "external_ai_not_configured" }, status: "queued", progress: 0, createdAt: "2026-09-11T00:00:00.000Z" }],
    audit: [],
  }, { initialFiles: [[`originals/${hash}/${name}`, bytes]] });
  const database = await waitForDatabase(server.dataDir, (value) => value.jobs.some((job) => job.id === "reprocess-snapshot-job" && job.status === "completed"), 25_000);
  const document = database.documents.find((item) => item.id === "reprocess-snapshot-document");
  const job = database.jobs.find((item) => item.id === "reprocess-snapshot-job");

  assert.equal(document.processingPolicy.effectiveMode, "lightweight");
  assert.equal(document.processingModeFallback, "external_ai_not_configured");
  assert.match(job.detail, /^경량 처리/);
});

test("explicit external document registration requires consent before queueing", async (t) => {
  const server = await startServer(t);
  const form = new FormData();
  form.append("mode", "external-ai");
  form.append("files", new Blob(["not a real document"]), "consent-required.docx");
  const result = await json(await fetch(`http://127.0.0.1:${server.port}/api/documents`, { method: "POST", body: form }));

  assert.equal(result.response.status, 409);
  assert.equal(result.body.code, "external_ai_consent_required");
  const stored = JSON.parse(await fs.readFile(path.join(server.dataDir, "knowledge-base.json"), "utf8"));
  assert.deepEqual(stored.jobs, []);
});

async function waitForDatabase(dataDir, predicate, timeoutMs = 15_000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const database = JSON.parse(await fs.readFile(path.join(dataDir, "knowledge-base.json"), "utf8"));
      if (predicate(database)) return database;
    } catch {}
    await delay(intervalMs);
  }
  throw new Error("database did not reach the expected processing state");
}

test("external registration snapshots policy across settings OFF and records enrichment fallback audit", async (t) => {
  const secret = "AIza-external-registration-secret";
  let failEnrichment = false;
  const provider = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url.startsWith("/v1beta/models/") && req.url.includes(":generateContent")) {
        if (failEnrichment && !body.includes('"ping"')) { res.statusCode = 500; return res.end(JSON.stringify({ error: "simulated provider failure" })); }
        if (body.includes('"ping"')) return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ping response" }] } }] }));
        return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ summary: "generated summary", topic: "generated topic", keywords: ["generated"], visualDescriptions: [] }) }] } }] }));
      }
      if (req.url.startsWith("/v1beta/models")) return res.end(JSON.stringify({ models: [{ name: "models/gemini-test", displayName: "Test", supportedGenerationMethods: ["generateContent"] }] }));
      res.statusCode = 404; return res.end("{}");
    });
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const server = await startServer(t, { WEKI_GEMINI_API_BASE: `http://127.0.0.1:${provider.address().port}/v1beta` }, null, { useIpc: true });
  t.after(async () => { await new Promise((resolve) => provider.close(resolve)); });
  const credentialStore = createAiCredentialsStore({ filePath: path.join(server.dataDir, "credentials", "gemini-api-key.json"), safeStorage: testSafeStorage });
  await credentialStore.saveApiKey(secret);
  await sendStoredCredential(server.child, await credentialStore.getApiKeyForServer());
  const setExternal = () => fetch(`http://127.0.0.1:${server.port}/api/settings`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ defaultProcessingMode: "external-ai", externalAi: { modelId: "gemini-test", consentVersion: 1 } }) });
  assert.equal((await setExternal()).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${server.port}/api/ai/gemini/check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ document: "must not be sent" }) })).status, 200);

  const firstForm = new FormData();
  firstForm.append("mode", "external-ai");
  firstForm.append("consentVersion", "1");
  firstForm.append("files", new Blob([await docxFixture("first external page")]), "external-snapshot-one.docx");
  const first = await json(await fetch(`http://127.0.0.1:${server.port}/api/documents`, { method: "POST", body: firstForm }));
  assert.equal(first.response.status, 202, JSON.stringify(first.body));
  assert.equal(first.body.processing.effectiveMode, "external-ai");
  assert.equal((await fetch(`http://127.0.0.1:${server.port}/api/settings`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ defaultProcessingMode: "auto" }) })).status, 200);

  const afterFirst = await waitForDatabase(server.dataDir, (database) => database.documents.some((document) => document.name === "external-snapshot-one.docx"));
  const firstDocument = afterFirst.documents.find((document) => document.name === "external-snapshot-one.docx");
  const firstJob = afterFirst.jobs.find((job) => job.name === firstDocument.name);
  assert.deepEqual(firstDocument.processingPolicy, { requestedMode: "external-ai", effectiveMode: "external-ai", provider: "gemini", modelId: "gemini-test", fallbackReason: null });
  assert.deepEqual(firstJob.processingPolicy, firstDocument.processingPolicy);
  assert.equal(firstDocument.units[0].generatedMetadata.summary, "generated summary");
  assert.ok(afterFirst.audit.some((entry) => entry.type === "external-ai" && entry.status === "success"));

  await setExternal();
  failEnrichment = true;
  const secondForm = new FormData();
  secondForm.append("mode", "external-ai");
  secondForm.append("consentVersion", "1");
  secondForm.append("files", new Blob([await docxFixture("second external page")]), "external-fallback-two.docx");
  const second = await json(await fetch(`http://127.0.0.1:${server.port}/api/documents`, { method: "POST", body: secondForm }));
  assert.equal(second.response.status, 202, JSON.stringify(second.body));
  const afterSecond = await waitForDatabase(server.dataDir, (database) => database.documents.some((document) => document.name === "external-fallback-two.docx"));
  const secondDocument = afterSecond.documents.find((document) => document.name === "external-fallback-two.docx");
  assert.equal(secondDocument.processingMode, "lightweight");
  assert.equal(secondDocument.processingModeFallback, "external_ai_provider_error");
  assert.ok(afterSecond.audit.some((entry) => entry.type === "external-ai" && entry.status === "failed" && entry.errorCode === "external_ai_provider_error"));
  assert.doesNotMatch(await fs.readFile(path.join(server.dataDir, "knowledge-base.json"), "utf8"), new RegExp(secret));
});
