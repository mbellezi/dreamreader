import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { eq } from "drizzle-orm"
import { parseFile } from "music-metadata"
import { afterEach, describe, expect, it } from "vitest"
import type { AppDatabase } from "../../src/main/db/client"
import * as schema from "../../src/main/db/schema"
import { assets, audiobookBuildJobs, books, ttsEngines, ttsJobs } from "../../src/main/db/schema"
import { probeAudio, transcodeAudioToAac } from "../../src/main/lib/audio-transcode"
import { AudiobookService } from "../../src/main/services/audiobook-service"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { force: true, recursive: true })
  }
})

describe("AudiobookService.listLibraryStatus", () => {
  it("reports every book with chapter counts, audio flags, and active jobs", async () => {
    const { audiobook, db, paths } = await createTestServices()

    await seedBook(db, paths, "book-with-audio", "Livro com Áudio", 2)
    await seedBook(db, paths, "book-without-audio", "Livro sem Áudio", 3)

    await db.insert(ttsEngines).values({
      id: "dreamreader-local-tts",
      displayName: "DreamReader Local TTS",
      version: "0.1.0",
      adapterId: "dreamreader-local-wav",
      runtime: "cpu",
      modelFormat: "unknown",
      accelerator: "cpu",
      installed: true,
      updatedAt: new Date()
    })

    // book-with-audio has one ready chapter and one active job
    await db.insert(assets).values({
      id: "asset-1",
      kind: "audio_chapter",
      bookId: "book-with-audio",
      path: path.join(paths.audioCacheDir, "asset-1.wav"),
      mimeType: "audio/wav",
      contentHash: "audio-hash",
      sizeBytes: 1024
    })
    await audiobook.recordChapterAudio({
      audioAssetId: "asset-1",
      audioHash: "audio-hash",
      bookId: "book-with-audio",
      chapterHref: "chapter-1",
      chapterIndex: 0,
      contentHash: "content-hash",
      durationMs: 4200,
      engineId: "dreamreader-local-tts",
      title: "Capitulo 1"
    })
    await db.insert(ttsJobs).values({
      id: "job-active",
      bookId: "book-with-audio",
      chapterHref: "chapter-2",
      engineId: "dreamreader-local-tts",
      status: "synthesizing",
      progress: 0.5,
      updatedAt: new Date()
    })

    const status = await audiobook.listLibraryStatus()
    expect(status).toHaveLength(2)

    const withAudio = status.find((item) => item.bookId === "book-with-audio")
    expect(withAudio).toMatchObject({
      title: "Livro com Áudio",
      chaptersReady: 1,
      chaptersTotal: 3,
      hasChapterAudio: true,
      hasActiveJob: true
    })
    expect(withAudio?.durationMs).toBe(4200)

    const withoutAudio = status.find((item) => item.bookId === "book-without-audio")
    expect(withoutAudio).toMatchObject({
      title: "Livro sem Áudio",
      status: "none",
      chaptersReady: 0,
      chaptersTotal: 4,
      hasChapterAudio: false,
      hasActiveJob: false
    })
  })
})

