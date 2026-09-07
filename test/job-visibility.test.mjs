import test from "node:test";
import assert from "node:assert/strict";

import { canRetryJob, visibleJobs } from "../src/server/jobs.mjs";

test("failed registration jobs remain visible while completed jobs leave the active queue", () => {
  const jobs = [
    { id: "failed", status: "failed", createdAt: "2026-09-06T02:00:00.000Z" },
    { id: "completed", status: "completed", createdAt: "2026-09-06T01:00:00.000Z" },
    { id: "processing", status: "processing", createdAt: "2026-09-06T00:00:00.000Z" },
  ];

  assert.deepEqual(visibleJobs(jobs).map((job) => job.id), ["failed", "processing"]);
});

test("failed registration can be retried only while its staged source is available", () => {
  assert.equal(canRetryJob({ status: "failed", stagedPath: "E:/Weki/incoming/job.pdf" }), true);
  assert.equal(canRetryJob({ status: "failed", stagedPath: null }), false);
  assert.equal(canRetryJob({ status: "completed", stagedPath: "E:/Weki/incoming/job.pdf" }), false);
});
