import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clearEncryptedToken, credentialPath, bootstrapPath, consumeTokenBootstrap, loadEncryptedToken, writeEncryptedToken } from "../src/server/mybox-credentials.mjs";

async function tempStore() {
  return fs.mkdtemp(path.join(os.tmpdir(), "weki-credentials-test-"));
}

test("MYBOX bootstrap token is converted to an encrypted record and removed", async () => {
  const dataDir = await tempStore();
  await fs.mkdir(path.dirname(bootstrapPath(dataDir)), { recursive: true });
  await fs.writeFile(bootstrapPath(dataDir), "  bootstrap-secret  ", "utf8");

  const result = await consumeTokenBootstrap(dataDir, async (token) => { assert.equal(token, "bootstrap-secret"); return "ciphertext:opaque"; });
  assert.equal(result.state, "stored");
  assert.equal(await fs.readFile(credentialPath(dataDir), "utf8"), JSON.stringify({ format: "weki-credential", version: 1, provider: "mybox", ciphertext: "ciphertext:opaque" }, null, 2));
  await assert.rejects(fs.access(bootstrapPath(dataDir)));
});

test("MYBOX credential file contains ciphertext only and can be decrypted", async () => {
  const dataDir = await tempStore();
  await writeEncryptedToken(dataDir, "ciphertext:opaque");
  const raw = await fs.readFile(credentialPath(dataDir), "utf8");
  assert.doesNotMatch(raw, /secret-value/);
  assert.deepEqual(await loadEncryptedToken(dataDir, async (ciphertext) => { assert.equal(ciphertext, "ciphertext:opaque"); return "secret-value"; }), { state: "available", token: "secret-value" });
});

test("MYBOX credential failures are reported without enabling a plaintext fallback", async () => {
  const dataDir = await tempStore();
  await writeEncryptedToken(dataDir, "ciphertext:opaque");
  assert.equal((await loadEncryptedToken(dataDir, async () => { throw new Error("DPAPI failure"); })).state, "unreadable");
  assert.equal((await loadEncryptedToken(path.join(dataDir, "missing"), async () => "never")).state, "missing");
});

test("clearing a MYBOX credential removes only the encrypted local record", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-credential-clear-test-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await writeEncryptedToken(dataDir, "ciphertext:opaque");
  await fs.mkdir(path.join(dataDir, "originals"), { recursive: true });
  await fs.writeFile(path.join(dataDir, "originals", "keep.txt"), "keep");

  await clearEncryptedToken(dataDir);

  await assert.rejects(fs.access(credentialPath(dataDir)));
  assert.equal(await fs.readFile(path.join(dataDir, "originals", "keep.txt"), "utf8"), "keep");
});
