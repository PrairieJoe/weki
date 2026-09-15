const ACTIVE_JOB_STATUSES = new Set(["queued", "processing", "paused"]);

function normalizeJobs(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.jobs)) return value.jobs;
  return [];
}

export function runtimeAutoRestartDecision(batch, jobs, expectedStartedAt) {
  if (!batch || typeof batch !== "object") return { action: "wait", reason: "batch-not-started" };
  if (!batch.startedAt) return { action: "wait", reason: "batch-not-started" };
  if (batch.startedAt !== expectedStartedAt) {
    const expectedTime = Date.parse(expectedStartedAt || "");
    const actualTime = Date.parse(batch.startedAt);
    return Number.isFinite(expectedTime) && Number.isFinite(actualTime) && actualTime > expectedTime
      ? { action: "skip", reason: "batch-superseded" }
      : { action: "wait", reason: "batch-not-started" };
  }
  if (["idle", "indexing"].includes(batch.status)) return { action: "wait", reason: "batch-in-progress" };
  if (batch.status === "failed" || (batch.failed || []).length) return { action: "skip", reason: "batch-failed" };
  if (!["ready", "partial"].includes(batch.status)) return { action: "skip", reason: "batch-not-restartable" };
  if (!(batch.installed || []).length) return { action: "skip", reason: "nothing-installed" };
  const activeJobCount = normalizeJobs(jobs).filter((job) => ACTIVE_JOB_STATUSES.has(job?.status)).length;
  if (activeJobCount) return { action: "wait", reason: "active-jobs", activeJobCount };
  return { action: "restart", reason: "install-complete", activeJobCount: 0 };
}

export async function armRuntimeInstallAutoRestart({ responseOk, startedAt, watch } = {}) {
  if (!responseOk) return { ok: false, reason: "install-request-failed" };
  if (!startedAt) return { ok: false, reason: "batch-start-time-missing" };
  if (typeof watch !== "function") return { ok: false, reason: "main-process-watcher-unavailable" };
  try {
    const result = await watch(startedAt);
    return result?.ok ? { ok: true } : { ok: false, reason: result?.reason || "main-process-watcher-rejected" };
  } catch {
    return { ok: false, reason: "main-process-watcher-unavailable" };
  }
}

function delay(milliseconds, signal) {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    let timer;
    const finish = (elapsed) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(elapsed);
    };
    const onAbort = () => finish(false);
    timer = setTimeout(() => finish(true), milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function emit(onEvent, event) {
  try { onEvent?.(event); } catch { /* Diagnostics must never block the restart flow. */ }
}

function decisionEvent(decision, batch) {
  return {
    type: "decision",
    decision: decision.action,
    reason: decision.reason,
    batchStatus: batch?.status || null,
    installedCount: (batch?.installed || []).length,
    failedCount: (batch?.failed || []).length,
    activeJobCount: decision.activeJobCount || 0,
  };
}

export async function monitorRuntimeInstallAutoRestart({
  startedAt,
  getSnapshot,
  requestRestart,
  onEvent = () => {},
  wait = delay,
  pollIntervalMs = 1000,
  restartDelayMs = 3000,
  maxConsecutiveErrors = 10,
  signal,
} = {}) {
  if (!startedAt || typeof getSnapshot !== "function" || typeof requestRestart !== "function") {
    return { status: "skipped", reason: "invalid-monitor-configuration" };
  }

  let consecutiveErrors = 0;
  let lastDecisionKey = "";
  const readSnapshot = async () => {
    const snapshot = await getSnapshot();
    const batch = snapshot?.installBatch || snapshot?.runtime?.installBatch || null;
    const jobs = normalizeJobs(snapshot?.jobs);
    return { batch, jobs };
  };
  const readWithRetry = async () => {
    try {
      const snapshot = await readSnapshot();
      consecutiveErrors = 0;
      return snapshot;
    } catch (error) {
      consecutiveErrors += 1;
      emit(onEvent, { type: "poll-error", consecutiveErrors, message: String(error?.message || error) });
      if (consecutiveErrors >= maxConsecutiveErrors) return { terminal: { status: "skipped", reason: "status-unavailable" } };
      const elapsed = await wait(pollIntervalMs, signal);
      if (signal?.aborted || elapsed === false) return { terminal: { status: "cancelled" } };
      return null;
    }
  };

  while (!signal?.aborted) {
    const snapshot = await readWithRetry();
    if (snapshot?.terminal) return snapshot.terminal;
    if (!snapshot) continue;

    const decision = runtimeAutoRestartDecision(snapshot.batch, snapshot.jobs, startedAt);
    const event = decisionEvent(decision, snapshot.batch);
    const decisionKey = JSON.stringify(event);
    if (decisionKey !== lastDecisionKey) {
      emit(onEvent, event);
      lastDecisionKey = decisionKey;
    }
    if (decision.action === "skip") return { status: "skipped", reason: decision.reason };
    if (decision.action === "wait") {
      const elapsed = await wait(pollIntervalMs, signal);
      if (signal?.aborted || elapsed === false) return { status: "cancelled" };
      continue;
    }

    emit(onEvent, { type: "restart-countdown", delayMs: restartDelayMs });
    const elapsed = await wait(restartDelayMs, signal);
    if (signal?.aborted || elapsed === false) return { status: "cancelled" };

    const confirmation = await readWithRetry();
    if (confirmation?.terminal) return confirmation.terminal;
    if (!confirmation) continue;
    const finalDecision = runtimeAutoRestartDecision(confirmation.batch, confirmation.jobs, startedAt);
    if (finalDecision.action === "restart") {
      emit(onEvent, decisionEvent(finalDecision, confirmation.batch));
      emit(onEvent, { type: "relaunch-requested", batchStartedAt: startedAt });
      try {
        await requestRestart();
        return { status: "restarted" };
      } catch (error) {
        emit(onEvent, { type: "relaunch-request-failed", message: String(error?.message || error) });
        return { status: "skipped", reason: "relaunch-request-failed" };
      }
    }
    if (finalDecision.action === "skip") return { status: "skipped", reason: finalDecision.reason };
    emit(onEvent, decisionEvent(finalDecision, confirmation.batch));
    lastDecisionKey = JSON.stringify(decisionEvent(finalDecision, confirmation.batch));
  }
  return { status: "cancelled" };
}
