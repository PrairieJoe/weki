import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import fs from "node:fs/promises";
import os from "node:os";
import crypto from "node:crypto";

import { documentOriginalKey, migrateLegacyOriginals, resolveDocumentOriginalPath } from "../src/server/original-storage.mjs";

test("local original paths are derived from the current store and never from a prior absolute path", () => {
  const document = { name: "사회보장제도.pdf", hash: "a".repeat(64), originalPath: "E:/old-store/originals/a.pdf" };
  assert.equal(documentOriginalKey(document), `${"a".repeat(64)}/사회보장제도.pdf`);
  assert.equal(resolveDocumentOriginalPath("E:/new-store", document), path.normalize(`E:/new-store/originals/${"a".repeat(64)}/사회보장제도.pdf`));
});

test("legacy flat originals migrate into hash directories with the remembered filename", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-original-migration-test-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const bytes = Buffer.from("legacy-source");
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  await fs.mkdir(path.join(dataDir, "originals"), { recursive: true });
  await fs.writeFile(path.join(dataDir, "originals", `${hash}.pdf`), bytes);
  const documents = [{ id: "doc-1", name: "보고서 원본.pdf", hash, originalKey: `${hash}.pdf`, sourceStatus: "available" }];

  const result = await migrateLegacyOriginals(dataDir, documents);

  assert.equal(result.migrated, 1);
  assert.equal(documents[0].originalName, "보고서 원본.pdf");
  assert.equal(documents[0].originalKey, `${hash}/보고서 원본.pdf`);
  assert.deepEqual(await fs.readFile(path.join(dataDir, "originals", hash, "보고서 원본.pdf")), bytes);
  await assert.rejects(fs.access(path.join(dataDir, "originals", `${hash}.pdf`)));
});

test("legacy original migration preserves a corrupted flat file", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-original-migration-corrupt-test-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const expectedHash = "c".repeat(64);
  await fs.mkdir(path.join(dataDir, "originals"), { recursive: true });
  await fs.writeFile(path.join(dataDir, "originals", `${expectedHash}.pdf`), "tampered");
  const documents = [{ id: "doc-1", name: "손상 원본.pdf", hash: expectedHash, originalKey: `${expectedHash}.pdf`, sourceStatus: "available" }];

  const result = await migrateLegacyOriginals(dataDir, documents);

  assert.equal(result.failed, 1);
  assert.equal(result.migrated, 0);
  await fs.access(path.join(dataDir, "originals", `${expectedHash}.pdf`));
  assert.equal(documents[0].originalKey, `${expectedHash}.pdf`);
});

test("legacy original migration preserves the source when the atomic move fails", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-original-migration-failure-test-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const bytes = Buffer.from("move-failure-source");
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  await fs.mkdir(path.join(dataDir, "originals"), { recursive: true });
  const source = path.join(dataDir, "originals", `${hash}.pdf`);
  await fs.writeFile(source, bytes);
  const documents = [{ id: "doc-1", name: "이동 실패.pdf", hash, originalKey: `${hash}.pdf`, sourceStatus: "available" }];

  const result = await migrateLegacyOriginals(dataDir, documents, { rename: async () => { throw new Error("disk full"); } });

  assert.equal(result.failed, 1);
  assert.equal(documents[0].sourceStatus, "unavailable");
  await fs.access(source);
  await assert.rejects(fs.access(path.join(dataDir, "originals", hash, "이동 실패.pdf")));
});
