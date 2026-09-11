import assert from "node:assert/strict";
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
async function startServer(t, env = {}, initialDatabase = null, { useIpc = false } = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-ai-settings-api-"));
  if (initialDatabase) await fs.writeFile(path.join(dataDir, "knowledge-base.json"), JSON.stringify(initialDatabase));
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
  child.send({ type: "weki:gemini-credential", apiKey }, (error) => error ? reject(error) : resolve());
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

async function waitForDatabase(dataDir, predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const database = JSON.parse(await fs.readFile(path.join(dataDir, "knowledge-base.json"), "utf8"));
      if (predicate(database)) return database;
    } catch {}
    await delay(100);
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
