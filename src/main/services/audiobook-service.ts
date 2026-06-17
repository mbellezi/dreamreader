import { access, copyFile, mkdir, rename, rm, stat } from "node:fs/promises"
import path from "node:path"
import { and, asc, desc, eq, inArray } from "drizzle-orm"
import type { AudiobookBuildJob, AudiobookExport, AudiobookManifest, LibraryAudioStatus } from "@shared/contracts/ai"
import type { AppDatabase } from "@main/db/client"
import { assets, audiobookBuildJobs, audiobookChapters, audiobookExports, books, ttsJobs } from "@main/db/schema"
import { buildM4bAudiobook, type M4bChapterInput } from "@main/lib/audio-transcode"
import { AppError } from "@main/lib/errors"
import { hashBuffer, hashFile } from "@main/lib/hash"
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
      return this.rebuildAutoIfIdle(bookId, "manual_rebuild")
    }
    return toAudiobookExport(updated)
  }

  async rebuild(bookId: string): Promise<AudiobookExport> {
    return this.buildDraft(bookId, "manual_rebuild")
  }

  async deleteExport(bookId: string): Promise<AudiobookExport> {
    const current = await this.ensureExport(bookId)
    if (await this.hasActiveBuildJob(bookId)) {
      throw new AppError("audiobook_build_active", "Wait for the active audiobook build before deleting the export")
    }

    const assetIds = uniqueStrings([current.assetId, current.draftAssetId].filter((id): id is string => Boolean(id)))
    const assetRows = assetIds.length
      ? await this.db.query.assets.findMany({
          where: inArray(assets.id, assetIds)
        })
      : []

    if (assetIds.length) {
      await this.db.delete(assets).where(inArray(assets.id, assetIds))
    }
    await Promise.all(assetRows.map((asset) => rm(asset.path, { force: true }).catch(() => undefined)))

    const [updated] = await this.db
      .update(audiobookExports)
      .set({
        assetId: null,
        draftAssetId: null,
        status: "none",
        stale: current.chaptersReady > 0,
        errorCode: null,
        errorMessage: null,
        lastBuiltAt: null,
        metadataJson: {
          ...jsonObject(current.metadata),
          artifactMode: "m4b",
          deletedExportAt: new Date().toISOString()
        },
        updatedAt: new Date()
      })
      .where(eq(audiobookExports.id, current.id))
      .returning()

    return toAudiobookExport(updated)
  }

  async rebuildAutoIfIdle(bookId: string, reason = "chapter_completed"): Promise<AudiobookExport> {
    const current = await this.ensureExport(bookId)
    if (!current.autoBuildEnabled || current.chaptersReady <= 0 || (await this.hasActiveAudioJobs(bookId))) {
      return current
    }
    return this.buildDraft(bookId, reason)
  }

  async getLatestBuildJob(bookId: string): Promise<AudiobookBuildJob | null> {
    const job = await this.db.query.audiobookBuildJobs.findFirst({
      where: eq(audiobookBuildJobs.bookId, bookId),
      orderBy: [desc(audiobookBuildJobs.updatedAt)]
    })
    return job ? toAudiobookBuildJob(job) : null
  }

  async exportFileName(bookId: string): Promise<string> {
    const book = await this.getBook(bookId)
    const author = book.authors?.[0]?.trim()
    const baseName = author ? `${book.title} - ${author}` : book.title
    return `${safeFileName(baseName)}.m4b`
  }

  async getExportFilePath(bookId: string): Promise<string> {
    const current = await this.ensureExport(bookId)
    const assetId = current.status === "complete" ? current.assetId ?? current.draftAssetId : current.draftAssetId ?? current.assetId
    if (!assetId) {
      throw new AppError("audiobook_export_not_built", "Audiobook export has not been built yet")
    }

    const asset = await this.db.query.assets.findFirst({
      where: eq(assets.id, assetId)
    })
    if (!asset?.path) {
      throw new AppError("audiobook_export_asset_missing", "Audiobook export asset not found")
    }

    try {
      await access(asset.path)
    } catch {
      throw new AppError("audiobook_export_file_missing", "Audiobook export file is missing")
    }

    return asset.path
  }

  async saveExportToFile(input: { bookId: string; targetPath: string }): Promise<{ saved: true; filePath: string }> {
    const sourcePath = await this.getExportFilePath(input.bookId)
    await mkdir(path.dirname(input.targetPath), { recursive: true })
    await copyFile(sourcePath, input.targetPath)
    return { saved: true, filePath: input.targetPath }
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
    return updated.autoBuildEnabled ? this.rebuildAutoIfIdle(input.bookId, "chapter_completed") : updated
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
        status: "queued",
        progress: 0.02,
        startedAt: new Date(),
        updatedAt: new Date()
      })
      .returning()

    try {
      await this.updateBuildJob(buildJob.id, { status: "building", progress: 0.12 })
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
        await this.updateBuildJob(buildJob.id, { status: "completed", progress: 1, finishedAt: new Date() })
        return toAudiobookExport(updatedEmpty)
      }

      await this.updateBuildJob(buildJob.id, { status: "building", progress: 0.28 })
      const manifest = refreshed.manifest
      const m4bChapters = await this.resolveM4bChapters(manifest)
      const coverPath = await this.resolveM4bCoverPath(manifest)
      await this.updateBuildJob(buildJob.id, { status: "building", progress: 0.42 })
      const manifestHash = hashBuffer(
        JSON.stringify({
          ...manifest,
          coverPath,
          container: {
            encoder: "ffmpeg-static",
            format: "m4b",
            mode: "audio"
          }
        })
      )
      await mkdir(this.paths.audiobooksDir, { recursive: true })
      const filePath = path.join(this.paths.audiobooksDir, `${bookId}-${manifestHash.slice(0, 16)}.m4b`)
      const tempPath = path.join(this.paths.audiobooksDir, `.${bookId}-${createId("m4b")}.tmp`)
      let buildResult: Awaited<ReturnType<typeof buildM4bAudiobook>>
      try {
        await this.updateBuildJob(buildJob.id, { status: "building", progress: 0.55 })
        buildResult = await buildM4bAudiobook({
          chapters: m4bChapters,
          coverPath,
          metadata: {
            authors: manifest.authors,
            language: manifest.language,
            title: manifest.title
          },
          outputPath: tempPath
        })
        await this.updateBuildJob(buildJob.id, { status: "validating", progress: 0.86 })
        await rename(tempPath, filePath)
      } catch (error) {
        await rm(tempPath, { force: true })
        throw error
      }
      const contentHash = await hashFile(filePath)
      const sizeBytes = (await stat(filePath)).size
      const [asset] = await this.db
        .insert(assets)
        .values({
          id: createId("asset"),
          kind: "audiobook_m4b",
          bookId,
          path: filePath,
          mimeType: "audio/mp4",
          contentHash,
          sizeBytes
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
            artifactMode: "m4b",
            audioMode: buildResult.audioMode,
            encoder: buildResult.encoder === "copy" ? "copy" : `ffmpeg-static:${buildResult.encoder}`,
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

  private async resolveM4bChapters(manifest: AudiobookManifest): Promise<M4bChapterInput[]> {
    const audioAssetIds = manifest.chapters.map((chapter) => chapter.audioAssetId)
    const audioAssets = audioAssetIds.length
      ? await this.db.query.assets.findMany({
          where: inArray(assets.id, audioAssetIds)
        })
      : []
    const assetsById = new Map(audioAssets.map((asset) => [asset.id, asset]))

    const chapters: M4bChapterInput[] = []
    for (const chapter of manifest.chapters) {
      const asset = assetsById.get(chapter.audioAssetId)
      if (!asset?.path) {
        throw new AppError("audiobook_chapter_audio_missing", "Audiobook chapter audio asset not found")
      }
      try {
        await access(asset.path)
      } catch {
        throw new AppError("audiobook_chapter_audio_file_missing", "Audiobook chapter audio file is missing")
      }
      chapters.push({
        filePath: asset.path,
        mimeType: asset.mimeType,
        title: chapter.title,
        startMs: chapter.startMs,
        endMs: chapter.endMs
      })
    }

    return chapters
  }

  private async resolveM4bCoverPath(manifest: AudiobookManifest): Promise<string | undefined> {
    if (!manifest.coverAssetId) {
      return undefined
    }
    const cover = await this.db.query.assets.findFirst({
      where: eq(assets.id, manifest.coverAssetId)
    })
    if (!cover?.path) {
      return undefined
    }
    try {
      await access(cover.path)
      return cover.path
    } catch {
      return undefined
    }
  }

  private async hasActiveAudioJobs(bookId: string): Promise<boolean> {
    const jobs = await this.db.query.ttsJobs.findMany({
      where: eq(ttsJobs.bookId, bookId)
    })
    return jobs.some((job) => !TERMINAL_JOB_STATUSES.has(job.status))
  }

  private async hasActiveBuildJob(bookId: string): Promise<boolean> {
    const jobs = await this.db.query.audiobookBuildJobs.findMany({
      where: eq(audiobookBuildJobs.bookId, bookId)
    })
    return jobs.some((job) => !TERMINAL_JOB_STATUSES.has(job.status))
  }

  private async updateBuildJob(id: string, patch: Partial<typeof audiobookBuildJobs.$inferInsert>) {
    await this.db
      .update(audiobookBuildJobs)
      .set({
        ...patch,
        updatedAt: new Date()
      })
      .where(eq(audiobookBuildJobs.id, id))
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
  return (manifest.chapters?.length ?? manifest.tableOfContents?.length ?? 0) + 1
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

function toAudiobookBuildJob(row: typeof audiobookBuildJobs.$inferSelect): AudiobookBuildJob {
  return {
    id: row.id,
    bookId: row.bookId,
    audiobookExportId: row.audiobookExportId,
    status: normalizeBuildStatus(row.status),
    progress: Math.min(Math.max(row.progress, 0), 1),
    reason: row.reason,
    resultAssetId: optional(row.resultAssetId),
    errorCode: optional(row.errorCode),
    errorMessage: optional(row.errorMessage),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    startedAt: optionalDate(row.startedAt),
    finishedAt: optionalDate(row.finishedAt)
  }
}

function normalizeStatus(status: string): AudiobookExport["status"] {
  if (status === "partial" || status === "stale" || status === "complete" || status === "error") {
    return status
  }
  return "none"
}

function normalizeBuildStatus(status: string): AudiobookBuildJob["status"] {
  if (
    status === "queued" ||
    status === "building" ||
    status === "validating" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled"
  ) {
    return status
  }
  return "queued"
}

function safeFileName(value: string): string {
  const clean = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
  return clean || "audiobook"
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function optional(value: string | null | undefined): string | undefined {
  return value || undefined
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function optionalDate(value: Date | null | undefined): string | undefined {
  return value ? toIso(value) : undefined
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}
