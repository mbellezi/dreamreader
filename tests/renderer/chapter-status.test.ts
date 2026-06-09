import { describe, expect, it } from "vitest"
import { getChapterAudioStatus } from "../../src/renderer/lib/chapterStatus"
import type { AudiobookExport, TtsJob, TtsJobStatus } from "../../src/renderer/types"

function job(overrides: Partial<TtsJob> & { status: TtsJobStatus; chapterHref: string }): TtsJob {
  return {
    id: overrides.id ?? `job-${overrides.status}-${overrides.chapterHref}`,
    bookId: "book-1",
    engineId: "engine-1",
    progress: 0,
    settings: {},
    createdAt: "2026-06-06T12:00:00.000Z",
    updatedAt: "2026-06-06T12:00:00.000Z",
    ...overrides
  } as TtsJob
}

function audiobookWithChapter(chapterHref: string, durationMs: number): AudiobookExport {
  return {
    id: "ab-1",
    bookId: "book-1",
    status: "partial",
    autoBuildEnabled: false,
    manifest: {
      chapters: [
        {
          bookId: "book-1",
          chapterHref,
          chapterIndex: 0,
          title: "Ch",
          audioAssetId: "asset-1",
          engineId: "engine-1",
          durationMs,
          startMs: 0,
          endMs: durationMs,
          contentHash: "c",
          audioHash: "a"
        }
      ],
      durationMs
    },
    chaptersReady: 1,
    chaptersTotal: 1,
    stale: false
  }
}

describe("getChapterAudioStatus", () => {
  it("returns ready with duration when manifest has the chapter and no active job", () => {
    const result = getChapterAudioStatus("ch-1", audiobookWithChapter("ch-1", 90000), [])
    expect(result).toEqual({ kind: "ready", durationMs: 90000 })
  })

  it("returns generating with progress for an active synthesizing job", () => {
    const jobs = [job({ status: "synthesizing", chapterHref: "ch-1", progress: 0.4 })]
    expect(getChapterAudioStatus("ch-1", null, jobs)).toEqual({ kind: "generating", progress: 0.4 })
  })

  it("returns queued for a queued job", () => {
    const jobs = [job({ status: "queued", chapterHref: "ch-1", progress: 0 })]
    expect(getChapterAudioStatus("ch-1", null, jobs)).toEqual({ kind: "queued", progress: 0 })
  })

  it("active job takes precedence over a completed manifest entry", () => {
    const jobs = [job({ status: "synthesizing", chapterHref: "ch-1", progress: 0.2 })]
    expect(getChapterAudioStatus("ch-1", audiobookWithChapter("ch-1", 1000), jobs)).toEqual({
      kind: "generating",
      progress: 0.2
    })
  })

  it("returns failed when the latest job failed and there is no audio", () => {
    const jobs = [
      job({ id: "old", status: "completed", chapterHref: "ch-1", createdAt: "2026-06-06T10:00:00.000Z" }),
      job({ id: "new", status: "failed", chapterHref: "ch-1", createdAt: "2026-06-06T12:00:00.000Z" })
    ]
    expect(getChapterAudioStatus("ch-1", null, jobs)).toEqual({ kind: "failed" })
  })

  it("does not treat a completed partial preview as chapter-ready audio", () => {
    const jobs = [
      job({
        status: "completed",
        chapterHref: "ch-1",
        settings: { partial: true, paragraphLimit: 3, chapterAudioAssetId: "asset-preview" }
      })
    ]
    expect(getChapterAudioStatus("ch-1", null, jobs)).toEqual({ kind: "none" })
  })

  it("keeps showing a real manifest entry after a partial preview job", () => {
    const jobs = [
      job({
        status: "completed",
        chapterHref: "ch-1",
        settings: { partial: true, paragraphLimit: 3, chapterAudioAssetId: "asset-preview" }
      })
    ]
    expect(getChapterAudioStatus("ch-1", audiobookWithChapter("ch-1", 90000), jobs)).toEqual({
      kind: "ready",
      durationMs: 90000
    })
  })

  it("returns none when nothing exists for the chapter", () => {
    const jobs = [job({ status: "synthesizing", chapterHref: "other" })]
    expect(getChapterAudioStatus("ch-1", null, jobs)).toEqual({ kind: "none" })
  })
})
