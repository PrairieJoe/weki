import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

let nextPort = 5450;
async function startServer(t, env = {}, initialDatabase = null) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-ai-settings-api-"));
  if (initialDatabase) await fs.writeFile(path.join(dataDir, "knowledge-base.json"), JSON.stringify(initialDatabase));
  const port = nextPort++;
  const child = spawn(process.execPath, ["server.mjs"], { cwd: path.resolve("."), env: { ...process.env, WEKI_DATA_DIR: dataDir, WEKI_PORT: String(port), WEKI_DISABLE_ENV_FILE: "1", WEKI_DISABLE_INITIAL_MYBOX_SYNC: "1", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/status`)).ok) break; } catch {}
    if (attempt === 99) throw new Error(`server did not start: ${output}`);
    await delay(100);
  }
  t.after(async () => { child.kill(); await delay(150); await fs.rm(dataDir, { recursive: true, force: true }); });
  return { port, dataDir };
}
const json = async (response) => ({ response, body: await response.json() });

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
  const provider = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url.startsWith("/v1beta/models/") && req.url.includes(":generateContent")) { checkBody = body; return res.end(JSON.stringify({ secret, candidates: [{ content: { parts: [{ text: "ping response" }] } }] })); }
      if (req.url.startsWith("/v1beta/models")) return res.end(JSON.stringify({ secret, models: [{ name: "models/gemini-test", displayName: "Test", supportedGenerationMethods: ["generateContent"] }] }));
      res.statusCode = 404; return res.end("{}");
    });
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const server = await startServer(t, { WEKI_GEMINI_API_KEY: secret, WEKI_GEMINI_API_BASE: `http://127.0.0.1:${provider.address().port}/v1beta` });
  t.after(async () => { await new Promise((resolve) => provider.close(resolve)); });
  const patch = await json(await fetch(`http://127.0.0.1:${server.port}/api/settings`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ defaultProcessingMode: "external-ai", externalAi: { modelId: "gemini-test", consentVersion: 1 } }) }));
  assert.equal(patch.response.status, 200);
  const models = await json(await fetch(`http://127.0.0.1:${server.port}/api/ai/gemini/models`));
  assert.equal(models.response.status, 200, JSON.stringify(models.body));
  assert.deepEqual(models.body.models, [{ id: "gemini-test", displayName: "Test", supportsGenerateContent: true }]);
  const check = await json(await fetch(`http://127.0.0.1:${server.port}/api/ai/gemini/check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ document: "must not be sent" }) }));
  assert.equal(check.response.status, 200, JSON.stringify(check.body));
  assert.match(checkBody, /"ping"/);
  assert.doesNotMatch(checkBody, /must not be sent/);
  assert.doesNotMatch(JSON.stringify({ patch: patch.body, models: models.body, check: check.body }), /AIza-provider-response-secret|ping response/);
});
