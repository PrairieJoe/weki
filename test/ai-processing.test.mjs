import assert from "node:assert/strict";
import test from "node:test";

test("generated metadata is validated and auxiliary search text is deterministic", async () => {
  const { validateGeneratedMetadata, buildSearchAuxiliaryText } = await import("../src/processing/ai-processing.mjs");
  assert.deepEqual(validateGeneratedMetadata({ title: "Title", summary: "Summary", tags: ["one"] }), { title: "Title", summary: "Summary", tags: ["one"] });
  assert.equal(validateGeneratedMetadata({ title: "", tags: "not-an-array" }), null);
  assert.equal(buildSearchAuxiliaryText({ title: "Title", summary: "Summary", tags: ["one", "two"] }), "Title\nSummary\none two");
});
