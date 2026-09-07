import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  cloudOriginalPath,
  downloadCloudOriginal,
  findWekiFolderStructure,
  mergeCloudCatalog,
  readCloudCatalog,
  shouldRunInitialMyboxSync,
} from "../src/server/mybox-sync.mjs";

const hashOf = (value) => crypto.createHash("sha256").update(value).digest("hex");
const responseFor = (bytes) => ({ arrayBuffer: async () => Uint8Array.from(bytes).buffer });

const makeSnapshot = (bytes, name = "사회보장제도.pdf") => {
  const hash = hashOf(bytes);
  const originalFile = `data/${hash}/${name}`;
  return {
    format: "weki-cloud-folder-backup",
    version: 2,
    type: "full",
    createdAt: "2026-09-07T00:00:00.000Z",
    manifest: {
      documentCount: 1,
      originalCount: 1,
      files: [{ fileName: name, storagePath: `${hash}/${name}`, originalName: name, format: "PDF", hash, size: bytes.length }],
    },
    database: {
      documents: [{ id: "remote-doc", name, format: "PDF", hash, originalKey: `${hash}.pdf`, originalFile, sourceStatus: "available", processingStatus: "completed", units: [{ range: 1, text: "원격 색인" }], updatedAt: "2026-09-07T00:00:00.000Z" }],
      jobs: [],
      synonyms: [],
      feedback: [],
      audit: [],
    },
  };
};

function makeClient({ snapshot, bytes }) {
  const calls = [];
  const client = {
    async listResources({ parentId } = {}) {
      calls.push(["list", parentId]);
      if (!parentId) return [{ resourceId: "weki-id", name: "weki", type: "folder" }];
      if (parentId === "weki-id") return [{ resourceId: "data-id", name: "data", type: "folder" }, { resourceId: "json-id", name: "knowledge-base.json", type: "file" }];
      if (parentId === "data-id") return [{ resourceId: "hash-id", name: hashOf(bytes), type: "folder" }];
      if (parentId === "hash-id") return [{ resourceId: "original-id", name: "사회보장제도.pdf", type: "file" }];
      return [];
    },
    async downloadFile(resourceId) {
      calls.push(["download", resourceId]);
      if (resourceId === "json-id") return responseFor(Buffer.from(JSON.stringify(snapshot)));
      if (resourceId === "original-id") return responseFor(bytes);
      throw new Error(`unexpected resource ${resourceId}`);
    },
  };
  return { client, calls };
}

test("catalog sync downloads only knowledge-base.json and marks a cloud-only original", async () => {
  const bytes = Buffer.from("remote source");
  const snapshot = makeSnapshot(bytes);
  const { client, calls } = makeClient({ snapshot, bytes });
  const structure = await findWekiFolderStructure(client);
  const catalog = await readCloudCatalog(client, structure);

  assert.equal(catalog.snapshot.database.documents[0].originalFile, snapshot.database.documents[0].originalFile);
  assert.deepEqual(calls.map(([type]) => type), ["list", "list", "download"]);

  const merged = await mergeCloudCatalog({ documents: [], jobs: [], synonyms: [], feedback: [], audit: [] }, catalog.snapshot, {
    resolveLocalPath: () => path.join(os.tmpdir(), "weki-no-such-original.pdf"),
  });
  assert.equal(merged.database.documents[0].sourceStatus, "cloud_available");
  assert.equal(merged.database.documents[0].cloudOriginalFile, snapshot.database.documents[0].originalFile);
  assert.equal(calls.filter(([type]) => type === "download").length, 1);
});

test("opening a cloud original resolves the hash folder and verifies bytes", async () => {
  const bytes = Buffer.from("remote source");
  const snapshot = makeSnapshot(bytes);
  const { client, calls } = makeClient({ snapshot, bytes });
  const structure = await findWekiFolderStructure(client);
  const result = await downloadCloudOriginal(client, structure, snapshot.database.documents[0].originalFile, hashOf(bytes));

  assert.deepEqual(result.bytes, bytes);
  assert.equal(result.fileName, "사회보장제도.pdf");
  assert.deepEqual(calls.map(([type]) => type), ["list", "list", "list", "list", "download"]);
  assert.equal(cloudOriginalPath(snapshot.database.documents[0].originalFile).hash, hashOf(bytes));
});

test("invalid or flat cloud structures fail before an original is downloaded", async () => {
  const bytes = Buffer.from("remote source");
  const invalid = { ...makeSnapshot(bytes), version: 1 };
  const { client, calls } = makeClient({ snapshot: invalid, bytes });
  const structure = await findWekiFolderStructure(client);

  await assert.rejects(() => readCloudCatalog(client, structure), /유효하지 않은 Weki 폴더 백업입니다/);
  assert.deepEqual(calls.map(([type]) => type), ["list", "list", "download"]);
  assert.throws(() => cloudOriginalPath("data/source.pdf"), /새 Weki 백업 구조가 완성되지 않았습니다/);
});

test("an existing verified local original wins over MYBOX", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-mybox-sync-test-"));
  const bytes = Buffer.from("local source");
  const snapshot = makeSnapshot(bytes);
  const hash = hashOf(bytes);
  const localPath = path.join(dir, hash, "사회보장제도.pdf");
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, bytes);
  try {
    const merged = await mergeCloudCatalog({ documents: [], jobs: [], synonyms: [], feedback: [], audit: [] }, snapshot, {
      resolveLocalPath: (doc) => path.join(dir, ...doc.originalKey.split("/")),
    });
    assert.equal(merged.database.documents[0].sourceStatus, "local_available");
    assert.equal(merged.database.documents[0].originalKey, `${hash}/사회보장제도.pdf`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("catalog merge keeps the better remote index even when its original is cloud-only", async () => {
  const bytes = Buffer.from("remote source");
  const snapshot = makeSnapshot(bytes);
  const merged = await mergeCloudCatalog({
    documents: [{ id: "local-doc", name: snapshot.database.documents[0].name, format: "PDF", hash: snapshot.database.documents[0].hash, sourceStatus: "local_available", processingStatus: "partial", units: [{ range: 1 }], updatedAt: "2026-09-01T00:00:00.000Z" }],
    jobs: [], synonyms: [], feedback: [], audit: [],
  }, snapshot, { resolveLocalPath: () => path.join(os.tmpdir(), "weki-no-such-original.pdf") });
  assert.equal(merged.database.documents[0].id, "remote-doc");
  assert.equal(merged.database.documents[0].sourceStatus, "cloud_available");
});

test("initial synchronization is limited to a newly created empty store with a token", () => {
  assert.equal(shouldRunInitialMyboxSync({ newlyCreated: true, documentCount: 0, hasToken: true }), true);
  assert.equal(shouldRunInitialMyboxSync({ newlyCreated: false, documentCount: 0, hasToken: true }), false);
  assert.equal(shouldRunInitialMyboxSync({ newlyCreated: true, documentCount: 1, hasToken: true }), false);
  assert.equal(shouldRunInitialMyboxSync({ newlyCreated: true, documentCount: 0, hasToken: false }), false);
});
