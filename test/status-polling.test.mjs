import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");

test("status polling never redraws the search page while the user may be composing a query", async () => {
  const { shouldRenderStatusPoll } = await import("../src/search/status-polling.mjs").catch(() => ({}));

  assert.equal(shouldRenderStatusPoll?.("search", "query"), false);
  assert.equal(shouldRenderStatusPoll?.("search", null), false);
  assert.equal(shouldRenderStatusPoll?.("search", "other-control"), false);
  assert.equal(shouldRenderStatusPoll?.("add", "query"), true);
});

test("the status poll applies the composer guard after refreshing", () => {
  const start = main.indexOf("function scheduleStatusPoll(");
  const end = main.indexOf("\nscheduleStatusPoll();", start);
  const poll = main.slice(start, end);

  assert.match(poll, /await refresh\(\);\s*if \(shouldRenderStatusPoll\(state\.page\)\) render\(\);/);
});
