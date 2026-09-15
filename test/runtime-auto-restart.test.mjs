import test from "node:test";
import assert from "node:assert/strict";

const restartModule = await import("../src/runtime/auto-restart.mjs").catch(() => ({}));

test("runtime install monitor waits for the matching batch and active jobs before relaunching", async () => {
  assert.equal(typeof restartModule.monitorRuntimeInstallAutoRestart, "function");

  const startedAt = "2026-09-15T10:00:00.000Z";
  const snapshots = [
    { installBatch: { status: "ready", startedAt: "2026-09-15T09:59:00.000Z", installed: ["semantic-model"], failed: [] }, jobs: [] },
    { installBatch: { status: "indexing", startedAt, installed: [], failed: [] }, jobs: [] },
    { installBatch: { status: "ready", startedAt, installed: ["semantic-model", "semantic-reranker"], failed: [] }, jobs: [{ status: "processing" }] },
    { installBatch: { status: "ready", startedAt, installed: ["semantic-model", "semantic-reranker"], failed: [] }, jobs: [] },
    { installBatch: { status: "ready", startedAt, installed: ["semantic-model", "semantic-reranker"], failed: [] }, jobs: [] },
  ];
  const waits = [];
  const events = [];
  let restartRequests = 0;

  const result = await restartModule.monitorRuntimeInstallAutoRestart({
    startedAt,
    getSnapshot: async () => snapshots.shift(),
    requestRestart: async () => { restartRequests += 1; },
    onEvent: (event) => events.push(event),
    wait: async (milliseconds) => { waits.push(milliseconds); return true; },
    pollIntervalMs: 500,
    restartDelayMs: 3000,
  });

  assert.deepEqual(result, { status: "restarted" });
  assert.equal(restartRequests, 1);
  assert.deepEqual(waits, [500, 500, 500, 3000]);
  assert.ok(events.some((event) => event.reason === "batch-not-started"));
  assert.ok(events.some((event) => event.reason === "active-jobs"));
});

test("runtime install monitor does not relaunch after a failed batch", async () => {
  assert.equal(typeof restartModule.monitorRuntimeInstallAutoRestart, "function");

  let restartRequests = 0;
  const result = await restartModule.monitorRuntimeInstallAutoRestart({
    startedAt: "2026-09-15T10:00:00.000Z",
    getSnapshot: async () => ({
      installBatch: { status: "failed", startedAt: "2026-09-15T10:00:00.000Z", installed: ["semantic-model"], failed: [{ id: "semantic-reranker" }] },
      jobs: [],
    }),
    requestRestart: async () => { restartRequests += 1; },
    wait: async () => true,
  });

  assert.deepEqual(result, { status: "skipped", reason: "batch-failed" });
  assert.equal(restartRequests, 0);
});

test("runtime install monitor cancels during its restart countdown", async () => {
  assert.equal(typeof restartModule.monitorRuntimeInstallAutoRestart, "function");

  const controller = new AbortController();
  let restartRequests = 0;
  const result = await restartModule.monitorRuntimeInstallAutoRestart({
    startedAt: "2026-09-15T10:00:00.000Z",
    getSnapshot: async () => ({
      installBatch: { status: "partial", startedAt: "2026-09-15T10:00:00.000Z", installed: ["semantic-reranker"], failed: [], unavailable: ["document-renderer"] },
      jobs: [],
    }),
    requestRestart: async () => { restartRequests += 1; },
    wait: async (_milliseconds, signal) => { controller.abort(); return !signal.aborted; },
    signal: controller.signal,
  });

  assert.deepEqual(result, { status: "cancelled" });
  assert.equal(restartRequests, 0);
});

test("runtime install UI arms the main-process watcher only for an accepted batch", async () => {
  assert.equal(typeof restartModule.armRuntimeInstallAutoRestart, "function");

  const calls = [];
  const rejected = await restartModule.armRuntimeInstallAutoRestart({
    responseOk: false,
    startedAt: "2026-09-15T10:00:00.000Z",
    watch: async (startedAt) => { calls.push(startedAt); return { ok: true }; },
  });
  const accepted = await restartModule.armRuntimeInstallAutoRestart({
    responseOk: true,
    startedAt: "2026-09-15T10:01:00.000Z",
    watch: async (startedAt) => { calls.push(startedAt); return { ok: true }; },
  });

  assert.deepEqual(rejected, { ok: false, reason: "install-request-failed" });
  assert.deepEqual(accepted, { ok: true });
  assert.deepEqual(calls, ["2026-09-15T10:01:00.000Z"]);
});
