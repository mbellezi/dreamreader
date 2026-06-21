import { describe, expect, it } from "vitest"
import {
  activeJobCount,
  audioProgressForJob,
  hasTerminalJob,
  isActiveJob,
  isPartialTtsJob,
  isSegmentOnlyTtsJob,
  isTerminalJobStatus
} from "../../src/renderer/lib/jobQueue"
import type { TtsJob, TtsJobStatus } from "../../src/renderer/types"

function job(status: TtsJobStatus): TtsJob {
  return {
    id: `job-${status}`,
    bookId: "book-1",
    chapterHref: "chapter-1",
    status,
    progress: 0,
    settings: {},
    createdAt: "2026-06-06T12:00:00.000Z",
    updatedAt: "2026-06-06T12:00:00.000Z"
  } as TtsJob
}

describe("jobQueue helpers", () => {
  it("classifies terminal statuses", () => {
    expect(isTerminalJobStatus("completed")).toBe(true)
    expect(isTerminalJobStatus("failed")).toBe(true)
    expect(isTerminalJobStatus("cancelled")).toBe(true)
    expect(isTerminalJobStatus("paused")).toBe(false)
    expect(isTerminalJobStatus("synthesizing")).toBe(false)
  })

  it("treats paused and terminal jobs as inactive", () => {
    expect(isActiveJob(job("synthesizing"))).toBe(true)
    expect(isActiveJob(job("queued"))).toBe(true)
    expect(isActiveJob(job("paused"))).toBe(false)
    expect(isActiveJob(job("completed"))).toBe(false)
    expect(isActiveJob(job("failed"))).toBe(false)
  })

  it("counts only active jobs", () => {
    const jobs = [job("synthesizing"), job("queued"), job("paused"), job("completed"), job("failed")]
    expect(activeJobCount(jobs)).toBe(2)
  })

  it("detects presence of terminal jobs", () => {
    expect(hasTerminalJob([job("synthesizing"), job("paused")])).toBe(false)
    expect(hasTerminalJob([job("synthesizing"), job("completed")])).toBe(true)
  })

  it("detects partial preview jobs", () => {
    expect(isPartialTtsJob({ ...job("completed"), settings: { partial: true } })).toBe(true)
    expect(isPartialTtsJob({ ...job("completed"), settings: { paragraphLimit: 3 } })).toBe(true)
    expect(isPartialTtsJob(job("completed"))).toBe(false)
  })

  it("uses only audio generation progress for segment-only jobs", () => {
    const segmentOnly = { ...job("completed"), progress: 1, settings: { segmentsOnly: true } }
    const audioJob = { ...job("synthesizing"), progress: 0.42 }

    expect(isSegmentOnlyTtsJob(segmentOnly)).toBe(true)
    expect(audioProgressForJob(segmentOnly)).toBe(0)
    expect(audioProgressForJob(audioJob)).toBe(0.42)
  })
})
