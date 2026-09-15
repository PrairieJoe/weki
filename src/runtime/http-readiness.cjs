async function requestWithTimeout(url, { fetchImpl = globalThis.fetch, timeoutMs = 2_000, parseJson = false } = {}) {
  const timeout = Number.isFinite(Number(timeoutMs)) ? Math.max(1, Number(timeoutMs)) : 2_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!parseJson) return response;
    return { response, data: await response.json() };
  } catch (error) {
    if (controller.signal.aborted) {
      throw Object.assign(new Error(`HTTP request timed out after ${timeout} ms.`), { code: "HTTP_REQUEST_TIMEOUT", cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { requestWithTimeout };
