import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { eq } from "drizzle-orm"
import { describe, expect, it, afterEach } from "vitest"
import type { AppDatabase } from "../../src/main/db/client"
import * as schema from "../../src/main/db/schema"
import {
  assets,
  books,
  prosodyAnalyses,
  runtimeManifests,
  ttsEngines,
  ttsJobs,
  ttsSegments,
  voiceEngineBindings,
  voiceProfiles,
  voiceSamples
} from "../../src/main/db/schema"
import { AudiobookService } from "../../src/main/services/audiobook-service"
import { DEFAULT_TTS_ENGINE_ID, DEFAULT_VOICE_PROFILE_ID, TtsService } from "../../src/main/services/tts-service"
import { AUDIOBOOK_INTRO_CHAPTER_HREF } from "../../src/shared/audiobook-intro"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { force: true, recursive: true })
  }
})

describe("TtsService", () => {
  it("persists a chapter job, generated assets, segments, and audiobook manifest", async () => {
    const { audiobook, client, db, paths } = await createTestServices()
    try {
      await seedBook(db, paths)
      const tts = new TtsService(db, paths, audiobook)

      const queued = await tts.enqueueChapter({
        bookId: "book-audio",
        chapterHref: "chapter-1",
        engineId: DEFAULT_TTS_ENGINE_ID,
        voiceProfileId: DEFAULT_VOICE_PROFILE_ID,
        quality: "draft",
        useExpressiveNarration: false
      })

      expect(queued.status).toBe("queued")

      await tts.drainQueue()

      const [completed] = await tts.listJobs({ bookId: "book-audio" })
      expect(completed.status).toBe("completed")
      expect(completed.progress).toBe(1)

      const segmentRows = await db.query.ttsSegments.findMany()
      expect(segmentRows.length).toBeGreaterThan(0)
      expect(segmentRows.every((segment) => segment.status === "completed")).toBe(true)

      const chapterAsset = await db.query.assets.findFirst({
        where: (table, { eq }) => eq(table.kind, "audio_chapter")
      })
      expect(chapterAsset?.mimeType).toBe("audio/wav")
      expect((await readFile(chapterAsset?.path ?? "")).subarray(0, 4).toString()).toBe("RIFF")

      const partial = await audiobook.getExport("book-audio")
      expect(partial.chaptersReady).toBe(1)
      expect(partial.chaptersTotal).toBe(2)
      expect(partial.manifest?.chapters[0].audioAssetId).toBe(chapterAsset?.id)
      expect(partial.manifest?.chapters[0].chapterIndex).toBe(1)
      expect(partial.stale).toBe(true)

      const rebuilt = await audiobook.rebuild("book-audio")
      expect(rebuilt.status).toBe("partial")
      expect(rebuilt.draftAssetId).toBeTruthy()

      const cached = await tts.enqueueChapter({
        bookId: "book-audio",
        chapterHref: "chapter-1",
        engineId: DEFAULT_TTS_ENGINE_ID,
        voiceProfileId: DEFAULT_VOICE_PROFILE_ID,
        quality: "draft",
        useExpressiveNarration: false
      })
      expect(cached.status).toBe("completed")

      const expressive = await tts.enqueueChapter({
        bookId: "book-audio",
        chapterHref: "chapter-1",
        engineId: DEFAULT_TTS_ENGINE_ID,
        voiceProfileId: DEFAULT_VOICE_PROFILE_ID,
        quality: "draft",
        useExpressiveNarration: true
      })
      expect(expressive.status).toBe("queued")

      await tts.drainQueue()

      const allJobs = await tts.listJobs({ bookId: "book-audio" })
      const expressiveJob = allJobs.find((job) => job.id === expressive.id)
      expect(expressiveJob?.status).toBe("completed")
      expect(expressiveJob?.settings.prosodyAnalyzerId).toBe("llm-prosody-local")
      expect(expressiveJob?.settings.useExpressiveNarration).toBe(true)
      expect(expressiveJob?.settings.chapterAudioAssetId).not.toBe(completed.settings.chapterAudioAssetId)

      const prosodyRows = await db.query.prosodyAnalyses.findMany()
      expect(prosodyRows.length).toBeGreaterThan(0)

      await tts.clearChapterAudio({
        bookId: "book-audio",
        chapterHref: "chapter-1"
      })

      expect(await tts.listJobs({ bookId: "book-audio" })).toEqual([])
      expect(await db.query.ttsSegments.findMany()).toEqual([])
      expect(await db.query.prosodyAnalyses.findMany()).toEqual([])
      const clearedExport = await audiobook.getExport("book-audio")
      expect(clearedExport.chaptersReady).toBe(0)
      expect(clearedExport.stale).toBe(true)
    } finally {
      await client.close()
    }
  })

  it("synthesizes an installed neural engine through a registered sidecar manifest", async () => {
    const { audiobook, client, db, paths } = await createTestServices()
    try {
      await seedBook(db, paths)
      const tts = new TtsService(db, paths, audiobook)
      await tts.listJobs()

      const sidecarPath = path.join(paths.userData, "mock-tts-sidecar.cjs")
      await writeFile(
        sidecarPath,
        `
const fs = require("fs")
let input = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => { input += chunk })
process.stdin.on("end", () => {
  const request = JSON.parse(input)
  if (typeof request.voiceBinding?.settings?.voiceDesignPrompt !== "string") {
    throw new Error("expected Qwen VoiceDesign binding")
  }
  if (request.seed !== 2026) {
    throw new Error("expected fixed seed")
  }
  fs.mkdirSync(request.outputDirectory, { recursive: true })
  const segments = request.plan.segments.map((segment, index) => {
    const audioPath = require("path").join(request.outputDirectory, "segment-" + index + ".wav")
    fs.writeFileSync(audioPath, Buffer.from("segment-" + segment.segmentId))
    return { segmentId: segment.segmentId, segmentIndex: index, audioPath, mimeType: "audio/wav", durationMs: 250 }
  })
  const chapterPath = require("path").join(request.outputDirectory, "chapter.wav")
  fs.writeFileSync(chapterPath, Buffer.from("chapter-" + request.engineId))
  process.stdout.write("loading neural model...\\n")
  process.stdout.write(JSON.stringify({
    schemaVersion: "dreamreader-tts-sidecar-result/v1",
    segments,
    chapter: { audioPath: chapterPath, mimeType: "audio/wav", durationMs: 750 }
  }))
})
`
      )
      await db
        .update(ttsEngines)
        .set({
          installed: true,
          installPath: path.join(paths.modelsDir, "qwen3-tts-17b")
        })
        .where(eq(ttsEngines.id, "qwen3-tts-17b-mlx"))
      await db.insert(runtimeManifests).values({
        id: "runtime_test_qwen3_tts_mlx",
        adapterId: "qwen3-tts-mlx",
        runtime: "mlx",
        version: "test",
        executablePath: process.execPath,
        environmentJson: {
          args: [sidecarPath],
          timeoutMs: 10_000
        },
        capabilitiesJson: {
          protocol: "dreamreader-tts-sidecar/v1"
        }
      })

      const queued = await tts.enqueueChapter({
        bookId: "book-audio",
        chapterHref: "chapter-1",
        engineId: "qwen3-tts-17b-mlx",
        quality: "draft",
        seed: 2026,
        seedFixed: true,
        useExpressiveNarration: false,
        voiceProfileId: "voice_qwen3_design_ptbr_neutral"
      })
      expect(queued.status).toBe("queued")

      await tts.drainQueue()

      const completed = await tts.getJob(queued.id)
      expect(completed.status).toBe("completed")
      expect(completed.settings.chapterAudioAssetId).toBeTruthy()

      const segmentRows = await db.query.ttsSegments.findMany({
        where: (table, { eq }) => eq(table.jobId, queued.id)
      })
      expect(segmentRows.every((segment) => segment.status === "completed")).toBe(true)
      expect(segmentRows.every((segment) => Boolean(segment.audioAssetId))).toBe(true)
    } finally {
      await client.close()
    }
  })

  it("persists fragments from a streaming (NDJSON) sidecar as each one arrives", async () => {
    const { audiobook, client, db, paths } = await createTestServices()
    try {
      await seedBook(db, paths)
      const tts = new TtsService(db, paths, audiobook)
      await tts.listJobs()

      const sidecarPath = path.join(paths.userData, "mock-streaming-sidecar.cjs")
      await writeFile(
        sidecarPath,
        `
const fs = require("fs")
const path = require("path")
let input = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => { input += chunk })
process.stdin.on("end", () => {
  const request = JSON.parse(input)
  fs.mkdirSync(request.outputDirectory, { recursive: true })
  // Stream one NDJSON event per fragment, as the real Python sidecars now do.
  request.plan.segments.forEach((segment, index) => {
    const audioPath = path.join(request.outputDirectory, "segment-" + index + ".wav")
    fs.writeFileSync(audioPath, Buffer.from("segment-" + segment.segmentId))
    process.stdout.write(JSON.stringify({ type: "segment", segmentId: segment.segmentId, segmentIndex: index, audioPath, mimeType: "audio/wav", durationMs: 250 }) + "\\n")
  })
  const chapterPath = path.join(request.outputDirectory, "chapter.wav")
  fs.writeFileSync(chapterPath, Buffer.from("chapter-" + request.engineId))
  // Final result intentionally reports no segments: persistence must come from
  // the streamed events above, not from the final blob.
  process.stdout.write(JSON.stringify({ type: "result", schemaVersion: "dreamreader-tts-sidecar-result/v1", segments: [], chapter: { audioPath: chapterPath, mimeType: "audio/wav", durationMs: 750 } }) + "\\n")
})
`
      )
      await db
        .update(ttsEngines)
        .set({ installed: true, installPath: path.join(paths.modelsDir, "qwen3-tts-17b") })
        .where(eq(ttsEngines.id, "qwen3-tts-17b-mlx"))
      await db.insert(runtimeManifests).values({
        id: "runtime_test_streaming",
        adapterId: "qwen3-tts-mlx",
        runtime: "mlx",
        version: "test",
        executablePath: process.execPath,
        environmentJson: { args: [sidecarPath], timeoutMs: 10_000 },
        capabilitiesJson: { protocol: "dreamreader-tts-sidecar/v1" }
      })

      const queued = await tts.enqueueChapter({
        bookId: "book-audio",
        chapterHref: "chapter-1",
        engineId: "qwen3-tts-17b-mlx",
        quality: "draft",
        useExpressiveNarration: false,
        voiceProfileId: "voice_qwen3_design_ptbr_neutral"
      })
      await tts.drainQueue()

      const completed = await tts.getJob(queued.id)
      expect(completed.status).toBe("completed")
      expect(completed.settings.chapterAudioAssetId).toBeTruthy()

      const segments = await tts.listSegments(queued.id)
      expect(segments.length).toBeGreaterThan(0)
      expect(segments.every((segment) => segment.status === "completed")).toBe(true)
      expect(segments.every((segment) => Boolean(segment.audioAssetId))).toBe(true)
    } finally {
      await client.close()
    }
  })

  it("passes cloned reference audio and transcript to the Qwen Base sidecar", async () => {
    const { audiobook, client, db, paths } = await createTestServices()
    try {
      await seedBook(db, paths)
      const tts = new TtsService(db, paths, audiobook)
      await tts.listJobs()

      const referencePath = path.join(paths.voicesDir, "qwen-reference.wav")
      await mkdir(path.dirname(referencePath), { recursive: true })
      await writeFile(referencePath, Buffer.from("reference-audio"))
      await seedQwenReferenceVoice(db, referencePath)

      const sidecarPath = path.join(paths.userData, "mock-qwen-base-sidecar.cjs")
      await writeFile(
        sidecarPath,
        `
const fs = require("fs")
const path = require("path")
let input = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => { input += chunk })
process.stdin.on("end", () => {
  const request = JSON.parse(input)
  if (request.engineId !== "qwen3-tts-17b-base-mlx") {
    throw new Error("expected Qwen 1.7B Base engine")
  }
  if (request.referenceAudioPath !== ${JSON.stringify(referencePath)}) {
    throw new Error("missing Qwen reference audio")
  }
  if (request.referenceText !== "Amostra curta.") {
    throw new Error("missing Qwen reference transcript")
  }
  if (request.voiceBinding?.bindingKind !== "reference_audio") {
    throw new Error("expected reference voice binding")
  }
  fs.mkdirSync(request.outputDirectory, { recursive: true })
  const segments = request.plan.segments.map((segment, index) => {
    const audioPath = path.join(request.outputDirectory, "segment-" + index + ".wav")
    fs.writeFileSync(audioPath, Buffer.from("segment-" + segment.segmentId))
    return { segmentId: segment.segmentId, segmentIndex: index, audioPath, mimeType: "audio/wav", durationMs: 250 }
  })
  const chapterPath = path.join(request.outputDirectory, "chapter.wav")
  fs.writeFileSync(chapterPath, Buffer.from("chapter-" + request.engineId))
  process.stdout.write(JSON.stringify({
    schemaVersion: "dreamreader-tts-sidecar-result/v1",
    segments,
    chapter: { audioPath: chapterPath, mimeType: "audio/wav", durationMs: 750 }
  }))
})
`
      )
      await db
        .update(ttsEngines)
        .set({
          installed: true,
          installPath: path.join(paths.modelsDir, "qwen3-tts-17b-base")
        })
        .where(eq(ttsEngines.id, "qwen3-tts-17b-base-mlx"))
      await db.insert(runtimeManifests).values({
        id: "runtime_test_qwen3_tts_base_mlx",
        adapterId: "qwen3-tts-mlx",
        runtime: "mlx",
        version: "test",
        executablePath: process.execPath,
        environmentJson: {
          args: [sidecarPath],
          timeoutMs: 10_000
        },
        capabilitiesJson: {
          protocol: "dreamreader-tts-sidecar/v1"
        }
      })

      const queued = await tts.enqueueChapter({
        bookId: "book-audio",
        chapterHref: "chapter-1",
        engineId: "qwen3-tts-17b-base-mlx",
        quality: "draft",
        useExpressiveNarration: false,
        voiceProfileId: "voice_qwen_base_clone"
      })

      await tts.drainQueue()

      const completed = await tts.getJob(queued.id)
      expect(completed.status).toBe("completed")
      expect(completed.settings.chapterAudioAssetId).toBeTruthy()
    } finally {
      await client.close()
    }
  })

  it("clears terminal jobs and their cached audio without removing active jobs", async () => {
    const { audiobook, client, db, paths } = await createTestServices()
    try {
      await seedBook(db, paths)
      const tts = new TtsService(db, paths, audiobook)

      const completedQueueItem = await tts.enqueueChapter({
        bookId: "book-audio",
        chapterHref: "chapter-1",
        engineId: DEFAULT_TTS_ENGINE_ID,
        voiceProfileId: DEFAULT_VOICE_PROFILE_ID,
        quality: "draft",
        useExpressiveNarration: false
      })
      await tts.drainQueue()

      const completed = await tts.getJob(completedQueueItem.id)
      expect(completed.status).toBe("completed")
      const chapterAsset = await db.query.assets.findFirst({
        where: (table, { eq }) => eq(table.id, String(completed.settings.chapterAudioAssetId))
      })
      expect(chapterAsset?.path).toBeTruthy()
      await access(chapterAsset?.path ?? "")

      await db.insert(ttsJobs).values({
        id: "tts_job_active_test",
        bookId: "book-audio",
        chapterHref: "chapter-1",
        engineId: DEFAULT_TTS_ENGINE_ID,
        voiceProfileId: DEFAULT_VOICE_PROFILE_ID,
        status: "queued",
        progress: 0,
        settingsJson: {
          quality: "draft",
          useExpressiveNarration: true
        },
        resourcePolicyJson: {}
      })

      const result = await tts.clearTerminalJobs({ bookId: "book-audio" })
      expect(result).toMatchObject({ deleted: true, jobsDeleted: 1 })
      expect(result.assetsDeleted).toBeGreaterThan(0)
      await expect(access(chapterAsset?.path ?? "")).rejects.toThrow()

      const remainingJobs = await tts.listJobs({ bookId: "book-audio" })
      expect(remainingJobs.map((job) => job.id)).toEqual(["tts_job_active_test"])
      expect(remainingJobs[0]?.status).toBe("queued")
      expect((await audiobook.getExport("book-audio")).chaptersReady).toBe(0)
    } finally {
      await client.close()
    }
  })

  it("clears prosody caches for terminal jobs even when no segment rows were persisted", async () => {
    const { audiobook, client, db, paths } = await createTestServices()
    try {
      await seedBook(db, paths)
      const tts = new TtsService(db, paths, audiobook)
      await tts.listJobs()

      await db.insert(ttsJobs).values({
        id: "tts_job_failed_before_segments",
        bookId: "book-audio",
        chapterHref: "chapter-1",
        engineId: DEFAULT_TTS_ENGINE_ID,
        voiceProfileId: DEFAULT_VOICE_PROFILE_ID,
        status: "failed",
        progress: 1,
        settingsJson: {
          quality: "draft",
          useExpressiveNarration: true
        },
        resourcePolicyJson: {}
      })
      await db.insert(prosodyAnalyses).values({
        id: "prosody_orphan_candidate",
        bookId: "book-audio",
        chapterHref: "chapter-1",
        segmentId: "chapter-1-p0",
        segmentHash: "prosody-orphan-hash",
        analyzerId: "llm-prosody-local",
        analyzerVersion: "1.0.0",
        promptVersion: "prosody-json-v1",
        status: "completed",
        voiceRole: "narrator",
        prosodyJson: {
          emotion: "neutral",
          intensity: 0.3,
          pace: "normal",
          pitch: "mid",
          pauseAfterMs: 120,
          instructionPtBr: "Narração neutra."
        },
        rawResponseJson: {}
      })

      expect(await db.query.prosodyAnalyses.findMany()).toHaveLength(1)

      const result = await tts.clearTerminalJobs({ bookId: "book-audio" })
      expect(result).toMatchObject({ deleted: true, jobsDeleted: 1 })
      expect(await tts.listJobs({ bookId: "book-audio" })).toEqual([])
      expect(await db.query.prosodyAnalyses.findMany()).toEqual([])
    } finally {
      await client.close()
    }
  })

  it("does not reuse cached audio from an older normalization version", async () => {
    const { audiobook, client, db, paths } = await createTestServices()
    try {
      await seedBook(db, paths)
      const tts = new TtsService(db, paths, audiobook)

      const first = await tts.enqueueChapter({
        bookId: "book-audio",
        chapterHref: "chapter-1",
        engineId: DEFAULT_TTS_ENGINE_ID,
        voiceProfileId: DEFAULT_VOICE_PROFILE_ID,
        quality: "draft",
        useExpressiveNarration: false
      })
      await tts.drainQueue()
      const completed = await tts.getJob(first.id)
      await db
        .update(ttsJobs)
        .set({
          settingsJson: {
            ...completed.settings,
            normalizationVersion: "1.0.0"
          }
        })
        .where(eq(ttsJobs.id, first.id))

      const queued = await tts.enqueueChapter({
        bookId: "book-audio",
        chapterHref: "chapter-1",
        engineId: DEFAULT_TTS_ENGINE_ID,
        voiceProfileId: DEFAULT_VOICE_PROFILE_ID,
        quality: "draft",
        useExpressiveNarration: false
      })

      expect(queued.status).toBe("queued")
      expect(queued.settings.cached).toBe(false)
      await tts.drainQueue()
    } finally {
      await client.close()
    }
  })

  it("does not reuse cached audio when model settings or fixed seed change", async () => {
    const { audiobook, client, db, paths } = await createTestServices()
    try {
      await seedBook(db, paths)
      const tts = new TtsService(db, paths, audiobook)

      const first = await tts.enqueueChapter({
        bookId: "book-audio",
        chapterHref: "chapter-1",
        engineId: DEFAULT_TTS_ENGINE_ID,
        voiceProfileId: DEFAULT_VOICE_PROFILE_ID,
        generationLanguage: "Portuguese",
        modelSettings: { temperature: 0.9 },
        quality: "draft",
        seed: 1234,
        seedFixed: true,
        useExpressiveNarration: false
      })
      await tts.drainQueue()
      const firstCompleted = await tts.getJob(first.id)
      expect(firstCompleted.status).toBe("completed")
      expect(firstCompleted.settings.chapterAudioHash).toBeTruthy()

      const changedTemperature = await tts.enqueueChapter({
        bookId: "book-audio",
        chapterHref: "chapter-1",
        engineId: DEFAULT_TTS_ENGINE_ID,
        voiceProfileId: DEFAULT_VOICE_PROFILE_ID,
        generationLanguage: "Portuguese",
        modelSettings: { temperature: 0.7 },
        quality: "draft",
        seed: 1234,
        seedFixed: true,
        useExpressiveNarration: false
      })

      expect(changedTemperature.status).toBe("queued")
      expect(changedTemperature.settings.cached).toBe(false)
      await tts.drainQueue()

      const changedSeed = await tts.enqueueChapter({
        bookId: "book-audio",
        chapterHref: "chapter-1",
        engineId: DEFAULT_TTS_ENGINE_ID,
        voiceProfileId: DEFAULT_VOICE_PROFILE_ID,
        generationLanguage: "Portuguese",
        modelSettings: { temperature: 0.7 },
        quality: "draft",
        seed: 4321,
        seedFixed: true,
        useExpressiveNarration: false
      })

      expect(changedSeed.status).toBe("queued")
      expect(changedSeed.settings.cached).toBe(false)
      await tts.drainQueue()
      const changedSeedCompleted = await tts.getJob(changedSeed.id)
      expect(changedSeedCompleted.settings.chapterAudioHash).toBeTruthy()
      expect(changedSeedCompleted.settings.chapterAudioHash).not.toBe(firstCompleted.settings.chapterAudioHash)
    } finally {
      await client.close()
    }
  })

  it("terminates a running neural sidecar when the job is cancelled", async () => {
    const { audiobook, client, db, paths } = await createTestServices()
    try {
      await seedBook(db, paths)
      const tts = new TtsService(db, paths, audiobook)
      await tts.listJobs()

      const sidecarPath = path.join(paths.userData, "mock-hanging-sidecar.cjs")
      const startedPath = path.join(paths.userData, "sidecar-started.txt")
      const killedPath = path.join(paths.userData, "sidecar-killed.txt")
      await writeFile(
        sidecarPath,
        `
const fs = require("fs")
const path = require("path")
let input = ""
process.on("SIGTERM", () => {
  fs.writeFileSync(${JSON.stringify(killedPath)}, "sigterm")
  process.exit(143)
})
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => { input += chunk })
process.stdin.on("end", () => {
  const request = JSON.parse(input)
  fs.mkdirSync(request.outputDirectory, { recursive: true })
  fs.writeFileSync(path.join(request.outputDirectory, "partial.wav"), Buffer.from("partial"))
  fs.writeFileSync(${JSON.stringify(startedPath)}, "started")
})
setInterval(() => {}, 1000)
`
      )
      await db
        .update(ttsEngines)
        .set({
          installed: true,
          installPath: path.join(paths.modelsDir, "qwen3-tts-17b")
        })
        .where(eq(ttsEngines.id, "qwen3-tts-17b-mlx"))
      await db.insert(runtimeManifests).values({
        id: "runtime_test_qwen3_tts_mlx_cancel",
        adapterId: "qwen3-tts-mlx",
        runtime: "mlx",
        version: "test",
        executablePath: process.execPath,
        environmentJson: {
          args: [sidecarPath],
          timeoutMs: 10_000
        },
        capabilitiesJson: {
          protocol: "dreamreader-tts-sidecar/v1"
        }
      })

      const queued = await tts.enqueueChapter({
        bookId: "book-audio",
        chapterHref: "chapter-1",
        engineId: "qwen3-tts-17b-mlx",
        quality: "draft",
        useExpressiveNarration: false,
        voiceProfileId: "voice_qwen3_design_ptbr_neutral"
      })

      const drain = tts.drainQueue()
      await waitForFile(startedPath)
      const outputDir = path.join(paths.audioCacheDir, "book-audio", "chapter-1", queued.id)
      await access(path.join(outputDir, "partial.wav"))
      await tts.cancelJob(queued.id)
      await waitForFile(killedPath)
      await drain

      expect(await readFile(killedPath, "utf8")).toBe("sigterm")
      expect((await tts.getJob(queued.id)).status).toBe("cancelled")
      await expect(access(outputDir)).rejects.toThrow()
    } finally {
      await client.close()
    }
  })

  it("generates a partial preview without marking the chapter ready in the audiobook", async () => {
    const { audiobook, client, db, paths } = await createTestServices()
    try {
      await seedBook(db, paths)
      const tts = new TtsService(db, paths, audiobook)

      const queued = await tts.enqueueChapter({
        bookId: "book-audio",
        chapterHref: "chapter-1",
        engineId: DEFAULT_TTS_ENGINE_ID,
        voiceProfileId: DEFAULT_VOICE_PROFILE_ID,
        quality: "draft",
        useExpressiveNarration: false,
        paragraphLimit: 3
      })
      await tts.drainQueue()

      const completed = await tts.getJob(queued.id)
      expect(completed.status).toBe("completed")
      expect(completed.settings.partial).toBe(true)
      expect(typeof completed.settings.chapterAudioAssetId).toBe("string")

      const segments = await tts.listSegments(queued.id)
      expect(segments).toHaveLength(3)
      expect(segments[0].audioAssetId).toBeTruthy()

      // Partial previews are test snippets and must not count toward the audiobook.
      const exportState = await audiobook.getExport("book-audio")
      expect(exportState.chaptersReady).toBe(0)
    } finally {
      await client.close()
    }
  })

  it("shows prosody segments for cached expressive partial previews", async () => {
    const { audiobook, client, db, paths } = await createTestServices()
    try {
      await seedBook(db, paths)
      const tts = new TtsService(db, paths, audiobook)

      const first = await tts.enqueueChapter({
        bookId: "book-audio",
        chapterHref: "chapter-1",
        engineId: DEFAULT_TTS_ENGINE_ID,
        voiceProfileId: DEFAULT_VOICE_PROFILE_ID,
        quality: "draft",
        useExpressiveNarration: true,
        paragraphLimit: 3
      })
      await tts.drainQueue()

      const firstSegments = await tts.listSegments(first.id)
      expect(firstSegments).toHaveLength(3)
      expect(firstSegments.every((segment) => segment.prosodyMode === "expressive")).toBe(true)
      expect(firstSegments.some((segment) => segment.prosody?.instructionPtBr)).toBe(true)

      const cached = await tts.enqueueChapter({
        bookId: "book-audio",
        chapterHref: "chapter-1",
        engineId: DEFAULT_TTS_ENGINE_ID,
        voiceProfileId: DEFAULT_VOICE_PROFILE_ID,
        quality: "draft",
        useExpressiveNarration: true,
        paragraphLimit: 3
      })

      expect(cached.status).toBe("completed")
      expect(cached.settings.cachedFromJobId).toBe(first.id)
      expect(await db.query.ttsSegments.findMany({ where: eq(ttsSegments.jobId, cached.id) })).toEqual([])

      const cachedSegments = await tts.listSegments(cached.id)
      expect(cachedSegments).toHaveLength(firstSegments.length)
      expect(cachedSegments.every((segment) => segment.jobId === cached.id)).toBe(true)
      expect(cachedSegments.map((segment) => segment.prosody)).toEqual(firstSegments.map((segment) => segment.prosody))

      const cachedAgain = await tts.enqueueChapter({
        bookId: "book-audio",
        chapterHref: "chapter-1",
        engineId: DEFAULT_TTS_ENGINE_ID,
        voiceProfileId: DEFAULT_VOICE_PROFILE_ID,
        quality: "draft",
        useExpressiveNarration: true,
        paragraphLimit: 3
      })

      expect(cachedAgain.status).toBe("completed")
      expect(cachedAgain.settings.cachedFromJobId).toBe(cached.id)
      const cachedAgainSegments = await tts.listSegments(cachedAgain.id)
      expect(cachedAgainSegments).toHaveLength(firstSegments.length)
      expect(cachedAgainSegments.every((segment) => segment.jobId === cachedAgain.id)).toBe(true)
      expect(cachedAgainSegments.map((segment) => segment.prosody)).toEqual(firstSegments.map((segment) => segment.prosody))
    } finally {
      await client.close()
    }
  })

  it("keeps a paused job out of the queue until it is resumed", async () => {
    const { audiobook, client, db, paths } = await createTestServices()
    try {
      await seedBook(db, paths)
      const tts = new TtsService(db, paths, audiobook)

      const queued = await tts.enqueueChapter({
        bookId: "book-audio",
        chapterHref: "chapter-1",
        engineId: DEFAULT_TTS_ENGINE_ID,
        voiceProfileId: DEFAULT_VOICE_PROFILE_ID,
        quality: "draft",
        useExpressiveNarration: false
      })

      const paused = await tts.pauseJob(queued.id)
      expect(paused.status).toBe("paused")

      await tts.drainQueue()
      expect((await tts.getJob(queued.id)).status).toBe("paused")

      const resumed = await tts.resumeJob(queued.id)
      expect(resumed.status).toBe("queued")

      await tts.drainQueue()
      expect((await tts.getJob(queued.id)).status).toBe("completed")
    } finally {
      await client.close()
    }
  })

  it("enqueues every chapter of a book in one batch call", async () => {
    const { audiobook, client, db, paths } = await createTestServices()
    try {
      await seedBook(db, paths)
      const tts = new TtsService(db, paths, audiobook)

      const jobs = await tts.enqueueChapters({
        bookId: "book-audio",
        engineId: DEFAULT_TTS_ENGINE_ID,
        voiceProfileId: DEFAULT_VOICE_PROFILE_ID,
        quality: "draft",
        useExpressiveNarration: false
      })
      expect(jobs).toHaveLength(2)
      expect(jobs.map((job) => job.chapterHref)).toEqual([AUDIOBOOK_INTRO_CHAPTER_HREF, "chapter-1"])

      await tts.drainQueue()
      const exportState = await audiobook.getExport("book-audio")
      expect(exportState.chaptersReady).toBe(2)
      expect(exportState.chaptersTotal).toBe(2)
      expect(exportState.manifest?.chapters.map((chapter) => chapter.chapterHref)).toEqual([
        AUDIOBOOK_INTRO_CHAPTER_HREF,
        "chapter-1"
      ])
      expect(exportState.manifest?.chapters.map((chapter) => chapter.chapterIndex)).toEqual([0, 1])
      expect(exportState.manifest?.chapters[0].title).toBe("Livro com Audio - DreamReader - 1968")
    } finally {
      await client.close()
    }
  })
})

