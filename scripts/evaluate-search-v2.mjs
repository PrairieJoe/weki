import fs from "node:fs/promises";
import { evaluateSearchCases } from "../src/search/evaluation.mjs";

const baseUrl = String(process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/u, "");
const fixturePath = process.argv[3];
if (!fixturePath) throw new Error("Usage: node scripts/evaluate-search-v2.mjs <baseUrl> <fixture.json>");
const cases = JSON.parse(await fs.readFile(fixturePath, "utf8"));
const metrics = await evaluateSearchCases({
  cases,
  search: async (query, item) => {
    const response = await fetch(`${baseUrl}/api/v2/search`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, filters: item.filters, includeContext: true }) });
    if (!response.ok) throw new Error(`search failed: ${response.status}`);
    return response.json();
  },
  k: 5,
});
console.log(JSON.stringify({ baseUrl, ...metrics }, null, 2));
