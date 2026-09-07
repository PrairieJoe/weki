import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { createBackupSnapshot, createFolderSnapshot, mergeDatabases, reconcileFolderSnapshotOriginals, removeDocumentData, validateBackupSnapshot, validateFolderSnapshot } from "../src/server/backup.mjs";

const tempStore = async () => fs.mkdtemp(path.join(os.tmpdir(), "weki-backup-test-"));
const hashOf = (value) => crypto.createHash("sha256").update(value).digest("hex");

test("backup snapshot includes and verifies every available original", async (t) => {
  const dir = await tempStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const original = Buffer.from("social-security-source");
  const hash = hashOf(original);
  await fs.writeFile(path.join(dir, `${hash}.pdf`), original);

  const snapshot = await createBackupSnapshot({
    documents: [{ id: "doc-1", name: "source.pdf", format: "PDF", hash, sourceStatus: "available", originalPath: path.join(dir, `${hash}.pdf`), units: [] }],
    synonyms: [],
    feedback: [],
    audit: [],
    jobs: [{ id: "job-1", status: "processing" }],
  }, dir, { now: () => "2026-09-06T00:00:00.000Z" });

  assert.equal(snapshot.format, "weki-cloud-backup");
  assert.equal(snapshot.manifest.originalCount, 1);
  assert.equal(snapshot.database.jobs.length, 0);
  assert.deepEqual(Object.keys(snapshot.originals), [hash]);
  assert.equal(snapshot.originals[hash].data, original.toString("base64"));
  assert.deepEqual(validateBackupSnapshot(snapshot), snapshot);
});

test("document merge deduplicates identical hashes and keeps different versions", () => {
  const local = {
    documents: [{ id: "local", hash: "same", sourceStatus: "missing", processingStatus: "partial", units: [{ range: 1 }], updatedAt: "2026-09-01T00:00:00.000Z" }, { id: "local-new", hash: "local-only", units: [] }],
    synonyms: [{ id: "syn-1", term: "결제", aliases: ["지급"], approved: true }],
    feedback: [{ id: "feedback-1" }],
    audit: [{ id: "audit-1" }],
    jobs: [{ id: "local-job" }],
  };
  const remote = {
    documents: [{ id: "remote", hash: "same", sourceStatus: "available", processingStatus: "completed", units: [{ range: 1 }, { range: 2 }], updatedAt: "2026-09-02T00:00:00.000Z" }, { id: "remote-new", hash: "remote-only", units: [] }],
    synonyms: [{ id: "syn-2", term: "결제", aliases: ["납부"], approved: true }],
    feedback: [{ id: "feedback-1" }, { id: "feedback-2" }],
    audit: [{ id: "audit-1" }, { id: "audit-2" }],
    jobs: [{ id: "remote-job" }],
  };

  const result = mergeDatabases(local, remote);
  assert.deepEqual(result.database.documents.map((doc) => doc.hash), ["same", "local-only", "remote-only"]);
  assert.equal(result.database.documents[0].id, "remote");
  assert.deepEqual(result.database.synonyms[0].aliases.sort(), ["납부", "지급"]);
  assert.equal(result.database.feedback.length, 2);
  assert.equal(result.database.audit.length, 2);
  assert.deepEqual(result.database.jobs, [{ id: "local-job" }]);
  assert.equal(result.conflicts, 1);
});

test("backup snapshot rejects an original whose bytes do not match its document hash", async (t) => {
  const dir = await tempStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const hash = hashOf("expected");
  const originalPath = path.join(dir, `${hash}.pdf`);
  await fs.writeFile(originalPath, "tampered");

  await assert.rejects(() => createBackupSnapshot({ documents: [{ id: "doc", format: "PDF", hash, sourceStatus: "available", originalPath, units: [] }] }, dir), /원본 Hash/);
});

test("folder backup keeps the actual original outside the JSON payload", async (t) => {
  const dir = await tempStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const original = Buffer.from("social-security-source");
  const hash = hashOf(original);
  const originalPath = path.join(dir, `${hash}.pdf`);
  await fs.writeFile(originalPath, original);

  const snapshot = await createFolderSnapshot({
    documents: [{ id: "doc-1", name: "사회보장제도.pdf", format: "PDF", hash, sourceStatus: "available", originalPath, units: [{ range: 1, text: "근거" }] }],
    jobs: [{ id: "job-1", status: "completed" }],
  }, { now: () => "2026-09-06T00:00:00.000Z" });

  assert.equal(snapshot.json.format, "weki-cloud-folder-backup");
  assert.equal("originalPath" in snapshot.json.database.documents[0], false);
  assert.equal(snapshot.json.database.documents[0].originalFile, `data/${hash}/사회보장제도.pdf`);
  assert.equal(snapshot.json.database.documents[0].units[0].text, "근거");
  assert.equal(snapshot.json.database.jobs.length, 0);
  assert.deepEqual(snapshot.originals.map((item) => item.fileName), ["사회보장제도.pdf"]);
  assert.deepEqual(snapshot.originals[0].data, original);
  assert.equal(JSON.stringify(snapshot.json).includes(original.toString("base64")), false);
  assert.deepEqual(validateFolderSnapshot(snapshot.json), snapshot.json);
});