async function createTestServices() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dreamreader-tts-"))
  tempDirs.push(tempDir)
  const client = new PGlite(path.join(tempDir, "db"))
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: path.resolve("drizzle") })
  const paths = {
    appRoot: tempDir,
    resourcesDir: tempDir,
    userData: tempDir,
    dbDir: path.join(tempDir, "db"),
    booksDir: path.join(tempDir, "library", "books"),
    coversDir: path.join(tempDir, "library", "covers"),
    extractedDir: path.join(tempDir, "library", "extracted"),
    audioCacheDir: path.join(tempDir, "audio-cache"),
    audiobooksDir: path.join(tempDir, "audiobooks"),
    voicesDir: path.join(tempDir, "voices"),
    modelsDir: path.join(tempDir, "models"),
    runtimeDir: path.join(tempDir, "runtimes"),
    pythonDir: path.join(tempDir, "runtimes", "python"),
    runtimeDownloadsDir: path.join(tempDir, "runtimes", "downloads"),
    runtimeCacheDir: path.join(tempDir, "runtime-cache"),
    huggingFaceDir: path.join(tempDir, "huggingface"),
    sidecarsDir: path.join(tempDir, "sidecars"),
    logsDir: path.join(tempDir, "logs"),
    backupsDir: path.join(tempDir, "backups")
  }

  return {
    audiobook: new AudiobookService(db, paths),
    client,
    db,
    paths
  }
}

