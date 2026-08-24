import type { TtsJob, TtsJobStatus } from "@renderer/types"

const TERMINAL_JOB_STATUSES: TtsJobStatus[] = ["completed", "failed", "cancelled"]

export function isTerminalJobStatus(status: TtsJobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status)
}

export function isActiveJob(job: TtsJob): boolean {
  return !isTerminalJobStatus(job.status) && job.status !== "paused"
}

export function isPartialTtsJob(job: TtsJob): boolean {
  return Boolean(job.settings.partial) || typeof job.settings.paragraphLimit === "number"
}

export function isSegmentOnlyTtsJob(job: TtsJob): boolean {
  return job.settings.segmentsOnly === true
}

export function audioProgressForJob(job: TtsJob): number {
  return job.progress
}

export function isClearableTerminalJob(job: TtsJob): boolean {
  return isTerminalJobStatus(job.status) && !isSegmentOnlyTtsJob(job)
}

export function activeJobCount(jobs: TtsJob[]): number {
  return jobs.filter(isActiveJob).length
}

export function hasTerminalJob(jobs: TtsJob[]): boolean {
  return jobs.some((job) => isTerminalJobStatus(job.status))
}

export function hasClearableTerminalJob(jobs: TtsJob[]): boolean {
  return jobs.some(isClearableTerminalJob)
}
