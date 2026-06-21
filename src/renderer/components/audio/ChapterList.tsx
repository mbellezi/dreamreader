import { Search, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { ChapterRow } from "@renderer/components/audio/ChapterRow"
import { SegmentPreviewCard } from "@renderer/components/audio/GenerationProgress"
import type { TranslationFn } from "@renderer/app/types"
import { getChapterAudioStatus } from "@renderer/lib/chapterStatus"
import { isActiveJob } from "@renderer/lib/jobQueue"
import type { AudiobookExport, Chapter, TtsJob, TtsSegment } from "@renderer/types"

export function ChapterList({
  bookId,
  chapters,
  audiobook,
  jobs,
  loading,
  canGenerate,
  activeChapterId,
  selectedChapters,
  t,
  onSelectChapter,
  onToggleChapterSelected,
  onSelectAll,
  onClearSelection,
  onGenerateChapter,
  onClearChapter,
  onCancelJob,
  onListSegments,
  onPauseJob,
  onRegenerateSegment,
  onResumeJob,
  onRetryJob,
  onSearchSegments
}: {
  bookId: string
  chapters: Chapter[]
  audiobook: AudiobookExport | null
  jobs: TtsJob[]
  loading: boolean
  canGenerate: boolean
  activeChapterId: string | null
  selectedChapters: Set<string>
  t: TranslationFn
  onSelectChapter: (chapterId: string | null) => void
  onToggleChapterSelected: (chapterId: string, checked: boolean) => void
  onSelectAll: () => void
  onClearSelection: () => void
  onGenerateChapter: (chapterId: string) => void
  onClearChapter: (chapterId: string) => void
  onCancelJob: (jobId: string) => Promise<void> | void
  onListSegments: (jobId: string) => Promise<TtsSegment[]>
  onPauseJob: (jobId: string) => Promise<void> | void
  onRegenerateSegment: (input: { segmentId: string; text: string }) => Promise<TtsSegment>
  onResumeJob: (jobId: string) => Promise<void> | void
  onRetryJob: (jobId: string) => Promise<void> | void
  onSearchSegments: (input: { bookId: string; query: string; limit?: number }) => Promise<TtsSegment[]>
}) {
  const selectAllRef = useRef<HTMLInputElement>(null)
  const [segmentSearch, setSegmentSearch] = useState("")
  const [segmentSearchResults, setSegmentSearchResults] = useState<TtsSegment[]>([])
  const [searchingSegments, setSearchingSegments] = useState(false)
  const allSelected = chapters.length > 0 && selectedChapters.size === chapters.length
  const partiallySelected = selectedChapters.size > 0 && !allSelected
  const chaptersById = useMemo(() => new Map(chapters.map((chapter) => [chapter.id, chapter])), [chapters])

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = partiallySelected
    }
  }, [partiallySelected])

  useEffect(() => {
    const query = segmentSearch.trim()
    if (!query) {
      setSegmentSearchResults([])
      setSearchingSegments(false)
      return
    }

    let cancelled = false
    setSearchingSegments(true)
    const timeout = window.setTimeout(() => {
      onSearchSegments({ bookId, query, limit: 30 })
        .then((segments) => {
          if (!cancelled) {
            setSegmentSearchResults(segments)
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSegmentSearchResults([])
          }
        })
        .finally(() => {
          if (!cancelled) {
            setSearchingSegments(false)
          }
        })
    }, 300)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [bookId, onSearchSegments, segmentSearch])

  const updateSearchResult = (updated: TtsSegment) => {
    setSegmentSearchResults((current) => current.map((segment) => (segment.id === updated.id ? updated : segment)))
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <h3 className="text-sm font-semibold">{t("studio.book.chapters")}</h3>
          <label className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border bg-card px-2.5 text-xs text-muted-foreground">
            <input
              ref={selectAllRef}
              className="h-4 w-4 accent-primary"
              type="checkbox"
              checked={allSelected}
              disabled={!chapters.length}
              onChange={(event) => {
                if (event.target.checked) {
                  onSelectAll()
                } else {
                  onClearSelection()
                }
              }}
            />
            <span>{t("audio.batch.selectAll")}</span>
          </label>
        </div>
      </div>

      <div className="space-y-2">
        <label className="relative block" aria-label={t("studio.segmentSearch.placeholder")}>
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            className="dreamreader-segment-search-input box-border block h-10 w-full appearance-none rounded-md border bg-card py-2 pl-10 pr-10 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
            placeholder={t("studio.segmentSearch.placeholder")}
            type="text"
            value={segmentSearch}
            onChange={(event) => setSegmentSearch(event.target.value)}
          />
          <button
            className="dreamreader-segment-search-clear absolute right-2 top-1/2 z-10 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:pointer-events-none disabled:opacity-35"
            type="button"
            title={t("studio.segmentSearch.clear")}
            aria-label={t("studio.segmentSearch.clear")}
            disabled={!segmentSearch}
            onClick={() => {
              if (segmentSearch) {
                setSegmentSearch("")
                setSegmentSearchResults([])
                setSearchingSegments(false)
              }
            }}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </label>
        {segmentSearch.trim() ? (
          <div className="rounded-md border bg-card p-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              {searchingSegments
                ? t("common.loading")
                : segmentSearchResults.length
                  ? t("studio.segmentSearch.results", { count: segmentSearchResults.length })
                  : t("studio.segmentSearch.empty")}
            </div>
            {segmentSearchResults.length ? (
              <div className="max-h-96 space-y-2 overflow-auto pr-1">
                {segmentSearchResults.map((segment) => {
                  const chapterTitle = chaptersById.get(segment.chapterHref ?? "")?.title ?? segment.chapterHref ?? ""
                  return (
                    <SegmentPreviewCard
                      key={segment.id}
                      contextLabel={t("studio.segmentSearch.chapter", { title: chapterTitle })}
                      segment={segment}
                      t={t}
                      onRegenerateSegment={onRegenerateSegment}
                      onSegmentUpdated={updateSearchResult}
                    />
                  )
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="space-y-2">
        {chapters.map((chapter) => {
          const status = getChapterAudioStatus(chapter.id, audiobook, jobs)
          const manifestChapter = audiobook?.manifest?.chapters.find((item) => item.chapterHref === chapter.id)
          const chapterJobs = jobs.filter((job) => job.chapterHref === chapter.id)
          const currentJob = [...chapterJobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
          const hasActiveJob = chapterJobs.some((job) => isActiveJob(job))
          const hasGeneration = Boolean(manifestChapter) || chapterJobs.length > 0
          return (
            <ChapterRow
              key={chapter.id}
              chapter={chapter}
              status={status}
              manifestChapter={manifestChapter}
              active={activeChapterId === chapter.id}
              expanded={activeChapterId === chapter.id}
              selected={selectedChapters.has(chapter.id)}
              canGenerate={canGenerate}
              loading={loading}
              hasActiveJob={hasActiveJob}
              hasGeneration={hasGeneration}
              currentJob={currentJob}
              t={t}
              onSelect={() => onSelectChapter(activeChapterId === chapter.id ? null : chapter.id)}
              onToggleSelected={(checked) => onToggleChapterSelected(chapter.id, checked)}
              onGenerate={() => onGenerateChapter(chapter.id)}
              onClear={() => onClearChapter(chapter.id)}
              onCancelJob={onCancelJob}
              onListSegments={onListSegments}
              onPauseJob={onPauseJob}
              onRegenerateSegment={onRegenerateSegment}
              onResumeJob={onResumeJob}
              onRetryJob={onRetryJob}
            />
          )
        })}
      </div>
    </section>
  )
}
