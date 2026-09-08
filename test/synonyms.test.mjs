import test from "node:test";
import assert from "node:assert/strict";
import {
  expandSynonymQuery,
  normalizeSynonymEntry,
  suggestSynonymCandidates,
  validateSynonymInput,
} from "../src/search/synonyms.mjs";

test("normalizes and validates a user synonym entry", () => {
  const entry = normalizeSynonymEntry({ term: " 결제 ", aliases: [" 지급 "] }, { id: "s1" });

  assert.deepEqual(entry, {
    id: "s1",
    term: "결제",
    aliases: ["지급"],
    status: "approved",
    source: "manual",
  });
  assert.deepEqual(validateSynonymInput({ term: "결제", aliases: ["지급"] }), { valid: true, errors: [], term: "결제", aliases: ["지급"] });
});

test("expands only approved synonyms once and never recursively", () => {
  const result = expandSynonymQuery("결제", [
    { term: "결제", aliases: ["지급"], status: "approved" },
    { term: "지급", aliases: ["납부"], status: "approved" },
    { term: "환불", aliases: ["반환"], status: "draft" },
  ]);

  assert.deepEqual(result.expansions, ["지급"]);
  assert.equal(result.query, "결제 지급");
  assert.deepEqual(expandSynonymQuery("납부", [{ term: "결제", aliases: ["납부"], status: "approved" }]).expansions, ["결제"]);
});

test("normalizes query punctuation before applying an approved synonym", () => {
  const result = expandSynonymQuery("111 – 1번 변경구간", [
    { term: "111-1번", aliases: ["노선A"], status: "approved" },
  ]);

  assert.deepEqual(result.queries, ["노선A 변경구간"]);
});

test("does not replace a synonym inside a larger word", () => {
  const result = expandSynonymQuery("버스정류장", [
    { term: "버스", aliases: ["대중교통"], status: "approved" },
  ]);

  assert.deepEqual(result.queries, []);
});

test("rejects empty, self-referential, and duplicate synonym values", () => {
  const result = validateSynonymInput({ term: "결제", aliases: ["결제", " 지급 ", "지급"] });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ["기준어와 동의어가 같을 수 없습니다.", "동의어가 중복됩니다."]);
});

test("suggests draft aliases from helpful search feedback without auto-applying them", () => {
  const suggestions = suggestSynonymCandidates({
    feedback: [{ query: "결제", documentId: "d1", helpful: true }],
    documents: [{ id: "d1", units: [{ text: "결제 지급 승인 절차 안내" }] }],
    existing: [],
  });

  assert.deepEqual(suggestions, [{ term: "결제", aliases: ["지급"], status: "draft", source: "suggested" }]);
});
