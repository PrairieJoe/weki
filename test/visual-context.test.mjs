import test from "node:test";
import assert from "node:assert/strict";
import { buildVisualContext } from "../src/processing/visual-context.mjs";

test("visual context does not inherit an entire previous page", () => {
  const context = buildVisualContext({
    nativeText: "현재 페이지의 도표 제목",
    previousNativeText: "이전 페이지의 999번 폐지 안내",
  });

  assert.equal(context, "현재 페이지의 도표 제목");
  assert.doesNotMatch(context, /999번/);
});
