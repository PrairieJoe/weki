import test from "node:test";
import assert from "node:assert/strict";
import { createCachedOcrPool } from "../src/processing/ocr-pool.mjs";

test("OCR pool bounds workers and reuses cached image recognition", async () => {
  let created = 0;
  let recognized = 0;
  const pool = await createCachedOcrPool({
    size: 2,
    createWorker: async () => ({
      recognize: async (bytes) => { recognized += 1; await new Promise((resolve) => setTimeout(resolve, 2)); return { data: { text: `OCR:${Buffer.from(bytes).toString()}` } }; },
      terminate: async () => {},
    }),
  });
  // Workers are lazy in production; two concurrent requests establish the bounded pool.
  const results = await Promise.all([pool.recognize(Buffer.from("a")), pool.recognize(Buffer.from("b"))]);
  created = pool.size;
  assert.equal(created, 2);
  assert.deepEqual(results.sort(), ["OCR:a", "OCR:b"]);
  assert.equal(await pool.recognize(Buffer.from("a")), "OCR:a");
  assert.equal(recognized, 2);
  await pool.close();
});
