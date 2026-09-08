import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { cosineSimilarity } from "./retrieval.mjs";

const pointerName = "active-generation.json";
const require = createRequire(import.meta.url);
let Usearch = null;
try { Usearch = require("usearch"); } catch { /* JSON generation fallback remains available. */ }

export function createAnnIndex({ directory, dimension = 384 }) {
  let active = null;
  async function load() {
    if (active) return active;
    try {
      const pointer = JSON.parse(await fs.readFile(path.join(directory, pointerName), "utf8"));
      if (pointer.engine === "usearch" && Usearch) {
        const index = new Usearch.Index({ dimensions: dimension, metric: Usearch.MetricKind.Cos });
        await index.load(path.join(directory, pointer.file));
        const mapping = JSON.parse(await fs.readFile(path.join(directory, pointer.mapping), "utf8"));
        active = { engine: "usearch", index, mapping, generation: pointer.generation, dimension };
      } else {
        const payload = JSON.parse(await fs.readFile(path.join(directory, pointer.file), "utf8"));
        if (payload.dimension !== dimension || payload.generation !== pointer.generation) throw new Error("ANN generation metadata mismatch");
        active = { engine: "json", ...payload };
      }
    } catch { active = null; }
    return active;
  }
  return {
    async build(rows) {
      if (!(rows || []).every((row) => Array.isArray(row.vector) && row.vector.length === dimension)) throw new Error(`embedding dimension mismatch: expected ${dimension}`);
      await fs.mkdir(directory, { recursive: true });
      const generation = `${Date.now()}-${crypto.randomUUID()}`;
      if (Usearch) {
        const file = `ann-${generation}.usearch`;
        const mappingFile = `ann-${generation}.map.json`;
        const stage = `${file}.partial`;
        const mapping = {};
        const index = new Usearch.Index({ dimensions: dimension, metric: Usearch.MetricKind.Cos });
        rows.forEach((row, position) => { const key = String(position + 1); mapping[key] = String(row.unitId); index.add(BigInt(position + 1), new Float32Array(row.vector)); });
        await index.save(path.join(directory, stage));
        await fs.rename(path.join(directory, stage), path.join(directory, file));
        await fs.writeFile(path.join(directory, `${mappingFile}.partial`), JSON.stringify(mapping), "utf8");
        await fs.rename(path.join(directory, `${mappingFile}.partial`), path.join(directory, mappingFile));
        const pointer = `${pointerName}.partial`;
        await fs.writeFile(path.join(directory, pointer), JSON.stringify({ generation, dimension, file, mapping: mappingFile, engine: "usearch" }), "utf8");
        await fs.rename(path.join(directory, pointer), path.join(directory, pointerName));
        active = { engine: "usearch", index, mapping, generation, dimension };
        return generation;
      }
      const file = `ann-${generation}.json`;
      const stage = `${file}.partial`;
      const payload = { format: "weki-ann-index", version: 1, generation, dimension, rows: rows.map((row) => ({ unitId: String(row.unitId), vector: row.vector.map(Number) })) };
      await fs.writeFile(path.join(directory, stage), JSON.stringify(payload), "utf8");
      await fs.rename(path.join(directory, stage), path.join(directory, file));
      const pointer = `${pointerName}.partial`;
      await fs.writeFile(path.join(directory, pointer), JSON.stringify({ generation, dimension, file, engine: "json" }), "utf8");
      await fs.rename(path.join(directory, pointer), path.join(directory, pointerName));
      active = { engine: "json", ...payload };
      return generation;
    },
    async search(vector, limit = 200) {
      const payload = await load();
      if (!payload || !Array.isArray(vector) || vector.length !== dimension) return [];
      if (payload.engine === "usearch") {
        const matches = payload.index.search(new Float32Array(vector), Math.min(200, Number(limit) || 200));
        return Array.from(matches.keys, (key, index) => ({ id: payload.mapping[String(key)], unitId: payload.mapping[String(key)], score: 1 - Number(matches.distances[index] || 0), engine: "ann" }));
      }
      return payload.rows.map((row) => ({ id: row.unitId, unitId: row.unitId, score: cosineSimilarity(vector, row.vector), engine: "ann" }))
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, Math.min(200, Number(limit) || 200));
    },
    async health() {
      const payload = await load();
      return { status: payload ? "healthy" : "unavailable", generation: payload?.generation || null, dimension, engine: payload?.engine || "json-fallback" };
    },
    close: async () => { active = null; },
  };
}
