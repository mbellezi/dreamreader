import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { afterEach, describe, expect, it } from "vitest"
import type { AppDatabase } from "../../src/main/db/client"
import * as schema from "../../src/main/db/schema"
import { assets, books, ttsEngines, ttsJobs } from "../../src/main/db/schema"
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
      chaptersTotal: 2,
      hasChapterAudio: true,
      hasActiveJob: true
    })
    expect(withAudio?.durationMs).toBe(4200)

    const withoutAudio = status.find((item) => item.bookId === "book-without-audio")
    expect(withoutAudio).toMatchObject({
      title: "Livro sem Áudio",
      status: "none",
      chaptersReady: 0,
      chaptersTotal: 3,
      hasChapterAudio: false,
      hasActiveJob: false
    })
  })
})

async function createTestServices() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dreamreader-audiobook-"))
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
