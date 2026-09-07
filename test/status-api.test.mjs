import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

let nextPort = 5200;
function startServer(dataDir, extraEnv = {}) {
  const port = nextPort++;
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: "E:/PRJ/weki",
    env: { ...process.env, WEKI_DATA_DIR: dataDir, WEKI_PORT: String(port), WEKI_DISABLE_INITIAL_MYBOX_SYNC: "1", ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  return {
    child,
    port,
    output: () => output,
  };
}

async function waitForStatusReady(output, port) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/status`);
      if (response.ok) return response;
    } catch {
      // keep polling until the server is up
    }
    await delay(250);
  }

  throw new Error(`server did not become ready:\n${output()}`);
}

test("GET /api/status reports storage and maintenance state", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-status-test-"));
  const server = startServer(dataDir);
  t.after(() => {
    server.child.kill();
    return fs.rm(dataDir, { recursive: true, force: true });
  });

  const response = await waitForStatusReady(server.output, server.port);
  const status = await response.json();

  assert.equal(status.documentCount, 0);
  assert.equal(status.indexedUnits, 0);
  assert.deepEqual(status.engines, { lexical: "healthy", evidence: "healthy" });
  assert.deepEqual(status.maintenance, null);
  assert.equal(typeof status.storage.usage, "number");
  assert.equal(typeof status.storage.available, "number");
  assert.equal(typeof status.storage.total, "number");
  assert.ok(status.storage.total > 0);
  assert.ok(status.storage.available >= 0);
  assert.ok(status.storage.usage >= 0);
  assert.equal(status.storage.total - status.storage.available, status.storage.usage);
});

test("MYBOX status explains a missing credential without affecting local startup", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-mybox-missing-token-test-"));
  const server = startServer(dataDir, { NAVER_MBOX_TOKEN: "", WEKI_MYBOX_CREDENTIAL_STATE: "missing" });
  t.after(() => {
    server.child.kill();
    return fs.rm(dataDir, { recursive: true, force: true });
  });

  await waitForStatusReady(server.output, server.port);
  const response = await fetch(`http://127.0.0.1:${server.port}/api/mybox/status`);
  const status = await response.json();
  assert.equal(status.connected, false);
  assert.equal(status.credentialState, "missing");
  assert.equal(status.reason, "token_missing");
  assert.equal(status.message, "MYBOX 토큰이 설정되지 않았습니다. 관리자에게 문의하세요.");
});

test("MYBOX status separates token authentication failure from missing credentials", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-mybox-invalid-token-test-"));
  const provider = createServer((req, res) => {
    if (req.url === "/v1/drive/storage") { res.statusCode = 401; res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ message: "unauthorized" })); }
    res.statusCode = 404; return res.end();
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const apiBase = `http://127.0.0.1:${provider.address().port}/v1`;
  const server = startServer(dataDir, { NAVER_MBOX_TOKEN: "test-token", WEKI_MYBOX_API_BASE: apiBase, WEKI_MYBOX_CREDENTIAL_STATE: "available" });
  t.after(() => {
    server.child.kill();
    return Promise.all([fs.rm(dataDir, { recursive: true, force: true }), new Promise((resolve) => provider.close(resolve))]);
  });

  await waitForStatusReady(server.output, server.port);
  const response = await fetch(`http://127.0.0.1:${server.port}/api/mybox/status`);
  const status = await response.json();
  assert.equal(status.connected, false);
  assert.equal(status.credentialState, "invalid");
  assert.equal(status.reason, "token_invalid");
  assert.equal(status.message, "MYBOX 토큰 검증에 실패했습니다. 관리자에게 문의하세요.");
});

test("failed registration remains visible without creating a document", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-registration-test-"));
  const server = startServer(dataDir);
  t.after(() => {
    server.child.kill();
    return fs.rm(dataDir, { recursive: true, force: true });
  });

  await waitForStatusReady(server.output, server.port);
  const form = new FormData();
  form.append("files", new Blob(["not a real HWP file"]), "broken.hwp");
  const response = await fetch(`http://127.0.0.1:${server.port}/api/documents`, { method: "POST", body: form });
  assert.equal(response.status, 202);

  let jobs = [];
  for (let attempt = 0; attempt < 80; attempt += 1) {
    jobs = (await (await fetch(`http://127.0.0.1:${server.port}/api/jobs`)).json()).jobs;
    if (jobs.some((job) => job.status === "failed")) break;
    await delay(100);
  }
  const failed = jobs.find((job) => job.status === "failed");
  assert.equal(failed?.name, "broken.hwp");
  assert.match(failed?.detail || "", /HWP|손상|지원/);
  assert.deepEqual((await (await fetch(`http://127.0.0.1:${server.port}/api/documents`)).json()).documents, []);
});

