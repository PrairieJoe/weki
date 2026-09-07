import test from "node:test";
import assert from "node:assert/strict";

import { createMyboxClient } from "../src/server/mybox.mjs";

test("MYBOX client uses the official two-step upload and download APIs", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/drive/files") && options.method === "POST") return new Response(JSON.stringify({ uploadUrl: "https://storage.example/upload" }), { status: 201 });
    if (url === "https://storage.example/upload") return new Response(JSON.stringify({ resourceId: "uploaded-id" }), { status: 200 });
    if (/\/drive\/files\/[^/]+\/download$/.test(url)) return new Response(JSON.stringify({ downloadUrl: "https://storage.example/download" }), { status: 200 });
    if (url === "https://storage.example/download") return new Response("backup-data", { status: 200 });
    throw new Error(`unexpected request: ${url}`);
  };
  const client = createMyboxClient({ token: "test-token", fetchImpl, apiBase: "https://open-api.mybox.naver.com/v1" });

  const uploaded = await client.uploadBackup(Buffer.from("backup-data"), "weki-backup.weki", "folder-id");
  const downloaded = await client.downloadBackup("file-id");

  assert.equal(uploaded.resourceId, "uploaded-id");
  assert.equal((await downloaded.text()), "backup-data");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-token");
  assert.equal(calls[1].url, "https://storage.example/upload");
  assert.equal(calls[2].url, "https://open-api.mybox.naver.com/v1/drive/files/file-id/download");
  assert.equal(calls[3].url, "https://storage.example/download");
});

test("MYBOX client creates folders, lists children, and overwrites a named file in its parent", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/drive/resources?") && !url.includes("parentId=")) return new Response(JSON.stringify({ resources: [{ resourceId: "weki-id", name: "weki", type: "folder" }] }), { status: 200 });
    if (url.includes("/drive/folders/weki-id/resources?")) return new Response(JSON.stringify({ resources: [{ resourceId: "json-id", name: "knowledge-base.json", type: "file" }] }), { status: 200 });
    if (url.endsWith("/drive/folders")) return new Response(JSON.stringify({ resourceId: "data-id", name: "data" }), { status: 201 });
    if (url.endsWith("/drive/files") && options.method === "POST") return new Response(JSON.stringify({ uploadUrl: "https://storage.example/upload" }), { status: 201 });
    if (url === "https://storage.example/upload") return new Response(JSON.stringify({ resourceId: "uploaded-id" }), { status: 200 });
    throw new Error(`unexpected request: ${url}`);
  };
  const client = createMyboxClient({ token: "test-token", fetchImpl, apiBase: "https://open-api.mybox.naver.com/v1" });

  const folders = await client.listResources();
  const children = await client.listResources({ parentId: "weki-id" });
  const created = await client.createFolder("data", "weki-id");
  const uploaded = await client.uploadFile(Buffer.from("json"), "knowledge-base.json", "weki-id", { isOverwrite: true });

  assert.equal(folders[0].resourceId, "weki-id");
  assert.equal(children[0].resourceId, "json-id");
  assert.equal(created.resourceId, "data-id");
  assert.equal(uploaded.resourceId, "uploaded-id");
  assert.match(calls[1].url, /\/drive\/folders\/weki-id\/resources\?/);
  assert.equal(JSON.parse(calls[3].options.body).parentId, "weki-id");
  assert.equal(JSON.parse(calls[3].options.body).isOverwrite, true);
});
