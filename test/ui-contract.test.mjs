import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");

test("Weki uses the documented indigo design tokens", () => {
  assert.match(styles, /--primary:\s*#000666/i);
  assert.match(styles, /IBM Plex Sans/);
  assert.match(styles, /JetBrains Mono/);
});

test("Weki search has a persistent composer and accessible navigation", () => {
  assert.match(styles, /\.search-composer/);
  assert.match(main, /aria-current=/);
  assert.match(main, /role="search"/);
});

test("Weki exposes a managed destructive-operation dialog", () => {
  assert.match(main, /role="dialog"/);
  assert.match(main, /aria-modal="true"/);
});
