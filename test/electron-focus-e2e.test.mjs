import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagedExecutable = path.join(projectRoot, "release", "win-unpacked", "Weki.exe");

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(label, callback, timeout = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const value = await callback();
      if (value) return value;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${label} timed out`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}

test("search composer accepts a native click while the all-components install is running", async (t) => {
  await fs.access(packagedExecutable);
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-focus-e2e-"));
  const port = await freePort();
  const debugPort = await freePort();
  const env = { ...process.env, WEKI_DATA_DIR: dataDir, WEKI_DISABLE_ENV_FILE: "1", WEKI_PORT: String(port), WEKI_SEARCH_V2: "1", WEKI_DISABLE_INITIAL_MYBOX_SYNC: "1" };
  const electron = spawn(packagedExecutable, ["--disable-gpu", "--no-sandbox", `--remote-debugging-port=${debugPort}`], { cwd: projectRoot, env, stdio: ["ignore", "ignore", "ignore"], windowsHide: true });
  const browser = await waitFor("Electron DevTools", async () => {
    try { return await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`); } catch { return null; }
  });
  const page = await waitFor("Electron window", () => browser.contexts()[0]?.pages()[0] || null);
  t.after(async () => {
    await browser.close().catch(() => {});
    await stopProcess(electron);
    await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const runtime = {
    format: "weki-runtime-state",
    version: 1,
    components: Object.fromEntries(["semantic-model", "semantic-reranker", "document-renderer", "presentation-renderer"].map((id) => [id, { id, status: "missing", applied: false, availableVersion: "1.0.0" }])),
    installable: Object.fromEntries(["semantic-model", "semantic-reranker", "document-renderer", "presentation-renderer"].map((id) => [id, { version: "1.0.0", url: `https://example.test/${id}` }])),
    installBatch: { status: "idle" },
  };
  let installBatch = "idle";
  page.on("dialog", (dialog) => dialog.accept());
  await page.route("**/api/runtime/components", async (route) => {
    const response = structuredClone(runtime);
    response.installBatch = { status: installBatch, currentStep: installBatch === "indexing" ? 1 : 0, total: 4, componentId: "semantic-model" };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
  });
  await page.route("**/api/runtime/components/install-all", async (route) => {
    installBatch = "indexing";
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ startedAt: new Date().toISOString(), runtime: { ...runtime, installBatch: { status: "indexing", currentStep: 1, total: 4, componentId: "semantic-model" } } }) });
  });

  await page.waitForSelector("#app .app-shell", { timeout: 30_000 });
  await page.evaluate(() => localStorage.setItem("weki.onboarding.v1.completed", "completed"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#query", { timeout: 30_000 });
  await page.locator('button.nav-item[data-nav="settings"]').click();
  await page.waitForSelector("#runtime-components-card [data-runtime-install-all]", { timeout: 30_000 });
  await page.locator("[data-runtime-install-all]").click();
  await page.locator('button.nav-item[data-nav="search"]').click();
  await page.waitForSelector("#query", { timeout: 30_000 });
  assert.equal(await page.evaluate(() => typeof window.wekiApp?.focusWindow), "function");

  const box = await page.locator("#query").boundingBox();
  assert.ok(box);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.insertText("테스트 입력");
  assert.equal(await page.locator("#query").inputValue(), "테스트 입력");
  const focusLog = await waitFor("focus diagnostics", async () => {
    try {
      const contents = await fs.readFile(path.join(dataDir, ".runtime", "logs", "ui-focus.log"), "utf8");
      return contents.includes('"type":"renderer-pointerdown"') && contents.includes('"type":"renderer-input"') ? contents : null;
    } catch { return null; }
  });
  assert.match(focusLog, /"type":"focus-request"/);
  assert.match(focusLog, /"type":"renderer-pointerdown"/);
  assert.match(focusLog, /"type":"focus-result"[^\n]*"webContentsFocused":true/);
  assert.match(focusLog, /"type":"renderer-input"/);
});
