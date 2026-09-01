import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

function startServer() {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: "E:/PRJ/weki",
    env: { ...process.env },
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
    output: () => output,
  };
}

async function waitForStatusReady(output) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:5173/api/status");
      if (response.ok) return response;
    } catch {
      // keep polling until the server is up
    }
    await delay(250);
  }

  throw new Error(`server did not become ready:\n${output()}`);
}

test("GET /api/status reports storage and maintenance state", async (t) => {
  const server = startServer();
  t.after(() => {
    server.child.kill();
  });

  const response = await waitForStatusReady(server.output);
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
