import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function createRuntimeRerankerProvider({ componentPath } = {}) {
  const modulePath = path.join(String(componentPath || ""), "reranker.mjs");
  try { await fs.access(modulePath); } catch { return unavailable("reranker_module_missing"); }
  try {
    const module = await import(`${pathToFileURL(modulePath).href}?runtime=${Date.now()}`);
    if (typeof module.rerank !== "function") return unavailable("reranker_export_missing");
    return { available: true, model: module.model || "runtime-reranker", rerank: module.rerank };
  } catch { return unavailable("reranker_load_failed"); }
}

function unavailable(reason) {
  return { available: false, model: null, reason, rerank: async () => { throw new Error(reason); } };
}