describe("AudiobookService.rebuild", () => {
  it("builds a real M4B asset from ready chapter audio", async () => {
    const { audiobook, db, paths } = await createTestServices()

    await seedBook(db, paths, "book-with-audio", "Livro com Áudio", 1)
    expect(await audiobook.exportFileName("book-with-audio")).toBe("Livro com Áudio - DreamReader.m4b")
    const coverPath = path.join(paths.coversDir, "cover.png")
    await mkdir(path.dirname(coverPath), { recursive: true })
    await writeFile(coverPath, createTinyPng())
    await db.insert(assets).values({
      id: "cover-1",
      kind: "cover",
      bookId: "book-with-audio",
      path: coverPath,
      mimeType: "image/png",
      contentHash: "cover-hash",
      sizeBytes: (await readFile(coverPath)).byteLength
    })
    await db.update(books).set({ coverAssetId: "cover-1" }).where(eq(books.id, "book-with-audio"))
    await db.insert(ttsEngines).values({
      id: "dreamreader-local-tts",
      displayName: "DreamReader Local TTS",
      version: "0.1.0",
      adapterId: "dreamreader-local-wav",
      runtime: "cpu",
      modelFormat: "unknown",
      accelerator: "cpu",
      installed: true,
      updatedAt: new Date()
    })

    const wavPath = path.join(paths.audioCacheDir, "chapter-1.wav")
    const chapterPath = path.join(paths.audioCacheDir, "chapter-1.m4a")
    await mkdir(path.dirname(wavPath), { recursive: true })
    await writeFile(wavPath, createSilentWav(1_000, 22_050))
    const encodedChapter = await transcodeAudioToAac({
      srcPath: wavPath,
      destPath: chapterPath,
      durationMs: 1_000
    })
    await db.insert(assets).values({
      id: "asset-1",
      kind: "audio_chapter",
      bookId: "book-with-audio",
      path: chapterPath,
      mimeType: encodedChapter.mimeType,
      contentHash: encodedChapter.contentHash,
      sizeBytes: encodedChapter.sizeBytes
    })

    await audiobook.recordChapterAudio({
      audioAssetId: "asset-1",
      audioHash: encodedChapter.contentHash,
      bookId: "book-with-audio",
      chapterHref: "chapter-1",
      chapterIndex: 0,
      contentHash: "content-hash",
      durationMs: 1_000,
      engineId: "dreamreader-local-tts",
      title: "Capitulo 1"
    })

    const rebuilt = await audiobook.rebuild("book-with-audio")

    expect(rebuilt.status).toBe("partial")
    expect(rebuilt.assetId).toBeUndefined()
    expect(rebuilt.draftAssetId).toBeTruthy()

    const asset = await db.query.assets.findFirst({
      where: (table, { eq }) => eq(table.id, rebuilt.draftAssetId ?? "")
    })
    expect(asset).toMatchObject({
      kind: "audiobook_m4b",
      mimeType: "audio/mp4"
    })
    expect(asset?.path.endsWith(".m4b")).toBe(true)
    await expect(access(asset?.path ?? "")).resolves.toBeUndefined()
    expect((await readFile(asset?.path ?? "")).subarray(4, 8).toString()).toBe("ftyp")
    expect((await probeAudio(asset?.path ?? "")).durationMs).toBeGreaterThan(900)
    const metadata = await parseFile(asset?.path ?? "")
    expect(metadata.common.picture?.[0]?.format).toBe("image/jpeg")
    const exportRow = await db.query.audiobookExports.findFirst({
      where: (table, { eq }) => eq(table.bookId, "book-with-audio")
    })
    expect(exportRow?.metadataJson).toMatchObject({
      audioMode: "copy",
      encoder: "copy"
    })
    await expect(access(await audiobook.getExportFilePath("book-with-audio"))).resolves.toBeUndefined()

    const deleted = await audiobook.deleteExport("book-with-audio")
    expect(deleted).toMatchObject({
      assetId: undefined,
      draftAssetId: undefined,
      status: "none",
      chaptersReady: 1,
      stale: true
    })
    await expect(access(asset?.path ?? "")).rejects.toThrow()
    await expect(access(chapterPath)).resolves.toBeUndefined()
    expect(await db.query.assets.findFirst({ where: (table, { eq }) => eq(table.id, asset?.id ?? "") })).toBeUndefined()
    expect(await db.query.assets.findFirst({ where: (table, { eq }) => eq(table.id, "asset-1") })).toBeTruthy()
    expect(deleted.manifest?.chapters[0]?.audioAssetId).toBe("asset-1")
  })

  it("adds two seconds of silence between M4B chapters", async () => {
    const { audiobook, db, paths } = await createTestServices()

    await seedBook(db, paths, "book-with-gaps", "Livro com Intervalos", 2)
    await db.insert(ttsEngines).values({
      id: "dreamreader-local-tts",
      displayName: "DreamReader Local TTS",
      version: "0.1.0",
      adapterId: "dreamreader-local-wav",
      runtime: "cpu",
      modelFormat: "unknown",
      accelerator: "cpu",
      installed: true,
      updatedAt: new Date()
    })

    for (const index of [1, 2]) {
      const chapterPath = path.join(paths.audioCacheDir, `gap-chapter-${index}.wav`)
      await mkdir(path.dirname(chapterPath), { recursive: true })
      await writeFile(chapterPath, createSilentWav(1_000, 22_050))
      await db.insert(assets).values({
        id: `gap-asset-${index}`,
        kind: "audio_chapter",
        bookId: "book-with-gaps",
        path: chapterPath,
        mimeType: "audio/wav",
        contentHash: `gap-audio-hash-${index}`,
        sizeBytes: (await readFile(chapterPath)).byteLength
      })
      await audiobook.recordChapterAudio({
        audioAssetId: `gap-asset-${index}`,
        audioHash: `gap-audio-hash-${index}`,
        bookId: "book-with-gaps",
        chapterHref: `chapter-${index}`,
        chapterIndex: index,
        contentHash: `gap-content-hash-${index}`,
        durationMs: 1_000,
        engineId: "dreamreader-local-tts",
        title: `Capitulo ${index}`
      })
    }

    const withManifest = await audiobook.getExport("book-with-gaps")
    expect(withManifest.durationMs).toBe(4_000)
    expect(withManifest.manifest?.chapters.map((chapter) => [chapter.startMs, chapter.endMs])).toEqual([
      [0, 3_000],
      [3_000, 4_000]
    ])

    const rebuilt = await audiobook.rebuild("book-with-gaps")
    const asset = await db.query.assets.findFirst({
      where: (table, { eq }) => eq(table.id, rebuilt.draftAssetId ?? "")
    })
    expect(rebuilt.metadata).toMatchObject({
      audioMode: "encode",
      chapterGapMs: 2_000
    })
    expect((await probeAudio(asset?.path ?? "")).durationMs).toBeGreaterThan(3_800)
  })

  it("waits for active audio jobs before rebuilding automatic M4B", async () => {
    const { audiobook, db, paths } = await createTestServices()

    await seedBook(db, paths, "book-with-audio", "Livro com Áudio", 2)
    await db.insert(ttsEngines).values({
      id: "dreamreader-local-tts",
      displayName: "DreamReader Local TTS",
      version: "0.1.0",
      adapterId: "dreamreader-local-wav",
      runtime: "cpu",
      modelFormat: "unknown",
      accelerator: "cpu",
      installed: true,
      updatedAt: new Date()
    })
    await audiobook.setAutoBuild("book-with-audio", true)
    await db.insert(ttsJobs).values([
      {
        id: "job-1",
        bookId: "book-with-audio",
        chapterHref: "chapter-1",
        engineId: "dreamreader-local-tts",
        status: "updating_m4b",
        progress: 0.94,
        updatedAt: new Date()
      },
      {
        id: "job-2",
        bookId: "book-with-audio",
        chapterHref: "chapter-2",
        engineId: "dreamreader-local-tts",
        status: "queued",
        progress: 0,
        updatedAt: new Date()
      }
    ])

    for (const index of [1, 2]) {
      const chapterPath = path.join(paths.audioCacheDir, `chapter-${index}.wav`)
      await mkdir(path.dirname(chapterPath), { recursive: true })
      await writeFile(chapterPath, createSilentWav(1_000, 22_050))
      await db.insert(assets).values({
        id: `asset-${index}`,
        kind: "audio_chapter",
        bookId: "book-with-audio",
        path: chapterPath,
        mimeType: "audio/wav",
        contentHash: `audio-hash-${index}`,
        sizeBytes: (await readFile(chapterPath)).byteLength
      })
    }

    const first = await audiobook.recordChapterAudio({
      audioAssetId: "asset-1",
      audioHash: "audio-hash-1",
      bookId: "book-with-audio",
      chapterHref: "chapter-1",
      chapterIndex: 0,
      contentHash: "content-hash-1",
      durationMs: 1_000,
      engineId: "dreamreader-local-tts",
      title: "Capitulo 1"
    })
    expect(first.draftAssetId).toBeUndefined()
    await db.update(ttsJobs).set({ status: "completed", progress: 1, finishedAt: new Date() }).where(eq(ttsJobs.id, "job-1"))
    expect((await audiobook.rebuildAutoIfIdle("book-with-audio"))?.draftAssetId).toBeUndefined()
    expect(await db.query.audiobookBuildJobs.findMany()).toEqual([])

    await audiobook.recordChapterAudio({
      audioAssetId: "asset-2",
      audioHash: "audio-hash-2",
      bookId: "book-with-audio",
      chapterHref: "chapter-2",
      chapterIndex: 1,
      contentHash: "content-hash-2",
      durationMs: 1_000,
      engineId: "dreamreader-local-tts",
      title: "Capitulo 2"
    })
    await db.update(ttsJobs).set({ status: "completed", progress: 1, finishedAt: new Date() }).where(eq(ttsJobs.id, "job-2"))

    const rebuilt = await audiobook.rebuildAutoIfIdle("book-with-audio")
    const buildJobs = await db.query.audiobookBuildJobs.findMany()

    expect(rebuilt.status).toBe("partial")
    expect(rebuilt.draftAssetId).toBeTruthy()
    expect(buildJobs).toHaveLength(1)
    expect(buildJobs[0].status).toBe("completed")
    expect((await audiobook.getLatestBuildJob("book-with-audio"))?.progress).toBe(1)
  })
})