test("relinking the same Hash keeps one physical original and the document filename", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-same-hash-relink-test-"));
  const bytes = Buffer.from("same-hash-source");
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  await fs.writeFile(path.join(dataDir, "knowledge-base.json"), JSON.stringify({
    documents: [{ id: "doc-1", name: "기존이름.pdf", originalName: "기존이름.pdf", originalKey: `${hash}/기존이름.pdf`, format: "PDF", hash, sourceStatus: "unavailable", units: [{ range: 1, text: "근거" }] }],
    jobs: [], synonyms: [], feedback: [], audit: [],
  }));
  const server = startServer(dataDir);
  t.after(() => {
    server.child.kill();
    return fs.rm(dataDir, { recursive: true, force: true });
  });

  await waitForStatusReady(server.output, server.port);
  const form = new FormData();
  form.append("files", new Blob([bytes]), "새이름.pdf");
  const response = await fetch(`http://127.0.0.1:${server.port}/api/documents`, { method: "POST", body: form });
  const result = await response.json();
  assert.equal(response.status, 202, JSON.stringify(result));
  assert.equal(result.results[0].status, "relinked");
  const document = (await (await fetch(`http://127.0.0.1:${server.port}/api/documents`)).json()).documents[0];
  assert.equal(document.originalName, "기존이름.pdf");
  assert.equal(document.originalKey, `${hash}/기존이름.pdf`);
  assert.deepEqual(await fs.readFile(path.join(dataDir, "originals", hash, "기존이름.pdf")), bytes);
  await assert.rejects(fs.access(path.join(dataDir, "originals", hash, "새이름.pdf")));
  assert.deepEqual((await fs.readdir(path.join(dataDir, "originals", hash))).sort(), ["기존이름.pdf"]);
});

test("storage migration accepts an existing empty destination folder", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-migration-source-"));
  const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-migration-target-"));
  const server = startServer(dataDir);
  t.after(() => {
    server.child.kill();
    return Promise.all([
      fs.rm(dataDir, { recursive: true, force: true }),
      fs.rm(targetDir, { recursive: true, force: true }),
    ]);
  });

  await waitForStatusReady(server.output, server.port);
  const response = await fetch(`http://127.0.0.1:${server.port}/api/storage/migrate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetPath: targetDir }),
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.path, path.resolve(targetDir));
  assert.equal(result.restartRequired, true);
  assert.equal(result.sourceRemoved, true);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(targetDir, "knowledge-base.json"), "utf8")).documents, []);
  assert.equal(JSON.parse(await fs.readFile(path.join(targetDir, "storage-location.json"), "utf8")).dataDir, path.resolve(targetDir));
  assert.equal(await fs.stat(dataDir).catch(() => null), null);
});

test("storage migration rebases document originals to the new store", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-migration-rebase-source-"));
  const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-migration-rebase-target-"));
  const original = Buffer.from("migration-original");
  const hash = crypto.createHash("sha256").update(original).digest("hex");
  await fs.mkdir(path.join(dataDir, "originals"), { recursive: true });
  await fs.writeFile(path.join(dataDir, "originals", `${hash}.pdf`), original);
  await fs.writeFile(path.join(dataDir, "knowledge-base.json"), JSON.stringify({
    documents: [{ id: "doc-1", name: "원본.pdf", format: "PDF", hash, sourceStatus: "available", originalPath: path.join(dataDir, "originals", `${hash}.pdf`), units: [] }],
    jobs: [], audit: [], synonyms: [], feedback: [],
  }));
  await fs.mkdir(path.join(dataDir, "credentials"), { recursive: true });
  await fs.writeFile(path.join(dataDir, "credentials", "mybox-token.json"), JSON.stringify({ format: "weki-credential", version: 1, provider: "mybox", ciphertext: "opaque" }));
  const server = startServer(dataDir);
  t.after(() => {
    server.child.kill();
    return Promise.all([
      fs.rm(dataDir, { recursive: true, force: true }),
      fs.rm(targetDir, { recursive: true, force: true }),
    ]);
  });

  await waitForStatusReady(server.output, server.port);
  const response = await fetch(`http://127.0.0.1:${server.port}/api/storage/migrate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetPath: targetDir }),
  });
  assert.equal(response.status, 200);
  const migrated = JSON.parse(await fs.readFile(path.join(targetDir, "knowledge-base.json"), "utf8"));
   assert.equal(migrated.documents[0].originalKey, `${hash}/원본.pdf`);
  assert.equal("originalPath" in migrated.documents[0], false);
   assert.equal(await fs.readFile(path.join(targetDir, "originals", hash, "원본.pdf"), "utf8"), original.toString());
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(targetDir, "credentials", "mybox-token.json"), "utf8")), { format: "weki-credential", version: 1, provider: "mybox", ciphertext: "opaque" });
});

