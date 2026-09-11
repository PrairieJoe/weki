import assert from "node:assert/strict";
import test from "node:test";

test("generated metadata is validated and auxiliary search text is deterministic", async () => {
  const { validateGeneratedMetadata, buildSearchAuxiliaryText } = await import("../src/processing/ai-processing.mjs");
  assert.deepEqual(validateGeneratedMetadata({ title: "Title", summary: "Summary", tags: ["one"] }), { title: "Title", summary: "Summary", tags: ["one"] });
  assert.equal(validateGeneratedMetadata({ title: "", tags: "not-an-array" }), null);
  assert.equal(buildSearchAuxiliaryText({ title: "Title", summary: "Summary", tags: ["one", "two"] }), "Title\nSummary\none two");
});

test("AI metadata is auxiliary only and preserves original searchable fields and evidence", async () => {
  const { buildSearchAuxiliaryText } = await import("../src/processing/ai-processing.mjs");
  const page = {
    text: "original text", nativeText: "native text", ocrText: "ocr text",
    evidence: [{ type: "text", text: "evidence" }],
    metadata: { title: "Generated title", summary: "Generated summary", tags: ["tag"] },
  };
  const original = structuredClone(page);
  const auxiliary = buildSearchAuxiliaryText(page.metadata);
  assert.equal(auxiliary, "Generated title\nGenerated summary\ntag");
  assert.deepEqual(page, original);
  assert.notEqual(auxiliary, page.text);
  assert.equal(page.nativeText, "native text");
  assert.equal(page.ocrText, "ocr text");
  assert.deepEqual(page.evidence, [{ type: "text", text: "evidence" }]);
});
