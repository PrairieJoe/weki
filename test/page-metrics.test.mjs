import test from "node:test";
import assert from "node:assert/strict";

import { buildPageMetrics } from "../src/server/backup.mjs";

test("page metrics count source pages separately from searchable units", () => {
  const pages = [{ page: 1, text: "one" }, { page: 2, text: "" }, { page: 3, text: "three" }];
  const units = [{ range: 1 }, { range: 3 }, { range: 3, evidenceType: "table" }];

  assert.deepEqual(buildPageMetrics(pages, units), {
    pageCount: 3,
    searchablePageCount: 2,
    indexedUnitCount: 3,
    failedPageCount: 1,
    processingStatus: "partial",
  });
});
