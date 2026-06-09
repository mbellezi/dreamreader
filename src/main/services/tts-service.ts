import { mkdir, rm, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { and, asc, eq, inArray } from "drizzle-orm"
import {
  NarrationProsodySchema,
  PronunciationEntrySchema,
  VoiceEngineBindingSchema,
  VoiceProfileSchema,
  VoiceSampleSchema,
  type EnqueueChapterTtsRequest,
  type EnqueueChaptersTtsRequest,
  type NarrationPlan,
  type PronunciationEntry,
  type TtsJob,
  type TtsModelSettings,
  type TtsSegmentSummary
} from "@shared/contracts/ai"
import type { AppDatabase } from "@main/db/client"
import {
  assets,
  books,
  pronunciationEntries,
  prosodyAnalyses,
  runtimeManifests,
  ttsEngines,
  ttsJobs,
  ttsSegments,
  voiceEngineBindings,
  voiceProfiles,
  voiceSamples
} from "@main/db/schema"
import { AppError } from "@main/lib/errors"
import { hashBuffer } from "@main/lib/hash"
import { createId } from "@main/lib/ids"
import type { AppPaths } from "@main/lib/paths"
import {
  builtInBindingIdFor,
  builtInBindingKindFor,
  builtInCompatibilityFor,
  builtInSettingsFor,
  builtInVoicePresets,
  DEFAULT_VOICE_PROFILE_ID
} from "@main/services/default-voices"
import { LocalTtsAdapter } from "@main/services/local-tts-adapter"
import { importSidecarAudio, SidecarTtsAdapter, type SidecarRuntimeManifest, type SidecarSegmentResult } from "@main/services/sidecar-tts-adapter"
import type { AudiobookService } from "@main/services/audiobook-service"
import { buildNarrationPlan, dictionaryVersionFor, NARRATION_PLAN_VERSION, NORMALIZER_VERSION } from "@main/services/tts-pipeline"
import { createDefaultProsodyAnalyzerProvider, ProsodyService, type ProsodyPlanResult } from "@main/services/prosody-service"

export const DEFAULT_TTS_ENGINE_ID = "dreamreader-local-tts"
export const DEFAULT_TTS_ADAPTER_ID = "dreamreader-local-wav"
export { DEFAULT_VOICE_PROFILE_ID } from "@main/services/default-voices"

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
type TtsEngineRow = typeof ttsEngines.$inferSelect
type EnqueueChapterTtsInput = Omit<EnqueueChapterTtsRequest, "modelSettings" | "seedFixed"> & {
  modelSettings?: TtsModelSettings
  seedFixed?: boolean
}
type EnqueueChaptersTtsInput = Omit<EnqueueChaptersTtsRequest, "modelSettings" | "seedFixed"> & {
  modelSettings?: TtsModelSettings
  seedFixed?: boolean
}

type ReadyEngine = {
  adapterId: string
  engine: TtsEngineRow
  modelPath?: string
  runtimeManifest?: SidecarRuntimeManifest
}

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
      supportsVoiceClone: true,
      supportsNaturalLanguageInstruction: false,
      supportsDiscreteEmotion: false,
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
    displayName: "Qwen3-TTS 12Hz 1.7B VoiceDesign",
    version: "12Hz-1.7B-VoiceDesign-4bit",
    adapterId: "qwen3-tts-mlx",
    runtime: "mlx",
    modelFormat: "mlx",
    accelerator: "apple_metal",
    installed: false,
    capabilities: {
      id: "qwen3-tts-17b-mlx",
      displayName: "Qwen3-TTS 12Hz 1.7B VoiceDesign",
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
      estimatedMemoryMb: 8192
    },
    performanceProfile: {
      mode: "mlx-sidecar",
      requiresSidecar: true
    }
  },
  {
    id: "qwen3-tts-17b-base-mlx",
    displayName: "Qwen3-TTS 12Hz 1.7B Base",
    version: "12Hz-1.7B-Base-4bit",
    adapterId: "qwen3-tts-mlx",
    runtime: "mlx",
    modelFormat: "mlx",
    accelerator: "apple_metal",
    installed: false,
    capabilities: {
      id: "qwen3-tts-17b-base-mlx",
      displayName: "Qwen3-TTS 12Hz 1.7B Base",
      runtime: "mlx",
      modelFormat: "mlx",
      languages: ["pt-BR", "en"],
      supportsVoiceClone: true,
      supportsNaturalLanguageInstruction: false,
      supportsDiscreteEmotion: false,
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
      supportsNaturalLanguageInstruction: false,
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
  private readonly sidecarAdapter = new SidecarTtsAdapter()
  private readonly sidecarAbortControllers = new Map<string, AbortController>()
  private readonly pausedJobIds = new Set<string>()
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

  async enqueueChapter(input: EnqueueChapterTtsInput): Promise<TtsJob> {
    await this.ensureReady()
    const engineId = input.engineId || DEFAULT_TTS_ENGINE_ID
    const voice = await this.resolveVoiceForEngine({
      engineId,
      voiceBindingId: input.voiceBindingId,
      voiceProfileId: input.voiceProfileId
    })
    const source = await this.getChapterSource(input.bookId, input.chapterHref)
    const pronunciation = await this.pronunciationEntriesForBook(input.bookId)
    const dictionaryVersion = dictionaryVersionFor(pronunciation)
    const modelSettings = jsonObject(input.modelSettings)
    const seed = input.seedFixed ? input.seed : undefined
    const generationConfigSignature = generationConfigSignatureFor({
      generationLanguage: input.generationLanguage,
      modelSettings,
      seed
    })
    const cached = await this.findCachedJob({
      bookId: input.bookId,
      chapterHref: input.chapterHref,
      contentHash: source.contentHash,
      dictionaryVersion,
      engineId,
      generationConfigSignature,
      voiceBindingId: voice.bindingId,
      voiceProfileId: voice.profileId,
      useExpressiveNarration: input.useExpressiveNarration,
      paragraphLimit: input.paragraphLimit
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
        voiceProfileId: voice.profileId,
        voiceBindingId: voice.bindingId,
        status: cached ? "completed" : "queued",
        progress: cached ? 1 : 0,
        settingsJson: compactJson({
          cached: Boolean(cached),
          cachedFromJobId: cached?.id,
          chapterAudioAssetId: cached?.chapterAudioAssetId,
          chapterDurationMs: cached?.chapterDurationMs,
          generationConfigSignature,
          generationLanguage: input.generationLanguage,
          modelSettings,
          prosodyMode: input.useExpressiveNarration ? "expressive" : "neutral",
          quality: input.quality,
          seed,
          seedFixed: input.seedFixed,
          normalizationDictionaryVersion: dictionaryVersion,
          normalizationVersion: NORMALIZER_VERSION,
          sourceContentHash: source.contentHash,
          useExpressiveNarration: input.useExpressiveNarration,
          paragraphLimit: input.paragraphLimit,
          partial: input.paragraphLimit ? true : undefined
        }),
        narrationPlanVersion: cached ? NARRATION_PLAN_VERSION : undefined,
        resourcePolicyJson: {
          acceleratorPreference: "portable_local_first",
          exclusiveGpuJobs: engineId !== DEFAULT_TTS_ENGINE_ID,
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

  async enqueueChapters(input: EnqueueChaptersTtsInput): Promise<TtsJob[]> {
    await this.ensureReady()
    const chapters = await this.getBookChapters(input.bookId)
    const selected = input.chapterHrefs?.length
      ? chapters.filter((chapter) => input.chapterHrefs?.includes(chapter.href))
      : chapters
    const jobs: TtsJob[] = []
    for (const chapter of selected) {
      jobs.push(
        await this.enqueueChapter({
          bookId: input.bookId,
          chapterHref: chapter.href,
          engineId: input.engineId,
          voiceProfileId: input.voiceProfileId,
          voiceBindingId: input.voiceBindingId,
          generationLanguage: input.generationLanguage,
          modelSettings: input.modelSettings,
          quality: input.quality,
          seed: input.seed,
          seedFixed: input.seedFixed,
          useExpressiveNarration: input.useExpressiveNarration
        })
      )
    }
    return jobs
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
    this.pausedJobIds.delete(id)
    this.sidecarAbortControllers.get(id)?.abort()
    if (!activeStatuses.includes(job.status as (typeof activeStatuses)[number])) {
      await this.cleanupTtsJobArtifacts([updated], { removeAudiobookChapters: "withChapterAudio" })
    }
    return toTtsJob(updated)
  }

  async pauseJob(id: string): Promise<TtsJob> {
    await this.ensureReady()
    const job = await this.getJobRow(id)
    if (terminalStatuses.includes(job.status as (typeof terminalStatuses)[number]) || job.status === "paused") {
      return toTtsJob(job)
    }
    // Cooperative pause: the synthesis loop checks this set between paragraphs
    // (real pause for the local adapter). Sidecars synthesize a whole chapter in
    // one call, so we abort the in-flight request and resume restarts it.
    this.pausedJobIds.add(id)
    this.sidecarAbortControllers.get(id)?.abort()
    const [updated] = await this.db
      .update(ttsJobs)
      .set({ status: "paused", updatedAt: new Date() })
      .where(eq(ttsJobs.id, id))
      .returning()
    return toTtsJob(updated)
  }

  async resumeJob(id: string): Promise<TtsJob> {
    await this.ensureReady()
    const job = await this.getJobRow(id)
    this.pausedJobIds.delete(id)
    if (job.status !== "paused") {
      return toTtsJob(job)
    }
    const [updated] = await this.db
      .update(ttsJobs)
      .set({ status: "queued", updatedAt: new Date() })
      .where(eq(ttsJobs.id, id))
      .returning()
    this.scheduleQueue()
    return toTtsJob(updated)
  }

  async listSegments(jobId: string): Promise<TtsSegmentSummary[]> {
    await this.ensureReady()
    const rows = await this.db.query.ttsSegments.findMany({
      where: eq(ttsSegments.jobId, jobId),
      orderBy: [asc(ttsSegments.segmentIndex)]
    })
    return rows.map((row) => {
      const prosody = NarrationProsodySchema.safeParse(row.prosodyJson)
      const rawMode = (row.adapterPayloadJson as { prosodyMode?: unknown }).prosodyMode
      const prosodyMode = rawMode === "expressive" || rawMode === "neutral" ? rawMode : undefined
      return {
        id: row.id,
        jobId: row.jobId,
        segmentIndex: row.segmentIndex,
        status: row.status,
        textPreview: row.originalText.slice(0, 160),
        audioAssetId: row.audioAssetId ?? undefined,
        durationMs: typeof row.durationMs === "number" ? row.durationMs : undefined,
        prosody: prosody.success ? prosody.data : undefined,
        prosodyMode
      }
    })
  }

  async retryJob(id: string): Promise<TtsJob> {
    await this.ensureReady()
    await this.getJobRow(id)
    this.pausedJobIds.delete(id)
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

  async clearChapterAudio(input: { bookId: string; chapterHref: string }) {
    await this.ensureReady()
    const jobs = await this.db.query.ttsJobs.findMany({
      where: and(eq(ttsJobs.bookId, input.bookId), eq(ttsJobs.chapterHref, input.chapterHref))
    })
    if (jobs.some((job) => !terminalStatuses.includes(job.status as (typeof terminalStatuses)[number]))) {
      throw new AppError("tts_job_active", "Cancel active TTS jobs before deleting chapter audio")
    }

    await this.deleteTtsJobRows(jobs, { removeAudiobookChapters: "all" })
    return { deleted: true as const }
  }

  async clearTerminalJobs(input: { bookId: string }) {
    await this.ensureReady()
    const jobs = await this.db.query.ttsJobs.findMany({
      where: eq(ttsJobs.bookId, input.bookId)
    })
    const terminalJobs = jobs.filter((job) => terminalStatuses.includes(job.status as (typeof terminalStatuses)[number]))
    const result = await this.deleteTtsJobRows(terminalJobs, { removeAudiobookChapters: "withChapterAudio" })
    return {
      deleted: true as const,
      jobsDeleted: result.jobsDeleted,
      assetsDeleted: result.assetsDeleted
    }
  }

  private async deleteTtsJobRows(
    jobs: TtsJobRow[],
    options: { removeAudiobookChapters: "all" | "withChapterAudio" }
  ): Promise<{ assetsDeleted: number; jobsDeleted: number }> {
    const cleanup = await this.cleanupTtsJobArtifacts(jobs, options)
    const jobIds = jobs.map((job) => job.id)
    if (jobIds.length) {
      await this.db.delete(ttsJobs).where(inArray(ttsJobs.id, jobIds))
    }
    return { assetsDeleted: cleanup.assetsDeleted, jobsDeleted: jobIds.length }
  }

  private async cleanupTtsJobArtifacts(
    jobs: TtsJobRow[],
    options: { removeAudiobookChapters: "all" | "withChapterAudio" }
  ): Promise<{ assetsDeleted: number }> {
    const assetIds = new Set<string>()
    const jobIds = jobs.map((job) => job.id)
    const chapterKeys = uniqueChapterKeys(
      options.removeAudiobookChapters === "all" ? jobs : jobs.filter((job) => hasChapterAudioAsset(job))
    )

    jobs.forEach((job) => {
      const chapterAudioAssetId = chapterAudioAssetIdFor(job)
      if (chapterAudioAssetId) {
        assetIds.add(chapterAudioAssetId)
      }
    })

    if (jobIds.length) {
      const segments = await this.db.query.ttsSegments.findMany({
        where: inArray(ttsSegments.jobId, jobIds)
      })
      segments.forEach((segment) => {
        if (segment.audioAssetId) {
          assetIds.add(segment.audioAssetId)
        }
      })
    }

    for (const chapter of chapterKeys) {
      const audiobookAssetIds = await this.audiobook.removeChapterAudio(chapter.bookId, chapter.chapterHref)
      audiobookAssetIds.forEach((assetId) => assetIds.add(assetId))
    }
    const assetRows = assetIds.size
      ? await this.db.query.assets.findMany({
          where: inArray(assets.id, [...assetIds])
        })
      : []

    if (jobIds.length) {
      await this.db.delete(ttsSegments).where(inArray(ttsSegments.jobId, jobIds))
    }
    await this.cleanupProsodyCacheForRemovedJobs(jobs)
    if (assetIds.size) {
      await this.db.delete(assets).where(inArray(assets.id, [...assetIds]))
    }
    await Promise.all([
      ...assetRows.map((asset) => unlink(asset.path).catch(() => undefined)),
      ...jobs.map((job) => rm(this.jobOutputDirectory(job), { force: true, recursive: true }).catch(() => undefined))
    ])
    return { assetsDeleted: assetRows.length }
  }

  private async cleanupProsodyCacheForRemovedJobs(jobs: TtsJobRow[]): Promise<void> {
    if (!jobs.length) {
      return
    }
    const removedJobIds = new Set(jobs.map((job) => job.id))
    for (const chapter of uniqueChapterKeys(jobs)) {
      const chapterJobs = await this.db.query.ttsJobs.findMany({
        where: and(eq(ttsJobs.bookId, chapter.bookId), eq(ttsJobs.chapterHref, chapter.chapterHref))
      })
      const hasRemainingChapterJob = chapterJobs.some((job) => !removedJobIds.has(job.id))
      if (hasRemainingChapterJob) {
        continue
      }
      await this.db
        .delete(prosodyAnalyses)
        .where(and(eq(prosodyAnalyses.bookId, chapter.bookId), eq(prosodyAnalyses.chapterHref, chapter.chapterHref)))
    }
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
      await this.throwIfInterrupted(job.id)
      const source = await this.getChapterSource(job.bookId, job.chapterHref)
      const jobSettings = jsonObject(job.settingsJson)
      const useExpressiveNarration = Boolean(jobSettings.useExpressiveNarration)
      const paragraphLimit = typeof jobSettings.paragraphLimit === "number" ? jobSettings.paragraphLimit : undefined
      const isPartial = Boolean(paragraphLimit)
      const generationConfigSignature =
        typeof jobSettings.generationConfigSignature === "string"
          ? jobSettings.generationConfigSignature
          : generationConfigSignatureFor({
              generationLanguage: optionalStringValue(jobSettings.generationLanguage),
              modelSettings: jsonObject(jobSettings.modelSettings),
              seed: typeof jobSettings.seed === "number" ? jobSettings.seed : undefined
            })
      const pronunciation = await this.pronunciationEntriesForBook(job.bookId)
      const dictionaryVersion = dictionaryVersionFor(pronunciation)
      const cached = await this.findCachedJob({
        bookId: job.bookId,
        chapterHref: job.chapterHref,
        contentHash: source.contentHash,
        dictionaryVersion,
        engineId: job.engineId,
        excludeJobId: job.id,
        generationConfigSignature,
        voiceBindingId: job.voiceBindingId ?? undefined,
        voiceProfileId: job.voiceProfileId ?? undefined,
        useExpressiveNarration,
        paragraphLimit
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
            normalizationDictionaryVersion: dictionaryVersion,
            normalizationVersion: NORMALIZER_VERSION,
            sourceContentHash: source.contentHash
          }),
          narrationPlanVersion: NARRATION_PLAN_VERSION,
          finishedAt: new Date()
        })
        return
      }

      const readyEngine = await this.assertEngineReady(job.engineId)
      await this.updateJob(job.id, { status: "analyzing", progress: 0.12 })
      const neutralPlan = buildNarrationPlan({
        bookId: job.bookId,
        chapterHref: job.chapterHref,
        contentHash: source.contentHash,
        html: source.html,
        language: source.language,
        pronunciationEntries: pronunciation,
        paragraphLimit
      })
      const prosodyResult = await this.prosody.applyProsody(neutralPlan, useExpressiveNarration)
      const plan = prosodyResult.plan
      // Preserve segment rows (and any already-synthesized paragraph audio) across
      // a pause/resume so resuming continues instead of restarting from scratch.
      const existingSegments = await this.db.query.ttsSegments.findMany({ where: eq(ttsSegments.jobId, job.id) })
      if (existingSegments.length !== plan.segments.length) {
        await this.persistSegments(job.id, plan, prosodyResult, readyEngine.adapterId)
      }
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
          normalizationDictionaryVersion: plan.normalization.dictionaryVersion,
          normalizationVersion: plan.normalization.version,
          sourceContentHash: source.contentHash
        }),
        status: "synthesizing",
        progress: 0.18
      })

      const outputDir = path.join(this.paths.audioCacheDir, job.bookId, sanitizePathPart(job.chapterHref), job.id)
      await mkdir(outputDir, { recursive: true })
      const synthesized = await this.synthesizeJobAudio({
        job,
        outputDir,
        plan,
        generationLanguage: optionalStringValue(jobSettings.generationLanguage),
        modelSettings: jsonObject(jobSettings.modelSettings) as TtsModelSettings,
        quality: qualityFor(jobSettings.quality),
        seed: typeof jobSettings.seed === "number" ? jobSettings.seed : undefined,
        readyEngine
      })

      await this.throwIfInterrupted(job.id)
      await this.updateJob(job.id, { status: "assembling", progress: 0.86 })
      const chapterCacheHash = chapterCacheHashFor(source.contentHash, job, plan, useExpressiveNarration)

      await this.updateJob(job.id, { status: "updating_m4b", progress: 0.94 })
      let audiobookError: string | undefined
      // Partial previews are test snippets and must not mark the chapter as ready
      // in the audiobook manifest.
      if (!isPartial) {
        try {
          await this.audiobook.recordChapterAudio({
            audioAssetId: synthesized.chapterAssetId,
            audioHash: synthesized.chapterAudioHash,
            bookId: job.bookId,
            chapterHref: job.chapterHref,
            chapterIndex: source.chapterIndex,
            contentHash: chapterCacheHash,
            durationMs: synthesized.chapterDurationMs,
            engineId: job.engineId,
            title: source.title,
            voiceBindingId: job.voiceBindingId ?? undefined,
            voiceProfileId: job.voiceProfileId ?? undefined
          })
        } catch (error) {
          audiobookError = error instanceof Error ? error.message : "Audiobook rebuild failed"
        }
      }

      await this.updateJob(job.id, {
        status: "completed",
        progress: 1,
        settingsJson: compactJson({
          ...jsonObject((await this.getJobRow(job.id)).settingsJson),
          audiobookError,
          chapterAudioAssetId: synthesized.chapterAssetId,
          chapterDurationMs: synthesized.chapterDurationMs,
          chapterAudioHash: synthesized.chapterAudioHash,
          chapterCacheHash
        }),
        finishedAt: new Date()
      })
      this.pausedJobIds.delete(job.id)
    } catch (error) {
      const current = await this.getJobRow(job.id).catch(() => job)
      const paused = this.pausedJobIds.has(job.id) || (error instanceof AppError && error.code === "tts_job_paused")
      if (paused) {
        // Keep partial artifacts (segments/assets) so resume can continue.
        if (current.status !== "paused") {
          await this.updateJob(job.id, { status: "paused" })
        }
        return
      }
      if (current.status === "cancelled" || (error instanceof AppError && error.code === "tts_job_cancelled")) {
        await this.cleanupTtsJobArtifacts([current], {
          removeAudiobookChapters: "withChapterAudio"
        })
        await this.updateJob(job.id, {
          status: "cancelled",
          finishedAt: new Date()
        })
        return
      }
      this.pausedJobIds.delete(job.id)
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

  private async synthesizeJobAudio(input: {
    job: TtsJobRow
    outputDir: string
    plan: NarrationPlan
    generationLanguage?: string
    modelSettings: TtsModelSettings
    quality: "draft" | "standard" | "high"
    seed?: number
    readyEngine: ReadyEngine
  }): Promise<{
    chapterAssetId: string
    chapterAudioHash: string
    chapterDurationMs: number
  }> {
    if (input.readyEngine.adapterId === DEFAULT_TTS_ADAPTER_ID) {
      return this.synthesizeWithLocalAdapter(input.job, input.plan)
    }
    return this.synthesizeWithSidecar(input)
  }

  private async synthesizeWithLocalAdapter(
    job: TtsJobRow,
    plan: NarrationPlan
  ): Promise<{
    chapterAssetId: string
    chapterAudioHash: string
    chapterDurationMs: number
  }> {
    await this.adapter.warmup()
    const outputDir = path.join(this.paths.audioCacheDir, job.bookId, sanitizePathPart(job.chapterHref), job.id)
    await mkdir(outputDir, { recursive: true })
    const totalSegments = plan.segments.length
    const doneSegments = new Set(
      (await this.db.query.ttsSegments.findMany({ where: eq(ttsSegments.jobId, job.id) }))
        .filter((row) => row.status === "completed" && row.audioAssetId)
        .map((row) => row.segmentIndex)
    )
    for (const [index, segment] of plan.segments.entries()) {
      await this.throwIfInterrupted(job.id)
      if (doneSegments.has(index)) {
        await this.updateJob(job.id, {
          progress: 0.18 + ((index + 1) / Math.max(totalSegments, 1)) * 0.62
        })
        continue
      }
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
      // The local adapter synthesizes instantly; pace each paragraph so the UI
      // can show segments streaming in one by one and the progress bar climbing.
      await sleep(localSegmentPacingMs(segment.normalizedText))
    }

    const chapterAudio = this.adapter.synthesizeChapter(plan)
    const chapterPath = path.join(
      this.paths.audioCacheDir,
      job.bookId,
      `${hashBuffer(`${job.id}:${chapterAudio.contentHash}`).slice(0, 16)}-${job.engineId}-${job.voiceProfileId ?? "default"}.wav`
    )
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

    return {
      chapterAssetId: chapterAsset.id,
      chapterAudioHash: chapterAudio.contentHash,
      chapterDurationMs: chapterAudio.durationMs
    }
  }

  private async synthesizeWithSidecar(input: {
    job: TtsJobRow
    outputDir: string
    plan: NarrationPlan
    generationLanguage?: string
    modelSettings: TtsModelSettings
    quality: "draft" | "standard" | "high"
    seed?: number
    readyEngine: ReadyEngine
  }): Promise<{
    chapterAssetId: string
    chapterAudioHash: string
    chapterDurationMs: number
  }> {
    if (!input.readyEngine.runtimeManifest || !input.readyEngine.modelPath) {
      throw new AppError("tts_sidecar_not_configured", "TTS engine sidecar runtime is not configured")
    }
    const voice = await this.voiceForJob(input.job)
    const reference = voice.binding?.bindingAssetId
      ? await this.referenceForBinding(voice.binding.bindingAssetId, voice.binding.settings)
      : undefined
    const controller = new AbortController()
    this.sidecarAbortControllers.set(input.job.id, controller)

    // Persist each paragraph as the sidecar streams it back so the UI shows
    // fragments and progress arriving one by one instead of all at once.
    const totalSegments = input.plan.segments.length
    const persistedIndexes = new Set<number>()
    let persistChain: Promise<void> = Promise.resolve()
    const persistSegment = async (sidecarSegment: SidecarSegmentResult): Promise<void> => {
      const index =
        typeof sidecarSegment.segmentIndex === "number"
          ? sidecarSegment.segmentIndex
          : input.plan.segments.findIndex((segment) => segment.segmentId === sidecarSegment.segmentId)
      if (index < 0 || persistedIndexes.has(index)) {
        return
      }
      persistedIndexes.add(index)
      const audio = await importSidecarAudio(sidecarSegment)
      const [asset] = await this.db
        .insert(assets)
        .values({
          id: createId("asset"),
          kind: "audio_segment",
          bookId: input.job.bookId,
          path: audio.audioPath,
          mimeType: audio.mimeType,
          contentHash: audio.contentHash,
          sizeBytes: audio.sizeBytes
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
        .where(and(eq(ttsSegments.jobId, input.job.id), eq(ttsSegments.segmentIndex, index)))
      await this.updateJob(input.job.id, {
        progress: 0.18 + (persistedIndexes.size / Math.max(totalSegments, 1)) * 0.62
      })
    }

    const result = await this.sidecarAdapter
      .synthesize({
        adapterId: input.readyEngine.adapterId,
        engineId: input.job.engineId,
        jobId: input.job.id,
        modelPath: input.readyEngine.modelPath,
        outputDirectory: input.outputDir,
        generationLanguage: input.generationLanguage,
        modelSettings: input.modelSettings,
        plan: input.plan,
        quality: input.quality,
        referenceAudioPath: reference?.audioPath,
        referenceText: reference?.text,
        runtimeManifest: input.readyEngine.runtimeManifest,
        seed: input.seed,
        signal: controller.signal,
        voiceBinding: voice.binding,
        voiceProfile: voice.profile,
        voiceSamples: voice.samples,
        onSegment: (sidecarSegment) => {
          persistChain = persistChain.then(() => persistSegment(sidecarSegment)).catch(() => undefined)
        }
      })
      .finally(() => {
        this.sidecarAbortControllers.delete(input.job.id)
      })

    await persistChain
    // Fallback for sidecars that do not stream events: persist whatever the
    // final result reported and was not already handled above.
    for (const sidecarSegment of result.segments) {
      await persistSegment(sidecarSegment)
    }

    const chapterAudio = await importSidecarAudio(result.chapter)
    const [chapterAsset] = await this.db
      .insert(assets)
      .values({
        id: createId("asset"),
        kind: "audio_chapter",
        bookId: input.job.bookId,
        path: chapterAudio.audioPath,
        mimeType: chapterAudio.mimeType,
        contentHash: chapterAudio.contentHash,
        sizeBytes: chapterAudio.sizeBytes
      })
      .returning()
    return {
      chapterAssetId: chapterAsset.id,
      chapterAudioHash: chapterAudio.contentHash,
      chapterDurationMs: chapterAudio.durationMs
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

    const engines = await this.db.query.ttsEngines.findMany()
    for (const preset of builtInVoicePresets) {
      await this.db
        .insert(voiceProfiles)
        .values({
          id: preset.id,
          name: preset.name,
          description: preset.description,
          language: preset.language,
          kind: "built_in",
          source: JSON.stringify(preset.source),
          tags: preset.tags,
          settingsJson: {
            ...preset.settings,
            compatibleEngineIds: preset.engineIds,
            compatibleAdapterIds: uniqueStrings(
              engines.filter((engine) => preset.engineIds.includes(engine.id)).map((engine) => engine.adapterId)
            )
          },
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: voiceProfiles.id,
          set: {
            name: preset.name,
            description: preset.description,
            language: preset.language,
            source: JSON.stringify(preset.source),
            tags: preset.tags,
            settingsJson: {
              ...preset.settings,
              compatibleEngineIds: preset.engineIds,
              compatibleAdapterIds: uniqueStrings(
                engines.filter((engine) => preset.engineIds.includes(engine.id)).map((engine) => engine.adapterId)
              )
            },
            updatedAt: now
          }
        })

      for (const engine of engines.filter((item) => preset.engineIds.includes(item.id))) {
        await this.db
          .insert(voiceEngineBindings)
          .values({
            id: builtInBindingIdFor(preset.id, engine.id),
            voiceProfileId: preset.id,
            engineId: engine.id,
            adapterId: engine.adapterId,
            status: "ready",
            bindingKind: builtInBindingKindFor(preset, engine.id),
            settingsJson: builtInSettingsFor(preset, engine.id),
            compatibilityJson: builtInCompatibilityFor(preset, engine.id),
            updatedAt: now
          })
          .onConflictDoUpdate({
            target: [voiceEngineBindings.voiceProfileId, voiceEngineBindings.engineId],
            set: {
              adapterId: engine.adapterId,
              status: "ready",
              bindingKind: builtInBindingKindFor(preset, engine.id),
              settingsJson: builtInSettingsFor(preset, engine.id),
              compatibilityJson: builtInCompatibilityFor(preset, engine.id),
              updatedAt: now
            }
          })
      }
    }

    await disableStaleBuiltInBindings(this.db, now)
  }

  private async getBookChapters(bookId: string): Promise<Array<{ href: string; index: number; title: string }>> {
    const book = await this.db.query.books.findFirst({ where: eq(books.id, bookId) })
    if (!book) {
      throw new AppError("book_not_found", "Book not found")
    }
    const manifest = book.manifestJson as {
      chapters?: Array<{ href: string; id?: string; title?: string; content?: string }>
    }
    const chapters = manifest.chapters ?? []
    return chapters
      .map((chapter, index) => ({
        href: chapter.href ?? chapter.id ?? `chapter-${index + 1}`,
        index,
        title: chapter.title ?? `Capitulo ${index + 1}`,
        hasContent: Boolean(chapter.content)
      }))
      .filter((chapter) => chapter.hasContent)
      .map(({ href, index, title }) => ({ href, index, title }))
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
    dictionaryVersion: string
    engineId: string
    excludeJobId?: string
    voiceBindingId?: string
    voiceProfileId?: string
    useExpressiveNarration: boolean
    paragraphLimit?: number
    generationConfigSignature: string
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
      if ((job.voiceBindingId ?? "") !== (input.voiceBindingId ?? "")) {
        return false
      }
      const settings = jsonObject(job.settingsJson)
      const cachedParagraphLimit = typeof settings.paragraphLimit === "number" ? settings.paragraphLimit : undefined
      return (
        settings.sourceContentHash === input.contentHash &&
        settings.normalizationDictionaryVersion === input.dictionaryVersion &&
        settings.normalizationVersion === NORMALIZER_VERSION &&
        settings.useExpressiveNarration === input.useExpressiveNarration &&
        settings.generationConfigSignature === input.generationConfigSignature &&
        cachedParagraphLimit === input.paragraphLimit &&
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

  private async assertEngineReady(engineId: string): Promise<ReadyEngine> {
    const adapterId = adapterIdForEngine(engineId)
    const engine = await this.db.query.ttsEngines.findFirst({ where: eq(ttsEngines.id, engineId) })
    if (!engine) {
      throw new AppError("tts_engine_not_found", "TTS engine not found")
    }
    if (engineId === DEFAULT_TTS_ENGINE_ID) {
      return { adapterId, engine }
    }

    if (!engine || !engine.installed || !engine.installPath) {
      throw new AppError("tts_engine_not_configured", "TTS engine model is not installed")
    }

    const runtimeManifest = await this.db.query.runtimeManifests.findFirst({
      where: and(eq(runtimeManifests.adapterId, engine.adapterId), eq(runtimeManifests.runtime, engine.runtime))
    })
    if (!runtimeManifest?.executablePath) {
      throw new AppError("tts_sidecar_not_configured", "TTS engine sidecar runtime is not configured")
    }
    return {
      adapterId,
      engine,
      modelPath: engine.installPath,
      runtimeManifest: {
        adapterId: runtimeManifest.adapterId,
        capabilitiesJson: runtimeManifest.capabilitiesJson,
        environmentJson: runtimeManifest.environmentJson,
        executablePath: runtimeManifest.executablePath,
        healthcheckCommand: runtimeManifest.healthcheckCommand,
        id: runtimeManifest.id,
        runtime: runtimeManifest.runtime,
        version: runtimeManifest.version
      }
    }
  }

  private async resolveVoiceForEngine(input: {
    engineId: string
    voiceBindingId?: string
    voiceProfileId?: string
  }): Promise<{ bindingId: string; profileId: string }> {
    const profileId = input.voiceProfileId || DEFAULT_VOICE_PROFILE_ID
    if (input.voiceBindingId) {
      const binding = await this.db.query.voiceEngineBindings.findFirst({
        where: eq(voiceEngineBindings.id, input.voiceBindingId)
      })
      if (!binding || binding.voiceProfileId !== profileId || binding.engineId !== input.engineId || binding.status !== "ready") {
        throw new AppError("voice_engine_incompatible", "Voice is not compatible with this engine")
      }
      return { bindingId: binding.id, profileId }
    }
    const binding = await this.db.query.voiceEngineBindings.findFirst({
      where: and(
        eq(voiceEngineBindings.voiceProfileId, profileId),
        eq(voiceEngineBindings.engineId, input.engineId),
        eq(voiceEngineBindings.status, "ready")
      )
    })
    if (!binding) {
      throw new AppError("voice_engine_incompatible", "Voice is not compatible with this engine")
    }
    return { bindingId: binding.id, profileId }
  }

  private async voiceForJob(job: TtsJobRow) {
    const profileId = job.voiceProfileId || DEFAULT_VOICE_PROFILE_ID
    const profile = await this.db.query.voiceProfiles.findFirst({ where: eq(voiceProfiles.id, profileId) })
    const binding = job.voiceBindingId
      ? await this.db.query.voiceEngineBindings.findFirst({ where: eq(voiceEngineBindings.id, job.voiceBindingId) })
      : await this.db.query.voiceEngineBindings.findFirst({
          where: and(
            eq(voiceEngineBindings.voiceProfileId, profileId),
            eq(voiceEngineBindings.engineId, job.engineId),
            eq(voiceEngineBindings.status, "ready")
          )
        })
    const samples = await this.db.query.voiceSamples.findMany({ where: eq(voiceSamples.voiceProfileId, profileId) })
    return {
      binding: binding
        ? VoiceEngineBindingSchema.parse({
            id: binding.id,
            voiceProfileId: binding.voiceProfileId,
            engineId: binding.engineId,
            adapterId: binding.adapterId,
            status: binding.status as "pending" | "ready" | "failed" | "disabled",
            bindingKind: binding.bindingKind as "reference_audio" | "speaker_embedding" | "preset" | "voice_design_prompt",
            bindingAssetId: binding.bindingAssetId ?? undefined,
            settings: binding.settingsJson,
            compatibility: binding.compatibilityJson,
            createdAt: toIso(binding.createdAt),
            updatedAt: toIso(binding.updatedAt)
          })
        : undefined,
      profile: profile
        ? VoiceProfileSchema.parse({
            id: profile.id,
            name: profile.name,
            description: profile.description || undefined,
            language: profile.language,
            kind: profile.kind as "built_in" | "cloned" | "imported" | "generated",
            source: parseJsonObject(profile.source),
            tags: profile.tags,
            settings: jsonObject(profile.settingsJson),
            consentConfirmedAt: optionalDate(profile.consentConfirmedAt),
            consentNote: profile.consentNote || undefined,
            previewAssetId: profile.previewAssetId || undefined,
            createdFromEngineId: profile.createdFromEngineId || undefined,
            createdAt: toIso(profile.createdAt),
            updatedAt: toIso(profile.updatedAt)
          })
        : undefined,
      samples: samples.map((sample) =>
        VoiceSampleSchema.parse({
          id: sample.id,
          voiceProfileId: sample.voiceProfileId,
          assetId: sample.assetId,
          transcript: sample.transcript ?? undefined,
          language: sample.language ?? undefined,
          durationMs: sample.durationMs,
          quality: sample.qualityJson,
          consentConfirmedAt: optionalDate(sample.consentConfirmedAt),
          createdAt: toIso(sample.createdAt)
        })
      )
    }
  }

  private async referenceForBinding(bindingAssetId: string, settings: Record<string, unknown>) {
    const asset = await this.db.query.assets.findFirst({ where: eq(assets.id, bindingAssetId) })
    if (!asset) {
      throw new AppError("voice_reference_missing", "Voice reference audio asset was not found")
    }
    return {
      audioPath: asset.path,
      text: typeof settings.transcript === "string" ? settings.transcript : undefined
    }
  }

  private jobOutputDirectory(job: TtsJobRow): string {
    return path.join(this.paths.audioCacheDir, job.bookId, sanitizePathPart(job.chapterHref), job.id)
  }

  private async pronunciationEntriesForBook(bookId: string): Promise<PronunciationEntry[]> {
    const rows = await this.db.query.pronunciationEntries.findMany({
      orderBy: [asc(pronunciationEntries.scope), asc(pronunciationEntries.pattern)]
    })
    return rows
      .filter((row) => row.scope === "global" || row.bookId === bookId)
      .map((row) =>
        PronunciationEntrySchema.parse({
          id: row.id,
          scope: row.scope,
          bookId: row.bookId ?? undefined,
          pattern: row.pattern,
          replacement: row.replacement,
          matchKind: row.matchKind,
          caseSensitive: row.caseSensitive,
          createdAt: toIso(row.createdAt),
          updatedAt: toIso(row.updatedAt)
        })
      )
  }

  private async getJobRow(id: string): Promise<TtsJobRow> {
    const job = await this.db.query.ttsJobs.findFirst({ where: eq(ttsJobs.id, id) })
    if (!job) {
      throw new AppError("tts_job_not_found", "TTS job not found")
    }
    return job
  }

  private async throwIfInterrupted(jobId: string): Promise<void> {
    const job = await this.getJobRow(jobId)
    if (job.status === "cancelled") {
      throw new AppError("tts_job_cancelled", "TTS job was cancelled")
    }
    if (this.pausedJobIds.has(jobId) || job.status === "paused") {
      throw new AppError("tts_job_paused", "TTS job was paused")
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
  if ([...activeStatuses, ...terminalStatuses, "building", "validating", "paused"].includes(status as never)) {
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

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    return jsonObject(parsed)
  } catch {
    return value ? { value } : {}
  }
}

function generationConfigSignatureFor(input: {
  generationLanguage?: string
  modelSettings: Record<string, unknown>
  seed?: number
}): string {
  return stableJsonString({
    generationLanguage: input.generationLanguage ?? "",
    modelSettings: input.modelSettings,
    seed: input.seed ?? null
  })
}

function chapterCacheHashFor(sourceContentHash: string, job: TtsJobRow, plan: NarrationPlan, expressive: boolean): string {
  const settings = jsonObject(job.settingsJson)
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
      plan.normalization.dictionaryVersion,
      typeof settings.generationConfigSignature === "string" ? settings.generationConfigSignature : ""
    ].join("\n")
  )
}

function optionalStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function uniqueChapterKeys(jobs: TtsJobRow[]): Array<{ bookId: string; chapterHref: string }> {
  const seen = new Set<string>()
  return jobs.flatMap((job) => {
    const key = `${job.bookId}\n${job.chapterHref}`
    if (seen.has(key)) {
      return []
    }
    seen.add(key)
    return [{ bookId: job.bookId, chapterHref: job.chapterHref }]
  })
}

function hasChapterAudioAsset(job: TtsJobRow): boolean {
  return Boolean(chapterAudioAssetIdFor(job))
}

function chapterAudioAssetIdFor(job: TtsJobRow): string | undefined {
  const settings = jsonObject(job.settingsJson)
  return typeof settings.chapterAudioAssetId === "string" ? settings.chapterAudioAssetId : undefined
}

async function disableStaleBuiltInBindings(db: AppDatabase, now: Date): Promise<void> {
  const allowed = new Set(
    builtInVoicePresets.flatMap((preset) => preset.engineIds.map((engineId) => `${preset.id}:${engineId}`))
  )
  const bindings = await db.query.voiceEngineBindings.findMany()
  for (const binding of bindings) {
    const compatibility = jsonObject(binding.compatibilityJson)
    if (compatibility.builtIn === true && !allowed.has(`${binding.voiceProfileId}:${binding.engineId}`)) {
      await db
        .update(voiceEngineBindings)
        .set({
          status: "disabled",
          updatedAt: now
        })
        .where(eq(voiceEngineBindings.id, binding.id))
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function localSegmentPacingMs(text: string): number {
  // Disabled under tests so the deterministic suite stays fast.
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return 0
  }
  // Roughly proportional to paragraph length, bounded so streaming stays visible
  // without making batch/whole-book generation feel slow.
  return Math.min(700, Math.max(150, Math.round(text.length * 4)))
}

function qualityFor(value: unknown): "draft" | "standard" | "high" {
  return value === "draft" || value === "high" ? value : "standard"
}

function stableJsonString(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonString(item)).join(",")}]`
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJsonString(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
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
