import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("external AI credentials use a ciphertext-only file and no forbidden persistence surfaces", async (t) => {
  const { saveExternalAiCredential, credentialStatus, credentialPath } = await import("../src/server/ai-credentials.mjs");
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-ai-credentials-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const apiKey = "AIza-v1.2.3-contract-secret";
  const result = await saveExternalAiCredential({ dataDir, apiKey });
  const raw = await fs.readFile(credentialPath(dataDir), "utf8");
  const record = JSON.parse(raw);
  assert.deepEqual(Object.keys(record).sort(), ["ciphertext", "format", "provider", "version"]);
  assert.equal(record.provider, "gemini");
  assert.notEqual(record.ciphertext, apiKey);
  assert.doesNotMatch(raw, new RegExp(apiKey));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(apiKey));
  assert.doesNotMatch(JSON.stringify(await credentialStatus({ dataDir })), new RegExp(apiKey));
  const entries = await fs.readdir(dataDir, { recursive: true });
  assert.deepEqual(entries.filter((entry) => /settings|sqlite|knowledge-base|document|log/i.test(entry)), []);
  await assert.rejects(() => saveExternalAiCredential({ dataDir, apiKey, fail: true }), (error) => {
    assert.doesNotMatch(JSON.stringify(error), new RegExp(apiKey));
    return true;
  });
});