test("folder backup keeps the user filename and rejects a missing manifest reference", async () => {
  const snapshot = {
    format: "weki-cloud-folder-backup",
    version: 2,
    type: "full",
    manifest: { documentCount: 1, originalCount: 1, files: [{ fileName: "사회보장제도.pdf", storagePath: `${"a".repeat(64)}/사회보장제도.pdf`, hash: "a".repeat(64) }] },
    database: { documents: [{ id: "doc", originalFile: `data/${"a".repeat(64)}/사회보장제도.pdf` }] },
  };
  assert.equal(validateFolderSnapshot(snapshot), snapshot);
  assert.throws(() => validateFolderSnapshot({ ...snapshot, database: { documents: [{ id: "doc", originalFile: "data/missing.pdf" }] } }), /Manifest/);
});

test("removing a document removes its searchable data and jobs while keeping an audit entry", () => {
  const result = removeDocumentData({
    documents: [{ id: "doc-1", hash: "same", units: [{ range: 1, text: "secret" }] }, { id: "doc-2", hash: "other", units: [] }],
    jobs: [{ id: "job-1", documentId: "doc-1" }, { id: "job-2", documentId: "doc-2" }],
    audit: [],
  }, "doc-1", "2026-09-06T00:00:00.000Z");

  assert.deepEqual(result.database.documents.map((doc) => doc.id), ["doc-2"]);
  assert.deepEqual(result.database.jobs.map((job) => job.id), ["job-2"]);
  assert.equal(result.database.audit[0].type, "document-delete");
  assert.equal(result.database.audit[0].documentId, "doc-1");
  assert.equal(result.document.hash, "same");
});

test("folder upload reuses an existing MYBOX original when only the filename differs", async (t) => {
  const dir = await tempStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const original = Buffer.from("same-source"); const hash = hashOf(original); const originalPath = path.join(dir, `${hash}.pdf`); await fs.writeFile(originalPath, original);
  const snapshot = await createFolderSnapshot({ documents: [{ id: "doc", name: "renamed-source.pdf", format: "PDF", hash, sourceStatus: "available", originalPath, units: [] }] });

  const reconciled = reconcileFolderSnapshotOriginals(snapshot, { remoteManifest: [{ fileName: "source.pdf", originalName: "source.pdf", format: "PDF", hash, size: original.length }], remoteFiles: [{ name: "source.pdf", type: "file" }] });

  assert.equal(reconciled.json.database.documents[0].originalFile, `data/${hash}/source.pdf`);
  assert.equal(reconciled.originals[0].fileName, "source.pdf");
  assert.equal(reconciled.originals[0].storagePath, `${hash}/source.pdf`);
  assert.equal(reconciled.originals[0].skipUpload, true);
});

test("folder upload keeps changed content as a separate original when the name is already used", async (t) => {
  const dir = await tempStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const original = Buffer.from("changed-source"); const hash = hashOf(original); const originalPath = path.join(dir, `${hash}.pdf`); await fs.writeFile(originalPath, original);
  const snapshot = await createFolderSnapshot({ documents: [{ id: "doc", name: "source.pdf", format: "PDF", hash, sourceStatus: "available", originalPath, units: [] }] });

  const reconciled = reconcileFolderSnapshotOriginals(snapshot, { remoteManifest: [{ fileName: "source.pdf", storagePath: `${hashOf("old-source")}/source.pdf`, originalName: "source.pdf", format: "PDF", hash: hashOf("old-source"), size: 10 }] });

  assert.equal(reconciled.originals[0].fileName, "source.pdf");
  assert.equal(reconciled.originals[0].storagePath, `${hash}/source.pdf`);
  assert.equal(reconciled.json.database.documents[0].originalFile, `data/${hash}/source.pdf`);
  assert.equal(reconciled.originals[0].skipUpload, undefined);
});

test("folder backup keeps the original filename while separating different hashes into hash folders", async () => {
  const first = Buffer.from("first-version"); const second = Buffer.from("second-version");
  const firstHash = hashOf(first); const secondHash = hashOf(second);
  const snapshot = await createFolderSnapshot({ documents: [
    { id: "first", name: "same-name.pdf", format: "PDF", hash: firstHash, sourceStatus: "available", originalPath: "first-source.pdf", units: [] },
    { id: "second", name: "same-name.pdf", format: "PDF", hash: secondHash, sourceStatus: "available", originalPath: "second-source.pdf", units: [] },
  ] }, { readFile: async (filePath) => filePath === "first-source.pdf" ? first : second });

  assert.deepEqual(snapshot.originals.map((item) => item.fileName), ["same-name.pdf", "same-name.pdf"]);
  assert.deepEqual(snapshot.json.database.documents.map((doc) => doc.originalFile), [`data/${firstHash}/same-name.pdf`, `data/${secondHash}/same-name.pdf`]);
});

test("folder backup preserves a MYBOX-only original without downloading it", async () => {
  const bytes = Buffer.from("cloud-only-source"); const hash = hashOf(bytes); const name = "cloud-only.pdf";
  const remoteManifest = [{ fileName: name, storagePath: `${hash}/${name}`, originalName: name, format: "PDF", hash, size: bytes.length }];
  const snapshot = await createFolderSnapshot({ documents: [{ id: "remote", name, format: "PDF", hash, sourceStatus: "cloud_available", cloudOriginalFile: `data/${hash}/${name}`, units: [] }] }, { remoteManifest, readFile: async () => { throw new Error("cloud-only originals must not be read locally"); } });

  assert.deepEqual(snapshot.originals, []);
  assert.equal(snapshot.json.database.documents[0].originalFile, `data/${hash}/${name}`);
  assert.deepEqual(snapshot.json.manifest.files, remoteManifest);
});
