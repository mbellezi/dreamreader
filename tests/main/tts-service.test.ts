import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { eq } from "drizzle-orm"
import { describe, expect, it, afterEach } from "vitest"
import type { AppDatabase } from "../../src/main/db/client"
import * as schema from "../../src/main/db/schema"
import { books, runtimeManifests, ttsEngines } from "../../src/main/db/schema"
import { AudiobookService } from "../../src/main/services/audiobook-service"
import { DEFAULT_TTS_ENGINE_ID, DEFAULT_VOICE_PROFILE_ID, TtsService } from "../../src/main/services/tts-service"

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
      expect(partial.manifest?.chapters[0].audioAssetId).toBe(chapterAsset?.id)
      expect(partial.stale).toBe(true)

      const rebuilt = await audiobook.rebuild("book-audio")
      expect(rebuilt.status).toBe("complete")
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
  fs.mkdirSync(request.outputDirectory, { recursive: true })
  const segments = request.plan.segments.map((segment, index) => {
    const audioPath = require("path").join(request.outputDirectory, "segment-" + index + ".wav")
    fs.writeFileSync(audioPath, Buffer.from("segment-" + segment.segmentId))
    return { segmentId: segment.segmentId, segmentIndex: index, audioPath, mimeType: "audio/wav", durationMs: 250 }
  })
  const chapterPath = require("path").join(request.outputDirectory, "chapter.wav")
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
          installPath: path.join(paths.modelsDir, "qwen3-tts-06b")
        })
        .where(eq(ttsEngines.id, "qwen3-tts-06b-mlx"))
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
        engineId: "qwen3-tts-06b-mlx",
        quality: "draft",
        useExpressiveNarration: false
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
})

async function createTestServices() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dreamreader-tts-"))
  tempDirs.push(tempDir)
  const client = new PGlite(path.join(tempDir, "db"))
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: path.resolve("drizzle") })
  const paths = {
    userData: tempDir,
    dbDir: path.join(tempDir, "db"),
    booksDir: path.join(tempDir, "library", "books"),
    coversDir: path.join(tempDir, "library", "covers"),
    extractedDir: path.join(tempDir, "library", "extracted"),
    audioCacheDir: path.join(tempDir, "audio-cache"),
    audiobooksDir: path.join(tempDir, "audiobooks"),
    voicesDir: path.join(tempDir, "voices"),
    modelsDir: path.join(tempDir, "models"),
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
          content: "<article><p>Sr. João chegou às 14h30.</p><p>Custou R$ 25,90.</p></article>",
          mediaType: "text/html",
          progressionStart: 0,
          progressionEnd: 1
        }
      ],
      tableOfContents: [{ href: "chapter-1", title: "Capitulo 1" }]
    }
  })
}
