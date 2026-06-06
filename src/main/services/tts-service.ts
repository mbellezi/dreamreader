import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { and, asc, eq, inArray } from "drizzle-orm"
import type { EnqueueChapterTtsRequest, NarrationPlan, TtsJob } from "@shared/contracts/ai"
import type { AppDatabase } from "@main/db/client"
import { assets, books, ttsEngines, ttsJobs, ttsSegments, voiceProfiles } from "@main/db/schema"
import { AppError } from "@main/lib/errors"
import { hashBuffer } from "@main/lib/hash"
import { createId } from "@main/lib/ids"
import type { AppPaths } from "@main/lib/paths"
import { LocalTtsAdapter } from "@main/services/local-tts-adapter"
import type { AudiobookService } from "@main/services/audiobook-service"
import { buildNarrationPlan, NARRATION_PLAN_VERSION } from "@main/services/tts-pipeline"
import { createDefaultProsodyAnalyzerProvider, ProsodyService, type ProsodyPlanResult } from "@main/services/prosody-service"

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

type TtsEngineDefinition = {
  accelerator: string
  adapterId: string
  capabilities: Record<string, unknown>
  displayName: string
  id: string
  installed: boolean
  modelFormat: string
  performanceProfile: Record<string, unknown>
  runtime: string
  version: string
}

const neuralTtsEngineDefinitions: TtsEngineDefinition[] = [
  {
    id: "qwen3-tts-06b-mlx",
    displayName: "Qwen3-TTS 12Hz 0.6B Base",
    version: "12Hz-0.6B-Base",
    adapterId: "qwen3-tts-mlx",
    runtime: "mlx",
    modelFormat: "mlx",
    accelerator: "apple_metal",
    installed: false,
    capabilities: {
      id: "qwen3-tts-06b-mlx",
      displayName: "Qwen3-TTS 12Hz 0.6B Base",
      runtime: "mlx",
      modelFormat: "mlx",
      languages: ["pt-BR", "en"],
      supportsVoiceClone: false,
      supportsNaturalLanguageInstruction: true,
      supportsDiscreteEmotion: true,
      supportsBatch: true,
      supportsStreaming: false,
      supportsSegmentTimestamps: true,
      supportsSsmlLikeMarkup: false,
      preferredInputCase: "preserve",
      estimatedMemoryMb: 3072
    },
    performanceProfile: {
      mode: "mlx-sidecar",
      requiresSidecar: true
    }
  },
  {
    id: "qwen3-tts-17b-mlx",
    displayName: "Qwen3-TTS 12Hz 1.7B CustomVoice",
    version: "12Hz-1.7B-CustomVoice",
    adapterId: "qwen3-tts-mlx",
    runtime: "mlx",
    modelFormat: "mlx",
    accelerator: "apple_metal",
    installed: false,
    capabilities: {
      id: "qwen3-tts-17b-mlx",
      displayName: "Qwen3-TTS 12Hz 1.7B CustomVoice",
      runtime: "mlx",
      modelFormat: "mlx",
      languages: ["pt-BR", "en"],
      supportsVoiceClone: true,
      supportsNaturalLanguageInstruction: true,
      supportsDiscreteEmotion: true,
      supportsBatch: true,
      supportsStreaming: false,
      supportsSegmentTimestamps: true,
      supportsSsmlLikeMarkup: false,
      preferredInputCase: "preserve",
      estimatedMemoryMb: 8192
    },
    performanceProfile: {
      mode: "mlx-sidecar",
      requiresSidecar: true
    }
  },
  {
    id: "f5-tts-pt-br",
    displayName: "F5-TTS PT-BR",
    version: "pt-br",
    adapterId: "f5-tts-pt-br",
    runtime: "pytorch",
    modelFormat: "safetensors",
    accelerator: process.platform === "darwin" && process.arch === "arm64" ? "apple_mps" : "cpu",
    installed: false,
    capabilities: {
      id: "f5-tts-pt-br",
      displayName: "F5-TTS PT-BR",
      runtime: "pytorch",
      modelFormat: "safetensors",
      languages: ["pt-BR"],
      supportsVoiceClone: true,
      supportsNaturalLanguageInstruction: true,
      supportsDiscreteEmotion: false,
      supportsBatch: true,
      supportsStreaming: false,
      supportsSegmentTimestamps: false,
      supportsSsmlLikeMarkup: false,
      preferredInputCase: "preserve",
      estimatedMemoryMb: 6144
    },
    performanceProfile: {
      mode: "python-pytorch-sidecar",
      requiresSidecar: true
    }
  }
]

export class TtsService {
  private readonly adapter = new LocalTtsAdapter()
  private readonly prosody: ProsodyService
  private processing = false
  private queueTimer: NodeJS.Timeout | undefined
  private readyPromise: Promise<void> | undefined

  constructor(
    private readonly db: AppDatabase,
    private readonly paths: AppPaths,
    private readonly audiobook: AudiobookService
  ) {
    this.prosody = new ProsodyService(db, createDefaultProsodyAnalyzerProvider(paths))
  }

