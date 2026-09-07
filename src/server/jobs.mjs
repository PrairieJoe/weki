export const ACTIVE_JOB_STATUSES = ["queued", "processing", "paused"];
export const VISIBLE_JOB_STATUSES = [...ACTIVE_JOB_STATUSES, "failed"];

export function visibleJobs(jobs = [], limit = 20) {
  return jobs.filter((job) => VISIBLE_JOB_STATUSES.includes(job.status)).slice(0, limit);
}

export function canRetryJob(job) {
  return job?.status === "failed" && Boolean(job.stagedPath);
}
