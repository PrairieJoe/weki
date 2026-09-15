import test from "node:test";
import assert from "node:assert/strict";
import { metadataTextMatches } from "../scripts/release-metadata-utils.mjs";

test("release metadata comparison accepts Windows CRLF checkout without hiding content changes", () => {
  const generated = "version: 1.3.0\npath: Weki-1.3.0-Setup.exe\n";
  const windowsCheckout = generated.replace(/\n/gu, "\r\n");

  assert.equal(metadataTextMatches(windowsCheckout, generated), true);
  assert.equal(metadataTextMatches(`${windowsCheckout}extra\r\n`, generated), false);
});