  async enqueueChapter(input: EnqueueChapterTtsRequest): Promise<TtsJob> {
    await this.ensureReady()
    const engineId = input.engineId || DEFAULT_TTS_ENGINE_ID
    const voiceProfileId = input.voiceProfileId || DEFAULT_VOICE_PROFILE_ID
    const source = await this.getChapterSource(input.bookId, input.chapterHref)
    const cached = await this.findCachedJob({
      bookId: input.bookId,
      chapterHref: input.chapterHref,
      contentHash: source.contentHash,
      engineId,
      voiceProfileId,
      useExpressiveNarration: input.useExpressiveNarration
    })
    const now = new Date()
    const adapterId = adapterIdForEngine(engineId)
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
        settingsJson: compactJson({
          cached: Boolean(cached),
          cachedFromJobId: cached?.id,
          chapterAudioAssetId: cached?.chapterAudioAssetId,
          chapterDurationMs: cached?.chapterDurationMs,
          prosodyMode: input.useExpressiveNarration ? "expressive" : "neutral",
          quality: input.quality,
          sourceContentHash: source.contentHash,
          useExpressiveNarration: input.useExpressiveNarration
        }),
        narrationPlanVersion: cached ? NARRATION_PLAN_VERSION : undefined,
        resourcePolicyJson: {
          acceleratorPreference: "portable_local_first",
          exclusiveGpuJobs: false,
          engine: adapterId
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
      const jobSettings = jsonObject(job.settingsJson)
      const useExpressiveNarration = Boolean(jobSettings.useExpressiveNarration)
      const cached = await this.findCachedJob({
        bookId: job.bookId,
        chapterHref: job.chapterHref,
        contentHash: source.contentHash,
        engineId: job.engineId,
        excludeJobId: job.id,
        voiceProfileId: job.voiceProfileId ?? undefined,
        useExpressiveNarration
      })
      if (cached) {
        await this.updateJob(job.id, {
          status: "completed",
          progress: 1,
          settingsJson: compactJson({
            ...jobSettings,
            cached: true,
            cachedFromJobId: cached.id,
            chapterAudioAssetId: cached.chapterAudioAssetId,
            chapterDurationMs: cached.chapterDurationMs,
            sourceContentHash: source.contentHash
          }),
          narrationPlanVersion: NARRATION_PLAN_VERSION,
          finishedAt: new Date()
        })
        return
      }

      const adapterId = await this.assertEngineReady(job.engineId)
      await this.updateJob(job.id, { status: "analyzing", progress: 0.12 })
      const neutralPlan = buildNarrationPlan({
        bookId: job.bookId,
        chapterHref: job.chapterHref,
        contentHash: source.contentHash,
        html: source.html,
        language: source.language
      })
      const prosodyResult = await this.prosody.applyProsody(neutralPlan, useExpressiveNarration)
      const plan = prosodyResult.plan
      await this.persistSegments(job.id, plan, prosodyResult, adapterId)
      await this.updateJob(job.id, {
        narrationPlanVersion: plan.schemaVersion,
        settingsJson: compactJson({
          ...jobSettings,
          prosodyAnalyzerId: prosodyResult.analyzerId,
          prosodyCacheHits: prosodyResult.cacheHits,
          prosodyFallbackCount: prosodyResult.fallbackCount,
          prosodyGeneratedCount: prosodyResult.generatedCount,
          prosodyMode: useExpressiveNarration ? "expressive" : "neutral",
          prosodyPromptVersion: prosodyResult.promptVersion,
          sourceContentHash: source.contentHash
        }),
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
      const chapterCacheHash = chapterCacheHashFor(source.contentHash, job, plan, useExpressiveNarration)
      const chapterFileName = `${chapterCacheHash.slice(0, 16)}-${job.engineId}-${job.voiceProfileId ?? "default"}.wav`
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
        contentHash: chapterCacheHash,
        durationMs: chapterAudio.durationMs,
        engineId: job.engineId,
        title: source.title,
        voiceBindingId: job.voiceBindingId ?? undefined,
        voiceProfileId: job.voiceProfileId ?? undefined
      })

      await this.updateJob(job.id, {
        status: "completed",
        progress: 1,
        settingsJson: compactJson({
          ...jsonObject((await this.getJobRow(job.id)).settingsJson),
          chapterAudioAssetId: chapterAsset.id,
          chapterDurationMs: chapterAudio.durationMs,
          chapterAudioHash: chapterAudio.contentHash,
          chapterCacheHash
        }),
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

  private async persistSegments(
    jobId: string,
    plan: NarrationPlan,
    prosodyResult: ProsodyPlanResult,
    adapterId: string
  ): Promise<void> {
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
          adapterId,
          prosodyAnalyzerId: prosodyResult.analyzerId,
          prosodyMode: prosodyResult.promptVersion ? "expressive" : "neutral",
          prosodyPromptVersion: prosodyResult.promptVersion,
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

    for (const engine of neuralTtsEngineDefinitions) {
      await this.db
        .insert(ttsEngines)
        .values({
          id: engine.id,
          displayName: engine.displayName,
          version: engine.version,
          adapterId: engine.adapterId,
          runtime: engine.runtime,
          modelFormat: engine.modelFormat,
          accelerator: engine.accelerator,
          capabilitiesJson: engine.capabilities,
          performanceProfileJson: engine.performanceProfile,
          installed: engine.installed,
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: ttsEngines.id,
          set: {
            displayName: engine.displayName,
            version: engine.version,
            adapterId: engine.adapterId,
            runtime: engine.runtime,
            modelFormat: engine.modelFormat,
            accelerator: engine.accelerator,
            capabilitiesJson: engine.capabilities,
            performanceProfileJson: engine.performanceProfile,
            updatedAt: now
          }
        })
    }

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
          compatibleEngineIds: [DEFAULT_TTS_ENGINE_ID, ...neuralTtsEngineDefinitions.map((engine) => engine.id)],
          compatibleAdapterIds: [DEFAULT_TTS_ADAPTER_ID, "qwen3-tts-mlx", "f5-tts-pt-br"]
        },
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: voiceProfiles.id,
        set: {
          settingsJson: {
            compatibleEngineIds: [DEFAULT_TTS_ENGINE_ID, ...neuralTtsEngineDefinitions.map((engine) => engine.id)],
            compatibleAdapterIds: [DEFAULT_TTS_ADAPTER_ID, "qwen3-tts-mlx", "f5-tts-pt-br"]
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

  private async findCachedJob(input: {
    bookId: string
    chapterHref: string
    contentHash: string
    engineId: string
    excludeJobId?: string
    voiceProfileId?: string
    useExpressiveNarration: boolean
  }) {
    const candidates = await this.db.query.ttsJobs.findMany({
      where: and(eq(ttsJobs.bookId, input.bookId), eq(ttsJobs.chapterHref, input.chapterHref), eq(ttsJobs.status, "completed")),
      orderBy: [asc(ttsJobs.createdAt)]
    })
    const cached = candidates.reverse().find((job) => {
      if (job.id === input.excludeJobId || job.engineId !== input.engineId) {
        return false
      }
      if ((job.voiceProfileId ?? DEFAULT_VOICE_PROFILE_ID) !== (input.voiceProfileId ?? DEFAULT_VOICE_PROFILE_ID)) {
        return false
      }
      const settings = jsonObject(job.settingsJson)
      return (
        settings.sourceContentHash === input.contentHash &&
        settings.useExpressiveNarration === input.useExpressiveNarration &&
        typeof settings.chapterAudioAssetId === "string"
      )
    })

    if (!cached) {
      return undefined
    }
    const settings = jsonObject(cached.settingsJson)
    return {
      id: cached.id,
      chapterAudioAssetId: String(settings.chapterAudioAssetId),
      chapterDurationMs: typeof settings.chapterDurationMs === "number" ? settings.chapterDurationMs : undefined
    }
  }

  private async nextQueuedJob(): Promise<TtsJobRow | undefined> {
    return this.db.query.ttsJobs.findFirst({
      where: eq(ttsJobs.status, "queued"),
      orderBy: [asc(ttsJobs.createdAt)]
    })
  }

  private async assertEngineReady(engineId: string): Promise<string> {
    const adapterId = adapterIdForEngine(engineId)
    if (engineId === DEFAULT_TTS_ENGINE_ID) {
      return adapterId
    }

    const engine = await this.db.query.ttsEngines.findFirst({ where: eq(ttsEngines.id, engineId) })
    if (!engine || !engine.installed || !engine.installPath) {
      throw new AppError("tts_engine_not_configured", "TTS engine model is not installed")
    }

    throw new AppError("tts_sidecar_not_configured", "TTS engine sidecar runtime is not configured")
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

function compactJson<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

function chapterCacheHashFor(sourceContentHash: string, job: TtsJobRow, plan: NarrationPlan, expressive: boolean): string {
  return hashBuffer(
    [
      sourceContentHash,
      job.engineId,
      job.voiceProfileId ?? DEFAULT_VOICE_PROFILE_ID,
      job.voiceBindingId ?? "",
      expressive ? "expressive" : "neutral",
      plan.prosody.analyzerId,
      plan.prosody.version,
      plan.prosody.promptVersion ?? "",
      plan.normalization.normalizerId,
      plan.normalization.version,
      plan.normalization.dictionaryVersion
    ].join("\n")
  )
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

function adapterIdForEngine(engineId: string): string {
  if (engineId.startsWith("qwen3-tts-")) {
    return "qwen3-tts-mlx"
  }
  if (engineId === "f5-tts-pt-br") {
    return "f5-tts-pt-br"
  }
  return DEFAULT_TTS_ADAPTER_ID
}
