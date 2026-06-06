import type { EnqueueChapterTtsRequest, TtsJob } from "@shared/contracts/ai"
import { AppError } from "@main/lib/errors"
import { createId } from "@main/lib/ids"

export class TtsService {
  private readonly jobs = new Map<string, TtsJob>()

  enqueueChapter(input: EnqueueChapterTtsRequest): TtsJob {
    const now = new Date().toISOString()
    const job: TtsJob = {
      id: createId("tts_job"),
      bookId: input.bookId,
      chapterHref: input.chapterHref,
      engineId: input.engineId,
      voiceProfileId: input.voiceProfileId,
      voiceBindingId: input.voiceBindingId,
      status: "queued",
      progress: 0,
      settings: {
        useExpressiveNarration: input.useExpressiveNarration
      },
      resourcePolicy: {
        acceleratorPreference: "apple_silicon_first",
        exclusiveGpuJobs: true
      },
      createdAt: now,
      updatedAt: now
    }
    this.jobs.set(job.id, job)
    return job
  }

  cancelJob(id: string): TtsJob {
    const job = this.getJob(id)
    const now = new Date().toISOString()
    const updated: TtsJob = {
      ...job,
      status: "cancelled",
      finishedAt: now,
      updatedAt: now
    }
    this.jobs.set(id, updated)
    return updated
  }

  getJob(id: string): TtsJob {
    const job = this.jobs.get(id)
    if (!job) {
      throw new AppError("tts_job_not_found", "TTS job not found")
    }
    return job
  }

  listJobs(filter: { bookId?: string; engineId?: string } = {}): TtsJob[] {
    return [...this.jobs.values()].filter((job) => {
      if (filter.bookId && job.bookId !== filter.bookId) return false
      if (filter.engineId && job.engineId !== filter.engineId) return false
      return true
    })
  }
}
