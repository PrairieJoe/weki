import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  canonicalManifestPayload,
  validateManifest,
  verifyManifestSignature,
  installComponent,
  getComponentState,
} from "../src/runtime/components.mjs";

test("runtime manifest validates hashes, compatibility and Ed25519 signature", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const manifest = { format: "weki-runtime-manifest", version: 1, appCompatibility: ">=1.0.0", components: [{ id: "semantic-model", version: "1.0.0", files: [{ path: "model.onnx", size: 3, sha256: crypto.createHash("sha256").update("abc").digest("hex") }] }] };
  const signature = crypto.sign(null, Buffer.from(canonicalManifestPayload(manifest)), privateKey).toString("base64");
  const signed = { ...manifest, signature };
  assert.equal(validateManifest(signed).ok, true);
  assert.equal(verifyManifestSignature(signed, publicKey), true);
  assert.equal(validateManifest({ ...signed, components: [] }).ok, false);
});

test("component install uses partial staging, hash verification and atomic promotion", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "weki-runtime-"));
  const bytes = Buffer.from("abc");
  const manifest = { format: "weki-runtime-manifest", version: 1, appCompatibility: ">=1.0.0", components: [{ id: "semantic-model", version: "1.0.0", files: [{ path: "model.onnx", size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), url: "https://example.test/model.onnx" }] }] };
  const result = await installComponent({ rootDirectory: root, manifest, componentId: "semantic-model", version: "1.0.0", fetchImpl: async () => new Response(bytes) });
  assert.equal(result.status, "ready");
  assert.deepEqual(await fs.readFile(path.join(root, "semantic-model", "1.0.0", "model.onnx")), bytes);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8")).version, 1);
  assert.equal((await getComponentState(root)).components["semantic-model"].status, "ready");
  await assert.rejects(() => installComponent({ rootDirectory: root, manifest, componentId: "semantic-model", version: "1.0.0", fetchImpl: async () => new Response("bad") }));
  await fs.rm(root, { recursive: true, force: true });
});

test("component install records file-level progress while downloading", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "weki-runtime-progress-"));
  const files = [Buffer.from("one"), Buffer.from("two")];
  const manifest = { format: "weki-runtime-manifest", version: 1, appCompatibility: ">=1.0.0", components: [{ id: "document-renderer", version: "1.0.0", files: files.map((bytes, index) => ({ path: `file-${index}.bin`, size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), url: `https://example.test/file-${index}.bin` })) }] };
  let observed;
  const result = await installComponent({ rootDirectory: root, manifest, componentId: "document-renderer", version: "1.0.0", fetchImpl: async (url) => {
    if (url.endsWith("file-1.bin")) observed = await getComponentState(root);
    const bytes = files[Number(url.match(/file-(\d+)/)?.[1] || 0)];
    return new Response(bytes, { status: 200 });
  } });
  assert.equal(observed.components["document-renderer"].completedFiles, 1);
  assert.equal(observed.components["document-renderer"].totalFiles, 2);
  assert.equal(result.progress, 100);
  await fs.rm(root, { recursive: true, force: true });
});

test("concurrent component installs do not delete each other's manifest staging file", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "weki-runtime-concurrent-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const files = {
    semantic: Buffer.from("semantic"),
    renderer: Buffer.from("renderer"),
  };
  const manifest = {
    format: "weki-runtime-manifest",
    version: 1,
    appCompatibility: ">=1.0.0",
    components: [
      { id: "semantic-model", version: "1.0.0", files: [{ path: "model.bin", size: files.semantic.length, sha256: crypto.createHash("sha256").update(files.semantic).digest("hex"), url: "https://example.test/semantic.bin" }] },
      { id: "document-renderer", version: "1.0.0", files: [{ path: "renderer.bin", size: files.renderer.length, sha256: crypto.createHash("sha256").update(files.renderer).digest("hex"), url: "https://example.test/renderer.bin" }] },
    ],
  };
  let fetchCalls = 0;
  let releaseFirstFetch;
  const firstFetchStarted = new Promise((resolve) => { releaseFirstFetch = resolve; });
  const fetchImpl = async (url) => {
    fetchCalls += 1;
    if (fetchCalls === 1) {
      releaseFirstFetch();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return new Response(url.includes("semantic") ? files.semantic : files.renderer);
  };

  const first = installComponent({ rootDirectory: root, manifest, componentId: "semantic-model", version: "1.0.0", fetchImpl });
  await firstFetchStarted;
  const second = installComponent({ rootDirectory: root, manifest, componentId: "document-renderer", version: "1.0.0", fetchImpl });
  const results = await Promise.allSettled([first, second]);

  assert.deepEqual(results.map((result) => result.status), ["fulfilled", "fulfilled"]);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8")).version, 1);
  assert.equal((await getComponentState(root)).components["semantic-model"].status, "ready");
  assert.equal((await getComponentState(root)).components["document-renderer"].status, "ready");
});
