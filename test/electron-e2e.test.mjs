import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultFixture = path.join(projectRoot, "test_data", "01 시내버스 개편 방향 및 효과, 개편사항.pdf");
const fixture = process.env.WEKI_E2E_FIXTURE || defaultFixture;
const query = process.env.WEKI_E2E_QUERY || "시내버스 노선 개편";
const expectVisual = process.env.WEKI_E2E_EXPECT_VISUAL !== "0";
const expectedPage = Number(process.env.WEKI_E2E_EXPECT_PAGE || 4);
const forbiddenPages = new Set(String(process.env.WEKI_E2E_FORBIDDEN_PAGES || "").split(",").map((value) => Number(value.trim())).filter(Number.isInteger));

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(label, callback, { timeout = 180_000, interval = 500 } = {}) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeout) {
    try {
      const value = await callback();
      if (value) return value;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ""}`);
}

test("Electron flow indexes a visual document and shows concise highlighted evidence", async (t) => {
  const source = path.resolve(fixture);
  await fs.access(source);
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-electron-e2e-"));
  const runtimeDir = path.join(dataDir, "runtime", "v1");
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.writeFile(path.join(runtimeDir, "component-state.json"), JSON.stringify({ format: "weki-runtime-state", version: 1, components: {
    "document-renderer": { id: "document-renderer", status: "ready", version: "0.8.4", path: path.join(projectRoot, "node_modules", "@rhwp", "core") },
  } }));
  const port = await freePort();
  const debugPort = await freePort();
  const testEnv = { ...process.env, WEKI_DATA_DIR: dataDir, WEKI_RUNTIME_DIR: runtimeDir, WEKI_SEARCH_V2: "1", WEKI_PORT: String(port), WEKI_DISABLE_ENV_FILE: "1", WEKI_DISABLE_INITIAL_MYBOX_SYNC: "1" };
  const serverProcess = spawn(process.execPath, [path.join(projectRoot, "server.mjs")], { cwd: projectRoot, env: testEnv, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let processOutput = "";
  serverProcess.stdout.on("data", (chunk) => { processOutput += chunk.toString(); });
  serverProcess.stderr.on("data", (chunk) => { processOutput += chunk.toString(); });
  await waitFor("Weki server", async () => {
    try { return (await fetch(`http://127.0.0.1:${port}/api/status`)).ok; } catch { return false; }
  }, { timeout: 30_000, interval: 200 }).catch((error) => { throw new Error(`${error.message}\n${processOutput}`); });
  const electronProcess = spawn(require("electron"), ["--disable-gpu", "--no-sandbox", `--remote-debugging-port=${debugPort}`, projectRoot], {
    cwd: projectRoot,
    env: testEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  electronProcess.stdout.on("data", (chunk) => { processOutput += chunk.toString(); });
  electronProcess.stderr.on("data", (chunk) => { processOutput += chunk.toString(); });
  const browser = await waitFor("Electron DevTools", async () => {
    try { return await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`); } catch { return null; }
  }, { timeout: 30_000, interval: 200 });
  t.after(async () => {
    await browser.close().catch(() => {});
    if (!electronProcess.killed) electronProcess.kill();
    if (!serverProcess.killed) serverProcess.kill();
    await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  let page;
  try { page = await waitFor("Electron window", async () => browser.contexts()[0]?.pages()[0] || null, { timeout: 30_000, interval: 200 }); }
  catch (error) { throw new Error(`${error.message}\n${processOutput}`); }
  try { await page.waitForSelector("#query", { timeout: 30_000 }); }
  catch (error) {
    if (!page.url()) {
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" }).catch((navigationError) => { throw new Error(`${navigationError.message}\n${processOutput}`); });
      await page.waitForSelector("#query", { timeout: 30_000 });
    } else throw new Error(`${error.message}\nURL: ${page.url()}\nBODY: ${await page.locator("body").innerText().catch(() => "")}\n${processOutput}`);
  }
  await page.locator('button.nav-item[data-nav="add"]').click();
  await page.locator("#file-input").setInputFiles(source);
  await page.locator("#create-job").click();
  let lastJob = null;
  const completedJob = await waitFor("document processing", async () => {
    const snapshot = await page.evaluate(async () => {
      const [jobs, documents, audit] = await Promise.all([
        fetch("/api/jobs").then((response) => response.json()),
        fetch("/api/documents").then((response) => response.json()),
        fetch("/api/audit").then((response) => response.json()),
      ]);
      return { jobs, documents, audit };
    });
    const job = snapshot.jobs.jobs.find((item) => item.name === path.basename(source));
    const document = snapshot.documents.documents.find((item) => item.name === path.basename(source));
    const indexed = document && snapshot.audit.entries.some((item) => item.type === "registration" && item.documentId === document.id);
    lastJob = job;
    if (job?.status === "failed") throw new Error(job.detail || "processing failed");
    return indexed ? { status: "completed", documentId: document.id } : null;
  }, { timeout: 300_000 }).catch((error) => {
    throw new Error(`${error.message}\nJOB: ${JSON.stringify(lastJob)}\nPROCESS: ${processOutput}`);
  });
  assert.equal(completedJob.status, "completed");

  await page.locator('button.nav-item[data-nav="search"]').click();
  const closeToast = page.locator("[data-close-toast]");
  if (await closeToast.count()) await closeToast.click();
  await page.locator("#query").fill(query);
  await page.locator("#run-search").click();
  const response = await waitFor("visual search result", async () => page.evaluate(async (searchQuery) => {
    const response = await fetch("/api/v2/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: searchQuery }) });
    const body = await response.json();
    return body.results?.length ? body : null;
  }, query));
  assert.equal(response.results[0]?.matchedEvidence?.pageStart, expectedPage, JSON.stringify(response.results));
  assert.equal(response.results.some((item) => forbiddenPages.has(Number(item.matchedEvidence?.pageStart))), false, JSON.stringify(response.results));
  const visual = response.results.find((item) => item.matchedEvidence?.type === "visual");
  if (expectVisual) {
    assert.ok(visual, JSON.stringify(response.results));
    assert.equal(visual.matchedEvidence.pageStart, expectedPage);
    assert.ok(visual.matchedEvidence.snippet.length <= 222);
    assert.ok(Number.isInteger(visual.displayScore));
  } else {
    assert.equal(visual, undefined, JSON.stringify(response.results));
  }
  await page.waitForSelector(".result-card", { timeout: 30_000 }).catch(async (error) => {
    throw new Error(`${error.message}\nUI URL: ${page.url()}\nUI BODY: ${await page.locator("body").innerText().catch(() => "")}`);
  });
  assert.ok(await page.locator(".result-card mark").count() > 0);
  assert.equal(await page.locator(".score b").first().textContent().then((value) => /^\d{1,3}$/.test(value.trim())), true);
  assert.equal((await page.locator('.visual-preview img[src*="/visual/"]').count() > 0), expectVisual);
  assert.equal(electronProcess.exitCode, null, processOutput);
});