async function createTestServices() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dreamreader-audiobook-"))
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

  return { audiobook: new AudiobookService(db, paths), client, db, paths }
}

async function seedBook(db: AppDatabase, paths: { booksDir: string }, id: string, title: string, chapterCount: number) {
  const libraryPath = path.join(paths.booksDir, `${id}.txt`)
  await mkdir(paths.booksDir, { recursive: true })
  await writeFile(libraryPath, title)
  const chapters = Array.from({ length: chapterCount }, (_, index) => ({
    id: `chapter-${index + 1}`,
    href: `chapter-${index + 1}`,
    title: `Capitulo ${index + 1}`,
    content: `<article><p>Trecho ${index + 1}.</p></article>`,
    mediaType: "text/html",
    progressionStart: 0,
    progressionEnd: 1
  }))
  await db.insert(books).values({
    id,
    contentHash: `${id}-hash`,
    fileType: "txt",
    title,
    authors: ["DreamReader"],
    language: "pt-BR",
    libraryPath,
    manifestJson: {
      format: "txt",
      title,
      authors: ["DreamReader"],
      language: "pt-BR",
      chapters,
      tableOfContents: chapters.map((chapter) => ({ href: chapter.href, title: chapter.title }))
    }
  })
}

function createSilentWav(durationMs: number, sampleRate: number): Buffer {
  const channelCount = 1
  const bytesPerSample = 2
  const frameCount = Math.max(1, Math.round((durationMs / 1000) * sampleRate))
  const dataSize = frameCount * channelCount * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write("RIFF", 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write("WAVE", 8)
  buffer.write("fmt ", 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channelCount, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28)
  buffer.writeUInt16LE(channelCount * bytesPerSample, 32)
  buffer.writeUInt16LE(bytesPerSample * 8, 34)
  buffer.write("data", 36)
  buffer.writeUInt32LE(dataSize, 40)
  return buffer
}

function createTinyPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64"
  )
}
