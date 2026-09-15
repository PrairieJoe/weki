import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const shouldRun = process.env.WEKI_RUN_LIBREOFFICE_INSTALL_E2E === "1";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let nextPort = 5900;

async function waitForServer(port, child) {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/status`);
      if (response.ok) return;
    } catch {}
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("server did not become ready");
}

async function startServer(dataDir, dependencyRoot) {
  const port = nextPort++;
  const env = { ...process.env, WEKI_DATA_DIR: dataDir, WEKI_DEPENDENCY_ROOT: dependencyRoot, WEKI_PORT: String(port), WEKI_DISABLE_ENV_FILE: "1", WEKI_DISABLE_INITIAL_MYBOX_SYNC: "1" };
  delete env.WEKI_LIBREOFFICE_PATH;
  const child = spawn(process.execPath, ["server.mjs"], { cwd: projectRoot, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  await waitForServer(port, child).catch((error) => { throw new Error(`${error.message}\n${output}`); });
  return { child, port, output: () => output };
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill();
  await new Promise((resolve) => { const timer = setTimeout(resolve, 5_000); server.child.once("exit", () => { clearTimeout(timer); resolve(); }); });
}

test("managed LibreOffice install becomes applied after an app restart", { skip: !shouldRun }, async (t) => {
  assert.ok(process.env.WEKI_DEPENDENCY_BUNDLE_PATH, "WEKI_DEPENDENCY_BUNDLE_PATH must point to the verified offline bundle");
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-libreoffice-install-e2e-"));
  const dependencyRoot = path.join(dataDir, "dependencies");
  let server = await startServer(dataDir, dependencyRoot);
  t.after(async () => { await stopServer(server); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const base = `http://127.0.0.1:${server.port}`;
  const before = await (await fetch(`${base}/api/runtime/components`)).json();
  assert.equal(before.components["presentation-renderer"].status, "missing");
  assert.equal(before.components["presentation-renderer"].installable, true);

  const installResponse = await fetch(`${base}/api/runtime/components/install`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ componentId: "presentation-renderer" }) });
  const installed = await installResponse.json();
  assert.equal(installResponse.status, 201, JSON.stringify(installed));
  assert.equal(installed.component.version, "26.2.4");
  assert.equal(installed.restartRequired, true);
  assert.equal(installed.runtime.components["presentation-renderer"].applied, false);

  await stopServer(server);
  server = await startServer(dataDir, dependencyRoot);
  const after = await (await fetch(`http://127.0.0.1:${server.port}/api/runtime/components`)).json();
  assert.equal(after.components["presentation-renderer"].status, "ready");
  assert.equal(after.components["presentation-renderer"].applied, true);
  assert.equal(after.components["presentation-renderer"].version, "26.2.4");
});