test("MYBOX sync imports only the catalog and lazy-downloads an original once", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-mybox-api-test-"));
  const bytes = Buffer.from("remote source from MYBOX");
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  const name = "원격문서.pdf";
  const snapshot = {
    format: "weki-cloud-folder-backup", version: 2, type: "full", createdAt: "2026-09-07T00:00:00.000Z",
    manifest: { documentCount: 1, originalCount: 1, files: [{ fileName: name, storagePath: `${hash}/${name}`, originalName: name, format: "PDF", hash, size: bytes.length }] },
    database: { documents: [{ id: "remote-doc", name, format: "PDF", hash, originalKey: `${hash}.pdf`, originalFile: `data/${hash}/${name}`, sourceStatus: "available", processingStatus: "completed", units: [{ range: 1, text: "원격 검색 근거", embedding: [1] }], updatedAt: "2026-09-07T00:00:00.000Z" }], jobs: [], synonyms: [], feedback: [], audit: [] },
  };
  let originalDownloads = 0;
  const provider = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/v1/drive/storage") return res.end(JSON.stringify({ used: 0, total: 100 }));
    if (url.pathname === "/v1/drive/resources") return res.end(JSON.stringify({ resources: [{ resourceId: "weki-id", name: "weki", type: "folder" }] }));
    if (url.pathname === "/v1/drive/folders/weki-id/resources") return res.end(JSON.stringify({ resources: [{ resourceId: "data-id", name: "data", type: "folder" }, { resourceId: "json-id", name: "knowledge-base.json", type: "file" }] }));
    if (url.pathname === "/v1/drive/folders/data-id/resources") return res.end(JSON.stringify({ resources: [{ resourceId: "hash-id", name: hash, type: "folder" }] }));
    if (url.pathname === "/v1/drive/folders/hash-id/resources") return res.end(JSON.stringify({ resources: [{ resourceId: "original-id", name, type: "file" }] }));
    if (url.pathname === "/v1/drive/files/json-id/download") return res.end(JSON.stringify({ downloadUrl: `${apiBase}/mock/catalog` }));
    if (url.pathname === "/v1/drive/files/original-id/download") return res.end(JSON.stringify({ downloadUrl: `${apiBase}/mock/original` }));
    if (url.pathname === "/v1/mock/catalog") return res.end(JSON.stringify(snapshot));
    if (url.pathname === "/v1/mock/original") { originalDownloads += 1; res.setHeader("Content-Type", "application/octet-stream"); return res.end(bytes); }
    res.statusCode = 404; return res.end(JSON.stringify({ message: "not found" }));
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const apiBase = `http://127.0.0.1:${provider.address().port}/v1`;
  const app = startServer(dataDir, { NAVER_MBOX_TOKEN: "test-token", WEKI_MYBOX_API_BASE: apiBase });
  t.after(() => {
    app.child.kill();
    return Promise.all([fs.rm(dataDir, { recursive: true, force: true }), new Promise((resolve) => provider.close(resolve))]);
  });

  await waitForStatusReady(app.output, app.port);
  const syncResponse = await fetch(`http://127.0.0.1:${app.port}/api/mybox/sync`, { method: "POST" });
  const syncBody = await syncResponse.json();
  assert.equal(syncResponse.status, 200, JSON.stringify(syncBody));
  const synced = (await (await fetch(`http://127.0.0.1:${app.port}/api/documents`)).json()).documents[0];
  assert.equal(synced.sourceStatus, "cloud_available");
  assert.equal(originalDownloads, 0);

  const firstOpen = await fetch(`http://127.0.0.1:${app.port}/api/documents/remote-doc/original`);
  assert.equal(firstOpen.status, 200);
  assert.match(firstOpen.headers.get("content-disposition") || "", /filename/i);
  assert.match(decodeURIComponent(firstOpen.headers.get("content-disposition") || ""), /원격문서\.pdf/);
  assert.deepEqual(Buffer.from(await firstOpen.arrayBuffer()), bytes);
  assert.equal(originalDownloads, 1);
  const cachedPath = path.join(dataDir, "originals", hash, name);
  assert.deepEqual(await fs.readFile(cachedPath), bytes);

  const secondOpen = await fetch(`http://127.0.0.1:${app.port}/api/documents/remote-doc/original`);
  assert.equal(secondOpen.status, 200);
  assert.equal(originalDownloads, 1);
});
