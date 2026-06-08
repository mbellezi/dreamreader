import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { and, asc, eq } from "drizzle-orm"
import type { AudiobookExport, AudiobookManifest, LibraryAudioStatus } from "@shared/contracts/ai"
import type { AppDatabase } from "@main/db/client"
import { assets, audiobookBuildJobs, audiobookChapters, audiobookExports, books, ttsJobs } from "@main/db/schema"
import { AppError } from "@main/lib/errors"
import { hashBuffer } from "@main/lib/hash"
import { createId } from "@main/lib/ids"
import type { AppPaths } from "@main/lib/paths"

const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"])

export type ChapterAudioReadyInput = {
  audioAssetId: string
  audioHash: string
  bookId: string
  chapterHref: string
  chapterIndex: number
  contentHash: string
  durationMs: number
  engineId: string
  title: string
  voiceBindingId?: string
  voiceProfileId?: string
}

export class AudiobookService {
  constructor(
    private readonly db: AppDatabase,
    private readonly paths: AppPaths
  ) {}

  async getExport(bookId: string): Promise<AudiobookExport> {
    return this.ensureExport(bookId)
  }

  async listLibraryStatus(): Promise<LibraryAudioStatus[]> {
    const bookRows = await this.db.query.books.findMany({
      orderBy: [asc(books.updatedAt)]
    })
    const exportRows = await this.db.query.audiobookExports.findMany()
    const exportsByBook = new Map(exportRows.map((row) => [row.bookId, row]))
    const jobRows = await this.db.query.ttsJobs.findMany()
    const activeBookIds = new Set(
      jobRows.filter((job) => !TERMINAL_JOB_STATUSES.has(job.status)).map((job) => job.bookId)
    )

    return bookRows.map((book) => {
      const exportRow = exportsByBook.get(book.id)
      const chaptersReady = exportRow?.chaptersReady ?? 0
      return {
        bookId: book.id,
        title: book.title,
        authors: book.authors ?? [],
        coverAssetId: optional(book.coverAssetId),
        status: exportRow ? normalizeStatus(exportRow.status) : "none",
        chaptersReady,
        chaptersTotal: exportRow?.chaptersTotal || totalChaptersFor(book),
        durationMs: exportRow?.durationMs ?? 0,
        hasChapterAudio: chaptersReady > 0,
        hasActiveJob: activeBookIds.has(book.id),
        updatedAt: toIso(exportRow?.updatedAt ?? book.updatedAt)
      }
    })
  }

  async setAutoBuild(bookId: string, enabled: boolean): Promise<AudiobookExport> {
    const current = await this.ensureExport(bookId)
    const [updated] = await this.db
      .update(audiobookExports)
      .set({
        autoBuildEnabled: enabled,
        metadataJson: {
          ...jsonObject(current.metadata),
          autoBuildPolicy: enabled ? "enabled" : "disabled"
        },
        updatedAt: new Date()
      })
      .where(eq(audiobookExports.id, current.id))
      .returning()

    if (enabled && updated.chaptersReady > 0) {
      return this.buildDraft(bookId, "manual_rebuild")
    }
    return toAudiobookExport(updated)
  }

  async rebuild(bookId: string): Promise<AudiobookExport> {
    return this.buildDraft(bookId, "manual_rebuild")
  }

  async reveal(bookId: string) {
    await this.ensureExport(bookId)
    return { revealed: true as const }
  }

  async recordChapterAudio(input: ChapterAudioReadyInput): Promise<AudiobookExport> {
    const current = await this.ensureExport(input.bookId)
    await this.db
      .insert(audiobookChapters)
      .values({
        id: createId("audiobook_chapter"),
        audiobookExportId: current.id,
        bookId: input.bookId,
        chapterHref: input.chapterHref,
        chapterIndex: input.chapterIndex,
        title: input.title,
        audioAssetId: input.audioAssetId,
        voiceProfileId: input.voiceProfileId,
        voiceBindingId: input.voiceBindingId,
        engineId: input.engineId,
        durationMs: input.durationMs,
        startMs: 0,
        endMs: input.durationMs,
        contentHash: input.contentHash,
        audioHash: input.audioHash,
        status: "ready",
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: [audiobookChapters.bookId, audiobookChapters.chapterHref],
        set: {
          audiobookExportId: current.id,
          chapterIndex: input.chapterIndex,
          title: input.title,
          audioAssetId: input.audioAssetId,
          voiceProfileId: input.voiceProfileId,
          voiceBindingId: input.voiceBindingId,
          engineId: input.engineId,
          durationMs: input.durationMs,
          endMs: input.durationMs,
          contentHash: input.contentHash,
          audioHash: input.audioHash,
          status: "ready",
          updatedAt: new Date()
        }
      })

    const updated = await this.refreshManifest(input.bookId, true)
    return updated.autoBuildEnabled ? this.buildDraft(input.bookId, "chapter_completed") : updated
  }

