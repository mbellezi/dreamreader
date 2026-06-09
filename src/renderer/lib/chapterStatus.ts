import { isPartialTtsJob, isTerminalJobStatus } from "@renderer/lib/jobQueue"
import type { AudiobookExport, TtsJob } from "@renderer/types"

export type ChapterAudioStatus = {
  kind: "ready" | "queued" | "generating" | "failed" | "none"
  durationMs?: number
  progress?: number
}

function latestJob(jobs: TtsJob[]): TtsJob | undefined {
  return [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
}

export function getChapterAudioStatus(
  chapterHref: string,
  audiobook: AudiobookExport | null | undefined,
  jobs: TtsJob[]
): ChapterAudioStatus {
  const chapterJobs = jobs.filter((job) => job.chapterHref === chapterHref)
  const activeJob = chapterJobs.find((job) => !isTerminalJobStatus(job.status) && job.status !== "paused")
  if (activeJob) {
    return activeJob.status === "queued"
      ? { kind: "queued", progress: activeJob.progress }
      : { kind: "generating", progress: activeJob.progress }
  }

  const chapterAudio = audiobook?.manifest?.chapters.find((item) => item.chapterHref === chapterHref)
  if (chapterAudio) {
    return { kind: "ready", durationMs: chapterAudio.durationMs }
  }

  const last = latestJob(chapterJobs.filter((job) => !isPartialTtsJob(job)))
  if (last?.status === "failed") {
    return { kind: "failed" }
  }
  if (last?.status === "paused") {
    return { kind: "queued", progress: last.progress }
  }

  return { kind: "none" }
}
