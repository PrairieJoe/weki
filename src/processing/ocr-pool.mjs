import crypto from "node:crypto";

function cacheKey(bytes, explicitKey = null) {
  if (explicitKey) return String(explicitKey);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export async function createCachedOcrPool({ createWorker, size = 2, maxCacheEntries = 512 } = {}) {
  if (typeof createWorker !== "function") throw new TypeError("createWorker is required");
  const workerCount = Math.max(1, Math.min(4, Number(size) || 1));
  const cache = new Map();
  const slots = [];
  let initializationPromise = null;

  async function initialize() {
    if (!initializationPromise) initializationPromise = (async () => {
      for (let index = 0; index < workerCount; index += 1) slots.push({ worker: await createWorker(), busy: false });
    })();
    return initializationPromise;
  }

  function remember(key, value) {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > Math.max(1, Number(maxCacheEntries) || 1)) cache.delete(cache.keys().next().value);
  }

  async function recognize(bytes, { key = null } = {}) {
    await initialize();
    const digest = cacheKey(bytes, key);
    if (cache.has(digest)) return cache.get(digest);
    while (true) {
      const slot = slots.find((item) => !item.busy);
      if (slot) {
        slot.busy = true;
        try {
          const result = await slot.worker.recognize(bytes);
          const text = result?.data?.text ?? result?.text ?? "";
          remember(digest, text);
          return text;
        } finally { slot.busy = false; }
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  async function close() {
    await Promise.all(slots.map(async (slot) => slot.worker?.terminate?.()));
    slots.length = 0;
    cache.clear();
  }

  return { recognize, close, cache, size: workerCount };
}
