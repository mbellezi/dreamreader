import { ChapterRow } from "@renderer/components/audio/ChapterRow"
import type { TranslationFn } from "@renderer/app/types"
import { getChapterAudioStatus } from "@renderer/lib/chapterStatus"
import { isActiveJob } from "@renderer/lib/jobQueue"
import type { AudiobookExport, BookDetails, TtsJob } from "@renderer/types"

export function ChapterList({
  book,
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
  book: BookDetails
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
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("studio.book.chapters")}</h3>
        <div className="flex shrink-0 gap-2 text-xs">
          <button className="text-muted-foreground hover:text-foreground" onClick={onSelectAll}>
            {t("audio.batch.selectAll")}
          </button>
          <button className="text-muted-foreground hover:text-foreground" onClick={onClearSelection}>
            {t("audio.batch.clear")}
          </button>
        </div>
      </div>
      <div className="space-y-2">
        {book.chapters.map((chapter) => {
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
