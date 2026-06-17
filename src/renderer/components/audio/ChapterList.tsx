import { useEffect, useRef } from "react"
import { ChapterRow } from "@renderer/components/audio/ChapterRow"
import type { TranslationFn } from "@renderer/app/types"
import { getChapterAudioStatus } from "@renderer/lib/chapterStatus"
import { isActiveJob } from "@renderer/lib/jobQueue"
import type { AudiobookExport, Chapter, TtsJob } from "@renderer/types"

export function ChapterList({
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
  onClearChapter
}: {
  chapters: Chapter[]
  audiobook: AudiobookExport | null
  jobs: TtsJob[]
  loading: boolean
  canGenerate: boolean
  activeChapterId: string | null
  selectedChapters: Set<string>
  t: TranslationFn
  onSelectChapter: (chapterId: string) => void
  onToggleChapterSelected: (chapterId: string, checked: boolean) => void
  onSelectAll: () => void
  onClearSelection: () => void
  onGenerateChapter: (chapterId: string) => void
  onClearChapter: (chapterId: string) => void
}) {
  const selectAllRef = useRef<HTMLInputElement>(null)
  const allSelected = chapters.length > 0 && selectedChapters.size === chapters.length
  const partiallySelected = selectedChapters.size > 0 && !allSelected

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = partiallySelected
    }
  }, [partiallySelected])

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
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
      <div className="space-y-2">
        {chapters.map((chapter) => {
          const status = getChapterAudioStatus(chapter.id, audiobook, jobs)
          const manifestChapter = audiobook?.manifest?.chapters.find((item) => item.chapterHref === chapter.id)
          const chapterJobs = jobs.filter((job) => job.chapterHref === chapter.id)
          const hasActiveJob = chapterJobs.some((job) => isActiveJob(job))
          const hasGeneration = Boolean(manifestChapter) || chapterJobs.length > 0
          return (
            <ChapterRow
              key={chapter.id}
              chapter={chapter}
              status={status}
              manifestChapter={manifestChapter}
              active={activeChapterId === chapter.id}
              selected={selectedChapters.has(chapter.id)}
              canGenerate={canGenerate}
              loading={loading}
              hasActiveJob={hasActiveJob}
              hasGeneration={hasGeneration}
              t={t}
              onSelect={() => onSelectChapter(chapter.id)}
              onToggleSelected={(checked) => onToggleChapterSelected(chapter.id, checked)}
              onGenerate={() => onGenerateChapter(chapter.id)}
              onClear={() => onClearChapter(chapter.id)}
            />
          )
        })}
      </div>
    </section>
  )
}
