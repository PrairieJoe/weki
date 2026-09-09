import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSearchCases } from "../src/search/evaluation.mjs";

test("search evaluation reports recall, MRR and evidence precision", async () => {
  const metrics = await evaluateSearchCases({
    cases: [
      { query: "버스", relevantUnitIds: ["u1"], relevantEvidenceIds: ["e1"] },
      { query: "노선", relevantUnitIds: ["u2"], relevantEvidenceIds: ["e2"] },
    ],
    search: async (query) => query === "버스"
      ? { results: [{ unitId: "u1", matchedEvidence: { id: "e1" } }] }
      : { results: [{ unitId: "other", matchedEvidence: { id: "other-e" } }, { unitId: "u2", matchedEvidence: { id: "e2" } }] },
    k: 2,
  });
  assert.equal(metrics.cases, 2);
  assert.equal(metrics.recallAtK, 1);
  assert.equal(metrics.mrr, 0.75);
  assert.equal(metrics.evidencePrecision, 2 / 3);
});
