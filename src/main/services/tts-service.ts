import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { and, asc, eq, inArray } from "drizzle-orm"
import type { EnqueueChapterTtsRequest, NarrationPlan, TtsJob } from "@shared/contracts/ai"
import type { AppDatabase } from "@main/db/client"
import { assets, audiobookChapters, books, ttsEngines, ttsJobs, ttsSegments, voiceProfiles } from "@main/db/schema"
import { AppError } from "@main/lib/errors"
import { hashBuffer } from "@main/lib/hash"
import { createId } from "@main/lib/ids"
import type { AppPaths } from "@main/lib/paths"
import { LocalTtsAdapter } from "@main/services/local-tts-adapter"
import type { AudiobookService } from "@main/services/audiobook-service"
import { buildNarrationPlan, NARRATION_PLAN_VERSION } from "@main/services/tts-pipeline"

export const DEFAULT_TTS_ENGINE_ID = "dreamreader-local-tts"
export const DEFAULT_TTS_ADAPTER_ID = "dreamreader-local-wav"
export const DEFAULT_VOICE_PROFILE_ID = "voice_builtin_ptbr_neutral"

const activeStatuses = ["queued", "preparing", "analyzing", "synthesizing", "assembling", "updating_m4b"] as const
const terminalStatuses = ["completed", "failed", "cancelled"] as const

type ChapterSource = {
  chapterHref: string
  chapterIndex: number
  contentHash: string
  html: string
  language: string
  title: string
}

type TtsJobRow = typeof ttsJobs.$inferSelect

export class TtsService {
  private readonly adapter = new LocalTtsAdapter()
  private processing = false
  private queueTimer: NodeJS.Timeout | undefined
  private readyPromise: Promise<void> | undefined

  constructor(
    private readonly db: AppDatabase,
    private readonly paths: AppPaths,
    private readonly audiobook: AudiobookService
  ) {}

  async enqueueChapter(input: EnqueueChapterTtsRequest): Promise<TtsJob> {
    await this.ensureReady()
    const engineId = input.engineId || DEFAULT_TTS_ENGINE_ID
    const voiceProfileId = input.voiceProfileId || DEFAULT_VOICE_PROFILE_ID
    const source = await this.getChapterSource(input.bookId, input.chapterHref)
    const cached = await this.findCachedChapter({
      bookId: input.bookId,
      chapterHref: input.chapterHref,
      contentHash: source.contentHash,
      engineId,
      voiceProfileId
    })
    const now = new Date()
    const [job] = await this.db
      .insert(ttsJobs)
      .values({
        id: createId("tts_job"),
        bookId: input.bookId,
        chapterHref: input.chapterHref,
        engineId,
        voiceProfileId,
        voiceBindingId: input.voiceBindingId,
        status: cached ? "completed" : "queued",
        progress: cached ? 1 : 0,
        settingsJson: {
          cached: Boolean(cached),
          quality: input.quality,
          useExpressiveNarration: input.useExpressiveNarration
        },
        narrationPlanVersion: cached ? NARRATION_PLAN_VERSION : undefined,
        resourcePolicyJson: {
          acceleratorPreference: "portable_local_first",
          exclusiveGpuJobs: false,
          engine: DEFAULT_TTS_ADAPTER_ID
        },
        startedAt: cached ? now : undefined,
        finishedAt: cached ? now : undefined,
        updatedAt: now
      })
      .returning()

    if (!cached) {
      this.scheduleQueue()
    }
    return toTtsJob(job)
  }