async function seedBook(db: AppDatabase, paths: { booksDir: string }) {
  const libraryPath = path.join(paths.booksDir, "book-audio.txt")
  await mkdir(paths.booksDir, { recursive: true })
  await writeFile(libraryPath, "Capitulo 1")
  await db.insert(books).values({
    id: "book-audio",
    contentHash: "book-hash",
    fileType: "txt",
    title: "Livro com Audio",
    authors: ["DreamReader"],
    language: "pt-BR",
    publishedAt: "1968-01-01",
    libraryPath,
    manifestJson: {
      format: "txt",
      title: "Livro com Audio",
      authors: ["DreamReader"],
      language: "pt-BR",
      chapters: [
        {
          id: "chapter-1",
          href: "chapter-1",
          title: "Capitulo 1",
          content: "<article><p>Sr. João chegou às 14h30.</p><p>Custou R$ 25,90.</p><p>Ele sorriu antes de sair.</p></article>",
          mediaType: "text/html",
          progressionStart: 0,
          progressionEnd: 1
        }
      ],
      tableOfContents: [{ href: "chapter-1", title: "Capitulo 1" }]
    }
  })
}

async function seedQwenReferenceVoice(db: AppDatabase, referencePath: string) {
  const now = new Date()
  await db.insert(assets).values({
    id: "asset_qwen_reference",
    kind: "voice_sample",
    bookId: null,
    path: referencePath,
    mimeType: "audio/wav",
    contentHash: "qwen-reference-hash",
    sizeBytes: 15
  })
  await db.insert(voiceProfiles).values({
    id: "voice_qwen_base_clone",
    name: "Qwen Base Clone",
    description: "",
    language: "pt-BR",
    kind: "cloned",
    source: JSON.stringify({
      type: "reference_audio",
      sampleAssetId: "asset_qwen_reference"
    }),
    tags: ["pt-BR", "clonada"],
    settingsJson: {
      compatibleAdapterIds: ["qwen3-tts-mlx"],
      compatibleEngineIds: ["qwen3-tts-17b-base-mlx"]
    },
    consentConfirmedAt: now,
    consentNote: "Autorizado para teste local.",
    createdFromEngineId: "qwen3-tts-17b-base-mlx",
    updatedAt: now
  })
  await db.insert(voiceSamples).values({
    id: "voice_sample_qwen_reference",
    voiceProfileId: "voice_qwen_base_clone",
    assetId: "asset_qwen_reference",
    transcript: "Amostra curta.",
    language: "pt-BR",
    durationMs: 3_000,
    qualityJson: {},
    consentConfirmedAt: now
  })
  await db.insert(voiceEngineBindings).values({
    id: "voice_binding_qwen_base_clone",
    voiceProfileId: "voice_qwen_base_clone",
    engineId: "qwen3-tts-17b-base-mlx",
    adapterId: "qwen3-tts-mlx",
    status: "ready",
    bindingKind: "reference_audio",
    bindingAssetId: "asset_qwen_reference",
    settingsJson: {
      source: "local-reference",
      transcript: "Amostra curta."
    },
    compatibilityJson: {}
  })
}

async function waitForFile(filePath: string, timeoutMs = 3_000): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await access(filePath)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  throw new Error(`Timed out waiting for ${filePath}`)
}
