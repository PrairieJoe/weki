import assert from "node:assert/strict";
import test from "node:test";
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

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(label, callback, { timeout = 30_000, interval = 200 } = {}) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeout) {
    try {
      const value = await callback();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ""}`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function launchEmptyApp() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "weki-onboarding-e2e-"));
  const profileDir = path.join(dataDir, "electron-profile");
  const runtimeDir = path.join(dataDir, "runtime", "v1");
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.writeFile(path.join(runtimeDir, "component-state.json"), JSON.stringify({
    format: "weki-runtime-state",
    version: 1,
    components: {
      "document-renderer": {
        id: "document-renderer",
        status: "ready",
        version: "0.8.4",
        path: path.join(projectRoot, "node_modules", "@rhwp", "core"),
      },
    },
  }));

  const port = await freePort();
  const debugPort = await freePort();
  const testEnv = {
    ...process.env,
    WEKI_DATA_DIR: dataDir,
    WEKI_RUNTIME_DIR: runtimeDir,
    WEKI_SEARCH_V2: "1",
    WEKI_PORT: String(port),
    WEKI_DISABLE_ENV_FILE: "1",
    WEKI_DISABLE_INITIAL_MYBOX_SYNC: "1",
  };
  let serverProcess;
  let electronProcess;
  let browser;
  let processOutput = "";
  const collectOutput = (chunk) => { processOutput += chunk.toString(); };
  const cleanup = async () => {
    await browser?.close().catch(() => {});
    await stopProcess(electronProcess);
    await stopProcess(serverProcess);
    await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };

  try {
    serverProcess = spawn(process.execPath, [path.join(projectRoot, "server.mjs")], {
      cwd: projectRoot,
      env: testEnv,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    serverProcess.stdout.on("data", collectOutput);
    serverProcess.stderr.on("data", collectOutput);
    await waitFor("Weki server", async () => {
      try {
        return (await fetch(`http://127.0.0.1:${port}/api/status`)).ok;
      } catch {
        return false;
      }
    }).catch((error) => { throw new Error(`${error.message}\n${processOutput}`); });

    electronProcess = spawn(require("electron"), [
      "--disable-gpu",
      "--no-sandbox",
      "--no-first-run",
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${debugPort}`,
      projectRoot,
    ], {
      cwd: projectRoot,
      env: testEnv,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    electronProcess.stdout.on("data", collectOutput);
    electronProcess.stderr.on("data", collectOutput);
    browser = await waitFor("Electron DevTools", async () => {
      try {
        return await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
      } catch {
        return null;
      }
    });
    const page = await waitFor("Electron window", async () => browser.contexts()[0]?.pages()[0] || null);
    const mutationRequests = [];
    const recordMutation = (request) => {
      if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) {
        mutationRequests.push({ method: request.method(), url: request.url() });
      }
    };
    page.on("request", recordMutation);
    await page.waitForSelector("#query", { timeout: 30_000 }).catch(async (error) => {
      if (!page.url()) {
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector("#query", { timeout: 30_000 });
      } else {
        throw new Error(`${error.message}\nURL: ${page.url()}\nBODY: ${await page.locator("body").innerText().catch(() => "")}\n${processOutput}`);
      }
    });
    return { page, cleanup, processOutput: () => processOutput, mutationRequests, recordMutation };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function assertStep(page, index, pageName, targetName) {
  await page.waitForFunction(({ expectedProgress, expectedPage, expectedTarget }) => {
    const progress = document.querySelector("[data-onboarding-progress]")?.textContent?.trim();
    const activePage = document.querySelector(`button.nav-item[data-nav="${expectedPage}"]`)?.getAttribute("aria-current") === "page";
    const target = document.querySelector(`[data-onboarding-target="${expectedTarget}"]`);
    return progress === expectedProgress && activePage && Boolean(target);
  }, {
    expectedProgress: `${index} / 5`,
    expectedPage: pageName,
    expectedTarget: targetName,
  });
  assert.equal(await page.locator(`[data-onboarding-target="${targetName}"]`).count(), 1);
  if (targetName === "evidence-fallback") {
    assert.equal(await page.locator(`[data-onboarding-target="${targetName}"]`).getAttribute("data-onboarding-fallback"), "true");
    assert.equal(await page.locator("#onboarding-root").getAttribute("data-onboarding-fallback"), "true");
    assert.notEqual(await page.locator("[data-onboarding-spotlight]").getAttribute("hidden"), null);
  } else {
    assert.equal(await page.locator("[data-onboarding-spotlight]").getAttribute("hidden"), null);
  }
}

test("fixture-free Electron onboarding tour completes, suppresses, replays, and closes", async (t) => {
  const app = await launchEmptyApp();
  t.after(app.cleanup);
  const { page, mutationRequests, recordMutation } = app;

  await page.waitForSelector("#onboarding-root", { timeout: 15_000 });
  await assertStep(page, 1, "search", "search-composer");
  assert.equal(await page.locator("[role=dialog][aria-modal=true]").count(), 1);

  await page.locator("[data-onboarding-next]").click();
  await assertStep(page, 2, "add", "registration-dropzone");
  await page.locator("[data-onboarding-next]").click();
  await assertStep(page, 3, "search", "evidence-fallback");
  await page.locator("[role=dialog]").evaluate(async (dialog) => {
    await Promise.all(dialog.getAnimations().map((animation) => animation.finished.catch(() => {})));
  });
  const fallbackLayout = await page.locator("#onboarding-root").evaluate((root) => {
    const dialog = root.querySelector("[role=dialog]");
    const style = getComputedStyle(root);
    const rect = dialog?.getBoundingClientRect();
    return {
      display: style.display,
      placeItems: style.placeItems,
      margin: dialog ? getComputedStyle(dialog).margin : null,
      centeredX: rect ? Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2) : Infinity,
      centeredY: rect ? Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2) : Infinity,
    };
  });
  assert.equal(fallbackLayout.display, "grid");
  assert.match(fallbackLayout.placeItems, /center/);
  assert.equal(fallbackLayout.margin, "0px");
  assert.ok(fallbackLayout.centeredX <= 2, `fallback dialog is not horizontally centered: ${fallbackLayout.centeredX}px`);
  assert.ok(fallbackLayout.centeredY <= 2, `fallback dialog is not vertically centered: ${fallbackLayout.centeredY}px`);
  await page.locator("[data-onboarding-next]").click();
  await assertStep(page, 4, "settings", "processing-mode");
  await page.locator("[data-onboarding-next]").click();
  await assertStep(page, 5, "settings", "mybox");

  await page.locator("[data-onboarding-next]").click();
  await waitFor("tour completion", async () => (await page.locator("#onboarding-root").count()) === 0);
  await waitFor("original search page", async () => (await page.locator('button.nav-item[data-nav="search"]').getAttribute("aria-current")) === "page");
  assert.equal(await page.locator('button.nav-item[data-nav="search"]').getAttribute("aria-current"), "page");
  assert.equal(await page.evaluate(() => localStorage.getItem("weki.onboarding.v1.completed")), "completed");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#query", { timeout: 15_000 });
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(await page.locator("#onboarding-root").count(), 0);

  const guide = page.locator("[data-onboarding-replay]");
  await guide.waitFor({ state: "visible", timeout: 5_000 });
  await guide.focus();
  assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute("data-onboarding-replay")), true);
  await guide.click();
  await assertStep(page, 1, "search", "search-composer");
  await page.keyboard.press("Escape");
  await waitFor("tour Escape close", async () => (await page.locator("#onboarding-root").count()) === 0);
  await waitFor("search page after Escape", async () => (await page.locator('button.nav-item[data-nav="search"]').getAttribute("aria-current")) === "page");
  assert.equal(await page.locator('button.nav-item[data-nav="search"]').getAttribute("aria-current"), "page");
  assert.deepEqual(mutationRequests, [], `onboarding issued write requests: ${JSON.stringify(mutationRequests)}`);
  assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute("data-onboarding-replay")), true);
  page.off("request", recordMutation);
  assert.equal(await page.evaluate(() => localStorage.getItem("weki.onboarding.v1.completed")), "completed");
});