  async removeChapterAudio(bookId: string, chapterHref: string): Promise<string[]> {
    await this.ensureExport(bookId)
    const rows = await this.db.query.audiobookChapters.findMany({
      where: and(eq(audiobookChapters.bookId, bookId), eq(audiobookChapters.chapterHref, chapterHref))
    })
    const audioAssetIds = rows.map((row) => row.audioAssetId)
    if (rows.length) {
      await this.db
        .delete(audiobookChapters)
        .where(and(eq(audiobookChapters.bookId, bookId), eq(audiobookChapters.chapterHref, chapterHref)))
    }
    await this.refreshManifest(bookId, true)
    return audioAssetIds
  }

  async buildDraft(bookId: string, reason = "manual_rebuild"): Promise<AudiobookExport> {
    const current = await this.ensureExport(bookId)
    const [buildJob] = await this.db
      .insert(audiobookBuildJobs)
      .values({
        id: createId("audiobook_build"),
        audiobookExportId: current.id,
        bookId,
        reason,
        status: "building",
        progress: 0.25,
        startedAt: new Date(),
        updatedAt: new Date()
      })
      .returning()

    try {
      const refreshed = await this.refreshManifest(bookId, false)
      if (!refreshed.manifest?.chapters.length) {
        const [updatedEmpty] = await this.db
          .update(audiobookExports)
          .set({
            status: "none",
            stale: false,
            updatedAt: new Date()
          })
          .where(eq(audiobookExports.id, current.id))
          .returning()
        return toAudiobookExport(updatedEmpty)
      }

      const manifest = refreshed.manifest
      const json = JSON.stringify(
        {
          ...manifest,
          container: {
            format: "m4b",
            mode: "manifest-only",
            note: "Audio chapters are canonical; a real M4B encoder can rebuild from this manifest."
          }
        },
        null,
        2
      )
      const contentHash = hashBuffer(json)
      await mkdir(this.paths.audiobooksDir, { recursive: true })
      const filePath = path.join(this.paths.audiobooksDir, `${bookId}-${contentHash.slice(0, 16)}.m4b.json`)
      await writeFile(filePath, json)
      const [asset] = await this.db
        .insert(assets)
        .values({
          id: createId("asset"),
          kind: "audiobook_manifest",
          bookId,
          path: filePath,
          mimeType: "application/json",
          contentHash,
          sizeBytes: Buffer.byteLength(json)
        })
        .returning()

      const complete = refreshed.chaptersTotal > 0 && refreshed.chaptersReady >= refreshed.chaptersTotal
      const [updated] = await this.db
        .update(audiobookExports)
        .set({
          status: complete ? "complete" : "partial",
          assetId: complete ? asset.id : undefined,
          draftAssetId: asset.id,
          stale: false,
          metadataJson: {
            ...jsonObject(refreshed.metadata),
            draftMode: "manifest-only",
            lastBuildReason: reason
          },
          lastBuiltAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(audiobookExports.id, current.id))
        .returning()

      await this.db
        .update(audiobookBuildJobs)
        .set({
          status: "completed",
          progress: 1,
          resultAssetId: asset.id,
          finishedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(audiobookBuildJobs.id, buildJob.id))

      return toAudiobookExport(updated)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Audiobook build failed"
      await this.db
        .update(audiobookBuildJobs)
        .set({
          status: "failed",
          progress: 1,
          errorCode: "audiobook_build_failed",
          errorMessage: message,
          finishedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(audiobookBuildJobs.id, buildJob.id))
      await this.db
        .update(audiobookExports)
        .set({
          status: "error",
          errorCode: "audiobook_build_failed",
          errorMessage: message,
          stale: true,
          updatedAt: new Date()
        })
        .where(eq(audiobookExports.id, current.id))
      throw error
    }
  }

  private async ensureExport(bookId: string): Promise<AudiobookExport> {
    await this.getBook(bookId)
    const existing = await this.db.query.audiobookExports.findFirst({
      where: eq(audiobookExports.bookId, bookId)
    })
    if (existing) {
      return toAudiobookExport(existing)
    }

    const [created] = await this.db
      .insert(audiobookExports)
      .values({
        id: createId("audiobook"),
        bookId,
        status: "none",
        autoBuildEnabled: false,
        format: "m4b",
        metadataJson: {
          builder: "dreamreader-m4b-v1",
          mode: "incremental"
        }
      })
      .returning()
    return toAudiobookExport(created)
  }

  private async refreshManifest(bookId: string, stale: boolean): Promise<AudiobookExport> {
    const book = await this.getBook(bookId)
    const current = await this.ensureExport(bookId)
    const rows = await this.db.query.audiobookChapters.findMany({
      where: eq(audiobookChapters.bookId, bookId),
      orderBy: [asc(audiobookChapters.chapterIndex)]
    })
    let cursor = 0
    const chapters = []
    for (const row of rows) {
      const startMs = cursor
      const endMs = cursor + row.durationMs
      cursor = endMs
      if (row.startMs !== startMs || row.endMs !== endMs) {
        await this.db
          .update(audiobookChapters)
          .set({ startMs, endMs, updatedAt: new Date() })
          .where(eq(audiobookChapters.id, row.id))
      }
      chapters.push({
        bookId: row.bookId,
        chapterHref: row.chapterHref,
        chapterIndex: row.chapterIndex,
        title: row.title,
        audioAssetId: row.audioAssetId,
        voiceProfileId: optional(row.voiceProfileId),
        voiceBindingId: optional(row.voiceBindingId),
        engineId: row.engineId,
        durationMs: row.durationMs,
        startMs,
        endMs,
        contentHash: row.contentHash,
        audioHash: row.audioHash
      })
    }

    const manifest = chapters.length
      ? ({
          schemaVersion: "audiobook-manifest/v1",
          bookId,
          title: book.title,
          authors: book.authors ?? [],
          language: book.language,
          coverAssetId: optional(book.coverAssetId),
          generatedAt: new Date().toISOString(),
          engineId: optional(chapters.at(-1)?.engineId),
          voiceProfileId: optional(chapters.at(-1)?.voiceProfileId),
          chapters,
          durationMs: cursor
        } satisfies AudiobookManifest)
      : undefined

    const chaptersTotal = totalChaptersFor(book)
    const [updated] = await this.db
      .update(audiobookExports)
      .set({
        status: chapters.length ? "partial" : "none",
        manifestJson: manifest ?? {},
        chaptersReady: chapters.length,
        chaptersTotal,
        durationMs: cursor,
        stale,
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date()
      })
      .where(eq(audiobookExports.id, current.id))
      .returning()
    return toAudiobookExport(updated)
  }

  private async getBook(bookId: string) {
    const book = await this.db.query.books.findFirst({ where: eq(books.id, bookId) })
    if (!book) {
      throw new AppError("book_not_found", "Book not found")
    }
    return book
  }
}

function totalChaptersFor(book: typeof books.$inferSelect): number {
  const manifest = book.manifestJson as { chapters?: unknown[]; tableOfContents?: unknown[] }
  return manifest.chapters?.length ?? manifest.tableOfContents?.length ?? 0
}

function toAudiobookExport(row: typeof audiobookExports.$inferSelect): AudiobookExport {
  const manifest = jsonObject(row.manifestJson)
  return {
    id: row.id,
    bookId: row.bookId,
    status: normalizeStatus(row.status),
    autoBuildEnabled: row.autoBuildEnabled,
    format: "m4b",
    assetId: optional(row.assetId),
    draftAssetId: optional(row.draftAssetId),
    manifest: Object.keys(manifest).length ? (manifest as AudiobookManifest) : undefined,
    metadata: jsonObject(row.metadataJson) as AudiobookExport["metadata"],
    chaptersReady: row.chaptersReady,
    chaptersTotal: row.chaptersTotal,
    durationMs: row.durationMs,
    stale: row.stale,
    errorCode: optional(row.errorCode),
    errorMessage: optional(row.errorMessage),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    lastBuiltAt: optionalDate(row.lastBuiltAt)
  }
}

function normalizeStatus(status: string): AudiobookExport["status"] {
  if (status === "partial" || status === "stale" || status === "complete" || status === "error") {
    return status
  }
  return "none"
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function optional(value: string | null | undefined): string | undefined {
  return value || undefined
}

function optionalDate(value: Date | null | undefined): string | undefined {
  return value ? toIso(value) : undefined
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}
