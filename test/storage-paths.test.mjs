import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { resolveDataDirectory, selectInitialDataDirectory } from "../src/server/storage.mjs";

test("packaged data directory is durable and respects an explicit override", () => {
  assert.equal(resolveDataDirectory({ defaultDataDir: "E:/Weki/data" }), path.normalize("E:/Weki/data"));
  assert.equal(resolveDataDirectory({ defaultDataDir: "E:/Weki/data", envDataDir: "D:/WekiData" }), path.normalize("D:/WekiData"));
});

test("packaged installs use the registry pointer or the executable-side data directory, never AppData fallback", () => {
  assert.equal(selectInitialDataDirectory({ installDataDir: "E:/Weki/data", appDataDir: "C:/Users/test/AppData/Local/Weki/data", hasExistingAppData: false }), path.normalize("E:/Weki/data"));
  assert.equal(selectInitialDataDirectory({ installDataDir: "E:/Weki/data", appDataDir: "C:/Users/test/AppData/Local/Weki/data", hasExistingAppData: true }), path.normalize("E:/Weki/data"));
  assert.equal(selectInitialDataDirectory({ pointerDataDir: "D:/WekiData", installDataDir: "E:/Weki/data", appDataDir: "C:/Users/test/AppData/Local/Weki/data", hasExistingAppData: true }), path.normalize("D:/WekiData"));
});
