import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEvidenceSnippet,
  formatDisplayScore,
  highlightEvidence,
} from "../src/search/evidence-display.mjs";

test("builds a bounded snippet around the first matched term", () => {
  const context = "서두에 다른 내용이 있습니다. OO시 인구는 2025년 기준으로 증가했습니다. 뒤쪽의 부가 설명도 있습니다.";
  const result = buildEvidenceSnippet(context, "OO시 인구", { maxChars: 40 });

  assert.equal(result.text, "…있습니다. OO시 인구는 2025년 기준으로 증가했습니다.…");
  assert.deepEqual(result.matchedTerms, ["OO시", "인구"]);
  assert.equal(result.truncated, true);
});

test("highlights escaped terms without allowing markup injection", () => {
  const highlighted = highlightEvidence("<script>OO시</script> 인구", ["OO시", "인구"]);

  assert.equal(highlighted, "&lt;script&gt;<mark>OO시</mark>&lt;/script&gt; <mark>인구</mark>");
});

test("finds and bounds route evidence when OCR inserts a space before 번", () => {
  const result = buildEvidenceSnippet("노선도 OCR 결과: 111-1 번 우회구간 안내", "111-1번 변경구간");
  assert.equal(result.text.length <= 222, true);
  assert.equal(result.matchedTerms.includes("111-1"), true);
});

test("finds and highlights Korean terms when OCR spaces every syllable", () => {
  const context = "시 외 버 스 전 체 종 사 자 수 는 5,913명 감소";
  const result = buildEvidenceSnippet(context, "시외버스 종사자수");
  assert.deepEqual(result.matchedTerms, ["시외버스", "종사자수"]);
  assert.match(highlightEvidence(context, result.matchedTerms), /<mark>시 외 버 스<\/mark>/);
  assert.match(highlightEvidence(context, result.matchedTerms), /<mark>종 사 자 수<\/mark>/);
});

test("formats relevance for display while preserving an integer range", () => {
  assert.equal(formatDisplayScore(0.8764), 88);
  assert.equal(formatDisplayScore(88.7), 89);
  assert.equal(formatDisplayScore("bad"), 0);
});

test("keeps a semantic-only long evidence preview bounded", () => {
  const result = buildEvidenceSnippet("설명 ".repeat(180), "다른 표현", { maxChars: 80 });

  assert.equal(result.truncated, true);
  assert.ok(result.text.length <= 81);
  assert.deepEqual(result.matchedTerms, []);
});