  async cancelJob(id: string): Promise<TtsJob> {
    await this.ensureReady()
    const job = await this.getJobRow(id)
    if (terminalStatuses.includes(job.status as (typeof terminalStatuses)[number])) {
      return toTtsJob(job)
    }
    const [updated] = await this.db
      .update(ttsJobs)
      .set({
        status: "cancelled",
        finishedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(ttsJobs.id, id))
      .returning()
    return toTtsJob(updated)
  }

  async retryJob(id: string): Promise<TtsJob> {
    await this.ensureReady()
    await this.getJobRow(id)
    await this.db.delete(ttsSegments).where(eq(ttsSegments.jobId, id))
    const [updated] = await this.db
      .update(ttsJobs)
      .set({
        status: "queued",
        progress: 0,
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        finishedAt: null,
        updatedAt: new Date()
      })
      .where(eq(ttsJobs.id, id))
      .returning()
    this.scheduleQueue()
    return toTtsJob(updated)
  }

  async getJob(id: string): Promise<TtsJob> {
    await this.ensureReady()
    return toTtsJob(await this.getJobRow(id))
  }

  async listJobs(filter: { bookId?: string; engineId?: string } = {}): Promise<TtsJob[]> {
    await this.ensureReady()
    const rows = await this.db.query.ttsJobs.findMany({
      orderBy: [asc(ttsJobs.createdAt)]
    })
    return rows
      .filter((job) => {
        if (filter.bookId && job.bookId !== filter.bookId) return false
        if (filter.engineId && job.engineId !== filter.engineId) return false
        return true
      })
      .map(toTtsJob)
  }

  async resumePendingJobs(): Promise<void> {
    await this.ensureReady()
    await this.db
      .update(ttsJobs)
      .set({
        status: "queued",
        updatedAt: new Date()
      })
      .where(inArray(ttsJobs.status, ["preparing", "analyzing", "synthesizing", "assembling", "updating_m4b"]))
    this.scheduleQueue()
  }

  async drainQueue(): Promise<void> {
    await this.ensureReady()
    await this.processQueue()
  }

  private scheduleQueue(): void {
    if (this.queueTimer) {
      return
    }
    this.queueTimer = setTimeout(() => {
      this.queueTimer = undefined
      void this.processQueue()
    }, 0)
    this.queueTimer.unref?.()
  }

  private async processQueue(): Promise<void> {
    if (this.processing) {
      return
    }
    this.processing = true
    try {
      while (true) {
        const job = await this.nextQueuedJob()
        if (!job) {
          break
        }
        await this.processJob(job)
      }
    } finally {
      this.processing = false
      this.adapter.scheduleDispose()
    }
  }

  private async processJob(job: TtsJobRow): Promise<void> {
    try {
      await this.updateJob(job.id, { status: "preparing", startedAt: job.startedAt ?? new Date(), progress: 0.04 })
      await this.throwIfCancelled(job.id)
      const source = await this.getChapterSource(job.bookId, job.chapterHref)
      const cached = await this.findCachedChapter({
        bookId: job.bookId,
        chapterHref: job.chapterHref,
        contentHash: source.contentHash,
        engineId: job.engineId,
        voiceProfileId: job.voiceProfileId ?? undefined
      })
      if (cached) {
        await this.updateJob(job.id, {
          status: "completed",
          progress: 1,
          settingsJson: { ...jsonObject(job.settingsJson), cached: true },
          narrationPlanVersion: NARRATION_PLAN_VERSION,
          finishedAt: new Date()
        })
        return
      }

      await this.updateJob(job.id, { status: "analyzing", progress: 0.12 })
      const plan = buildNarrationPlan({
        bookId: job.bookId,
        chapterHref: job.chapterHref,
        contentHash: source.contentHash,
        html: source.html,
        language: source.language
      })
      await this.persistSegments(job.id, plan)
      await this.updateJob(job.id, {
        narrationPlanVersion: plan.schemaVersion,
        status: "synthesizing",
        progress: 0.18
      })

      await this.adapter.warmup()
      const outputDir = path.join(this.paths.audioCacheDir, job.bookId, sanitizePathPart(job.chapterHref), job.id)
      await mkdir(outputDir, { recursive: true })
      const totalSegments = plan.segments.length
      for (const [index, segment] of plan.segments.entries()) {
        await this.throwIfCancelled(job.id)
        const audio = this.adapter.synthesizeSegment(segment)
        const filePath = path.join(outputDir, `${String(index).padStart(4, "0")}-${hashBuffer(segment.segmentId).slice(0, 10)}.wav`)
        await writeFile(filePath, audio.buffer)
        const [asset] = await this.db
          .insert(assets)
          .values({
            id: createId("asset"),
            kind: "audio_segment",
            bookId: job.bookId,
            path: filePath,
            mimeType: audio.mimeType,
            contentHash: audio.contentHash,
            sizeBytes: audio.buffer.byteLength
          })
          .returning()
        await this.db
          .update(ttsSegments)
          .set({
            audioAssetId: asset.id,
            durationMs: audio.durationMs,
            status: "completed",
            updatedAt: new Date()
          })
          .where(and(eq(ttsSegments.jobId, job.id), eq(ttsSegments.segmentIndex, index)))
        await this.updateJob(job.id, {
          progress: 0.18 + ((index + 1) / Math.max(totalSegments, 1)) * 0.62
        })
      }

      await this.throwIfCancelled(job.id)
      await this.updateJob(job.id, { status: "assembling", progress: 0.86 })
      const chapterAudio = this.adapter.synthesizeChapter(plan)
      const chapterFileName = `${source.contentHash.slice(0, 16)}-${job.engineId}-${job.voiceProfileId ?? "default"}.wav`
      const chapterPath = path.join(this.paths.audioCacheDir, job.bookId, chapterFileName)
      await mkdir(path.dirname(chapterPath), { recursive: true })
      await writeFile(chapterPath, chapterAudio.buffer)
      const [chapterAsset] = await this.db
        .insert(assets)
        .values({
          id: createId("asset"),
          kind: "audio_chapter",
          bookId: job.bookId,
          path: chapterPath,
          mimeType: chapterAudio.mimeType,
          contentHash: chapterAudio.contentHash,
          sizeBytes: chapterAudio.buffer.byteLength
        })
        .returning()

      await this.updateJob(job.id, { status: "updating_m4b", progress: 0.94 })
      await this.audiobook.recordChapterAudio({
        audioAssetId: chapterAsset.id,
        audioHash: chapterAudio.contentHash,
        bookId: job.bookId,
        chapterHref: job.chapterHref,
        chapterIndex: source.chapterIndex,
        contentHash: source.contentHash,
        durationMs: chapterAudio.durationMs,
        engineId: job.engineId,
        title: source.title,
        voiceBindingId: job.voiceBindingId ?? undefined,
        voiceProfileId: job.voiceProfileId ?? undefined
      })

      await this.updateJob(job.id, {
        status: "completed",
        progress: 1,
        finishedAt: new Date()
      })
    } catch (error) {
      if (error instanceof AppError && error.code === "tts_job_cancelled") {
        await this.updateJob(job.id, {
          status: "cancelled",
          finishedAt: new Date()
        })
        return
      }
      const message = error instanceof Error ? error.message : "TTS job failed"
      await this.updateJob(job.id, {
        status: "failed",
        progress: 1,
        errorCode: "tts_job_failed",
        errorMessage: message,
        finishedAt: new Date()
      })
    }
  }

  private async persistSegments(jobId: string, plan: NarrationPlan): Promise<void> {
    await this.db.delete(ttsSegments).where(eq(ttsSegments.jobId, jobId))
    for (const [index, segment] of plan.segments.entries()) {
      await this.db.insert(ttsSegments).values({
        id: createId("tts_segment"),
        jobId,
        bookId: plan.source.bookId,
        chapterHref: plan.source.chapterHref,
        segmentIndex: index,
        segmentHash: hashBuffer(`${segment.segmentId}:${segment.normalizedText}`),
        locatorJson: segment.locator as Record<string, unknown>,
        originalText: segment.originalText,
        normalizedText: segment.normalizedText,
        prosodyJson: segment.prosody,
        adapterPayloadJson: {
          adapterId: DEFAULT_TTS_ADAPTER_ID,
          unsupportedProsodyFields: []
        },
        status: "queued"
      })
    }
  }

  private async ensureReady(): Promise<void> {
    this.readyPromise ??= this.ensureDefaults()
    await this.readyPromise
  }

  private async ensureDefaults(): Promise<void> {
    await mkdir(this.paths.audioCacheDir, { recursive: true })
    const now = new Date()
    const capabilities = {
      id: DEFAULT_TTS_ENGINE_ID,
      displayName: "DreamReader Local TTS",
      runtime: "cpu",
      modelFormat: "unknown",
      languages: ["pt-BR", "en"],
      supportsVoiceClone: false,
      supportsNaturalLanguageInstruction: false,
      supportsDiscreteEmotion: false,
      supportsBatch: true,
      supportsStreaming: false,
      supportsSegmentTimestamps: false,
      supportsSsmlLikeMarkup: false,
      preferredInputCase: "preserve",
      estimatedMemoryMb: 32
    }
    await this.db
      .insert(ttsEngines)
      .values({
        id: DEFAULT_TTS_ENGINE_ID,
        displayName: capabilities.displayName,
        version: "0.1.0",
        adapterId: DEFAULT_TTS_ADAPTER_ID,
        runtime: capabilities.runtime,
        modelFormat: capabilities.modelFormat,
        accelerator: "cpu",
        capabilitiesJson: capabilities,
        performanceProfileJson: {
          coldStartMs: 0,
          realtimeFactor: 0,
          mode: "deterministic-local-wav"
        },
        installed: true,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: ttsEngines.id,
        set: {
          displayName: capabilities.displayName,
          version: "0.1.0",
          adapterId: DEFAULT_TTS_ADAPTER_ID,
          runtime: capabilities.runtime,
          modelFormat: capabilities.modelFormat,
          accelerator: "cpu",
          capabilitiesJson: capabilities,
          installed: true,
          updatedAt: now
        }
      })

    await this.db
      .insert(voiceProfiles)
      .values({
        id: DEFAULT_VOICE_PROFILE_ID,
        name: "Narrador PT-BR neutro",
        description: "Voz neutra padrao para leitura em portugues brasileiro.",
        language: "pt-BR",
        kind: "built_in",
        source: "dreamreader:pt-br-neutral",
        tags: ["pt-BR", "narrador"],
        settingsJson: {
          compatibleEngineIds: [DEFAULT_TTS_ENGINE_ID],
          compatibleAdapterIds: [DEFAULT_TTS_ADAPTER_ID]
        },
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: voiceProfiles.id,
        set: {
          settingsJson: {
            compatibleEngineIds: [DEFAULT_TTS_ENGINE_ID],
            compatibleAdapterIds: [DEFAULT_TTS_ADAPTER_ID]
          },
          updatedAt: now
        }
      })
  }

  private async getChapterSource(bookId: string, chapterHref: string): Promise<ChapterSource> {
    const book = await this.db.query.books.findFirst({ where: eq(books.id, bookId) })
    if (!book) {
      throw new AppError("book_not_found", "Book not found")
    }
    const manifest = book.manifestJson as {
      chapters?: Array<{ href: string; id?: string; title?: string; content?: string }>
    }
    const chapters = manifest.chapters ?? []
    const chapterIndex = chapters.findIndex((item) => item.href === chapterHref || item.id === chapterHref)
    const chapter = chapterIndex >= 0 ? chapters[chapterIndex] : undefined
    if (!chapter?.content) {
      throw new AppError("resource_not_found", "Book chapter not found")
    }
    const chapterHash = hashBuffer(`${book.contentHash}:${chapter.href}:${chapter.content}`)
    return {
      chapterHref: chapter.href,
      chapterIndex,
      contentHash: chapterHash,
      html: chapter.content,
      language: book.language,
      title: chapter.title ?? `Capitulo ${chapterIndex + 1}`
    }
  }

  private async findCachedChapter(input: {
    bookId: string
    chapterHref: string
    contentHash: string
    engineId: string
    voiceProfileId?: string
  }) {
    const cached = await this.db.query.audiobookChapters.findFirst({
      where: and(eq(audiobookChapters.bookId, input.bookId), eq(audiobookChapters.chapterHref, input.chapterHref))
    })
    if (!cached) {
      return undefined
    }
    if (cached.contentHash !== input.contentHash || cached.engineId !== input.engineId) {
      return undefined
    }
    if ((cached.voiceProfileId ?? DEFAULT_VOICE_PROFILE_ID) !== (input.voiceProfileId ?? DEFAULT_VOICE_PROFILE_ID)) {
      return undefined
    }
    return cached
  }

  private async nextQueuedJob(): Promise<TtsJobRow | undefined> {
    return this.db.query.ttsJobs.findFirst({
      where: eq(ttsJobs.status, "queued"),
      orderBy: [asc(ttsJobs.createdAt)]
    })
  }

  private async getJobRow(id: string): Promise<TtsJobRow> {
    const job = await this.db.query.ttsJobs.findFirst({ where: eq(ttsJobs.id, id) })
    if (!job) {
      throw new AppError("tts_job_not_found", "TTS job not found")
    }
    return job
  }

  private async throwIfCancelled(jobId: string): Promise<void> {
    const job = await this.getJobRow(jobId)
    if (job.status === "cancelled") {
      throw new AppError("tts_job_cancelled", "TTS job was cancelled")
    }
  }

  private async updateJob(id: string, patch: Partial<typeof ttsJobs.$inferInsert>): Promise<TtsJobRow> {
    const [updated] = await this.db
      .update(ttsJobs)
      .set({
        ...patch,
        updatedAt: new Date()
      })
      .where(eq(ttsJobs.id, id))
      .returning()
    return updated
  }
}

function toTtsJob(row: TtsJobRow): TtsJob {
  return {
    id: row.id,
    bookId: row.bookId,
    chapterHref: row.chapterHref,
    engineId: row.engineId,
    voiceProfileId: optional(row.voiceProfileId),
    voiceBindingId: optional(row.voiceBindingId),
    status: normalizeJobStatus(row.status),
    progress: Math.min(Math.max(row.progress, 0), 1),
    settings: jsonObject(row.settingsJson) as TtsJob["settings"],
    narrationPlanVersion: optional(row.narrationPlanVersion),
    resourcePolicy: jsonObject(row.resourcePolicyJson) as TtsJob["resourcePolicy"],
    errorCode: optional(row.errorCode),
    errorMessage: optional(row.errorMessage),
    createdAt: toIso(row.createdAt),
    startedAt: optionalDate(row.startedAt),
    finishedAt: optionalDate(row.finishedAt),
    updatedAt: toIso(row.updatedAt)
  }
}

function normalizeJobStatus(status: string): TtsJob["status"] {
  if ([...activeStatuses, ...terminalStatuses, "building", "validating"].includes(status as never)) {
    return status as TtsJob["status"]
  }
  return "queued"
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function optional(value: string | null | undefined): string | undefined {
  return value || undefined
}

function optionalDate(value: Date | string | null | undefined): string | undefined {
  return value ? toIso(value) : undefined
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 96) || "chapter"
}
