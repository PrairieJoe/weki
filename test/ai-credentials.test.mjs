import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAiCredentialsStore } from "../src/server/ai-credentials.mjs";

async function temporaryFile(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "weki-ai-credentials-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return path.join(directory, "credentials", "gemini-api-key.json");
}

function safeStorage({ available = true, decrypt = () => "AIza-test-key", encrypted = () => {} } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => { encrypted(value); return Buffer.from(`ciphertext:${value}`, "utf8"); },
    decryptString: (value) => decrypt(value),
  };
}

test("Gemini credentials reject an empty API key", async (t) => {
  const store = createAiCredentialsStore({ filePath: await temporaryFile(t), safeStorage: safeStorage() });

  await assert.rejects(() => store.saveApiKey("   "), { code: "INVALID_API_KEY" });
});

test("Gemini credentials encrypt into a ciphertext-only record through an atomic rename", async (t) => {
  const filePath = await temporaryFile(t);
  const operations = [];
  const fsImpl = {
    ...fs,
    writeFile: async (...args) => { operations.push("write"); return fs.writeFile(...args); },
    rename: async (...args) => { operations.push("rename"); return fs.rename(...args); },
  };
  const key = "AIza-v1.2.3-contract-secret";
  const encrypted = [];
  const store = createAiCredentialsStore({ filePath, safeStorage: safeStorage({ encrypted: (value) => encrypted.push(value) }), fsImpl });

  assert.deepEqual(await store.saveApiKey(` ${key} `), { provider: "gemini", configured: true });
  const raw = await fs.readFile(filePath, "utf8");
  const record = JSON.parse(raw);

  assert.deepEqual(Object.keys(record).sort(), ["ciphertext", "format", "provider", "version"]);
  assert.deepEqual(record, { format: "weki-credential", provider: "gemini", version: 1, ciphertext: Buffer.from(`ciphertext:${key}`).toString("base64") });
  assert.deepEqual(encrypted, [key]);
  assert.doesNotMatch(raw, new RegExp(key));
  assert.deepEqual(operations, ["write", "rename"]);
  assert.deepEqual((await fs.readdir(path.dirname(filePath))).filter((entry) => entry.endsWith(".tmp")), []);
});

test("Gemini credentials overwrite an existing record", async (t) => {
  const filePath = await temporaryFile(t);
  const store = createAiCredentialsStore({ filePath, safeStorage: safeStorage() });

  await store.saveApiKey("AIza-first");
  await store.saveApiKey("AIza-second");

  assert.equal(JSON.parse(await fs.readFile(filePath, "utf8")).ciphertext, Buffer.from("ciphertext:AIza-second").toString("base64"));
});

test("Gemini status never returns plaintext and clearing makes it unconfigured", async (t) => {
  const filePath = await temporaryFile(t);
  const key = "AIza-status-secret";
  const store = createAiCredentialsStore({ filePath, safeStorage: safeStorage({ decrypt: () => key }) });

  await store.saveApiKey(key);
  assert.deepEqual(await store.getStatus(), { provider: "gemini", configured: true, encryptionAvailable: true });
  assert.doesNotMatch(JSON.stringify(await store.getStatus()), new RegExp(key));
  assert.deepEqual(await store.clearApiKey(), { provider: "gemini", configured: false });
  assert.deepEqual(await store.getStatus(), { provider: "gemini", configured: false, encryptionAvailable: true });
});

test("Gemini credentials fail explicitly when encryption is unavailable", async (t) => {
  const store = createAiCredentialsStore({ filePath: await temporaryFile(t), safeStorage: safeStorage({ available: false }) });

  await assert.rejects(() => store.saveApiKey("AIza-key"), { code: "ENCRYPTION_UNAVAILABLE" });
  assert.deepEqual(await store.getStatus(), { provider: "gemini", configured: false, encryptionAvailable: false });
});

test("a failed write keeps the existing Gemini credential and removes its temporary file", async (t) => {
  const filePath = await temporaryFile(t);
  const store = createAiCredentialsStore({ filePath, safeStorage: safeStorage() });
  await store.saveApiKey("AIza-existing");
  const before = await fs.readFile(filePath, "utf8");
  const fsImpl = { ...fs, rename: async () => { throw Object.assign(new Error("rename failed"), { code: "EIO" }); } };
  const failingStore = createAiCredentialsStore({ filePath, safeStorage: safeStorage(), fsImpl });

  await assert.rejects(() => failingStore.saveApiKey("AIza-new"), { code: "EIO" });
  assert.equal(await fs.readFile(filePath, "utf8"), before);
  assert.deepEqual((await fs.readdir(path.dirname(filePath))).filter((entry) => entry.endsWith(".tmp")), []);
});
