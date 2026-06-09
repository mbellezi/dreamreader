import { ArrowLeft, RefreshCw, Wand2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { ChapterDetail } from "@renderer/components/audio/ChapterDetail"
import { ChapterList } from "@renderer/components/audio/ChapterList"
import { GenerationControls } from "@renderer/components/audio/GenerationControls"
import { JobQueue } from "@renderer/components/audio/JobQueue"
import { useGenerationConfig } from "@renderer/app/useGenerationConfig"
import type { TranslationFn } from "@renderer/app/types"
import type {
  AudioSettings,
  AudiobookExport,
  BookDetails,
  RuntimeModel,
  TtsJob,
  TtsModelSettings,
  TtsSegment,
  VoiceProfile
} from "@renderer/types"

type GenerateChapterInput = {
  chapterHref: string
  engineId: string
  generationLanguage?: string
  modelSettings?: TtsModelSettings
  quality: "draft" | "standard" | "high"
  seed?: number
  seedFixed?: boolean
  useExpressiveNarration: boolean
  voiceProfileId?: string
  paragraphLimit?: number
}

type GenerateChaptersInput = {
  chapterHrefs?: string[]
  engineId: string
  generationLanguage?: string
  modelSettings?: TtsModelSettings
  quality: "draft" | "standard" | "high"
  seed?: number
  seedFixed?: boolean
  useExpressiveNarration: boolean
  voiceProfileId?: string
}

export function BookStudioPane({
  audiobook,
  audioSettings,
  book,
  jobs,
  loading,
  models,
  t,
  voices,
  onBack,
  onCancelJob,
  onClearChapterAudio,
  onClearTerminalJobs,
  onGenerateChapter,
  onGenerateChapters,
  onListSegments,
  onPauseJob,
  onRebuildAudiobook,
  onResumeJob,
  onRetryJob,
  onToggleAutoBuild,
  onUpdateAudioSettings
}: {
  audiobook: AudiobookExport | null
  audioSettings: AudioSettings
  book: BookDetails | null
  jobs: TtsJob[]
  loading: boolean
  models: RuntimeModel[]
  t: TranslationFn
  voices: VoiceProfile[]
  onBack: () => void
  onCancelJob: (jobId: string) => Promise<void> | void
  onClearChapterAudio: (chapterHref: string) => Promise<void> | void
  onClearTerminalJobs: () => Promise<void> | void
  onGenerateChapter: (input: GenerateChapterInput) => Promise<void> | void
  onGenerateChapters: (input: GenerateChaptersInput) => Promise<void> | void
  onListSegments: (jobId: string) => Promise<TtsSegment[]>
  onPauseJob: (jobId: string) => Promise<void> | void
  onRebuildAudiobook: () => Promise<void> | void
  onResumeJob: (jobId: string) => Promise<void> | void
  onRetryJob: (jobId: string) => Promise<void> | void
  onToggleAutoBuild: (enabled: boolean) => Promise<void> | void
  onUpdateAudioSettings: (audioSettings: AudioSettings, delay?: number) => Promise<void> | void
}) {
  const config = useGenerationConfig({ audioSettings, models, voices, t, onUpdateAudioSettings })
  const [selectedChapters, setSelectedChapters] = useState<Set<string>>(new Set())
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null)

  const chapters = book?.chapters ?? []

  useEffect(() => {
    setActiveChapterId((current) => {
      if (current && chapters.some((chapter) => chapter.id === current)) {
        return current
      }
      return chapters[0]?.id ?? null
    })
  }, [chapters])

  useEffect(() => {
    setSelectedChapters((current) => {
      const valid = new Set(chapters.map((chapter) => chapter.id))
      const next = new Set([...current].filter((id) => valid.has(id)))
      return next.size === current.size ? current : next
    })
  }, [chapters])

  const activeChapter = useMemo(
    () => chapters.find((chapter) => chapter.id === activeChapterId) ?? null,
    [activeChapterId, chapters]
  )

  if (!book) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <StudioHeader audiobook={audiobook} book={book} t={t} onBack={onBack} />
        <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
          <p className="rounded-md border bg-card p-3 text-sm text-muted-foreground">{t("audio.noChapter")}</p>
        </div>
      </div>
    )
  }

  const handleGenerateChapter = (chapterId: string) => {
    void onGenerateChapter(config.buildChapterParams(chapterId))
  }

  const handleGeneratePreview = (chapterId: string, paragraphLimit: number) => {
    void onGenerateChapter(config.buildChapterParams(chapterId, paragraphLimit))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <StudioHeader audiobook={audiobook} book={book} t={t} onBack={onBack} />

      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        <div className="mx-auto w-full max-w-6xl space-y-4">
          <section className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              className="inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
              disabled={loading || !config.canGenerate}
              onClick={() => void onGenerateChapters(config.buildBatchParams())}
            >
              <Wand2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{t("audio.batch.generateBook")}</span>
            </button>
            <button
              className="inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-md border bg-card px-3 text-sm disabled:opacity-50"
              disabled={!selectedChapters.size || loading || !config.canGenerate}
              onClick={() => void onGenerateChapters(config.buildBatchParams([...selectedChapters]))}
            >
              <Wand2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{t("audio.batch.generateSelected", { count: selectedChapters.size })}</span>
            </button>
          </section>

          <GenerationControls config={config} t={t} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <ChapterList
              book={book}
              audiobook={audiobook}
              jobs={jobs}
              loading={loading}
              canGenerate={config.canGenerate}
              activeChapterId={activeChapterId}
              selectedChapters={selectedChapters}
              t={t}
              onSelectChapter={setActiveChapterId}
              onToggleChapterSelected={(chapterId, checked) => {
                if (checked) {
                  setActiveChapterId(chapterId)
                }
                setSelectedChapters((current) => {
                  const next = new Set(current)
                  if (checked) {
                    next.add(chapterId)
                  } else {
                    next.delete(chapterId)
                  }
                  return next
                })
              }}
              onSelectAll={() => setSelectedChapters(new Set(book.chapters.map((chapter) => chapter.id)))}
              onClearSelection={() => setSelectedChapters(new Set())}
              onGenerateChapter={handleGenerateChapter}
              onClearChapter={(chapterId) => onClearChapterAudio(chapterId)}
            />

            <ChapterDetail
              chapter={activeChapter}
              audiobook={audiobook}
              jobs={jobs}
              loading={loading}
              canGenerate={config.canGenerate}
              t={t}
              onGenerateChapter={handleGenerateChapter}
              onGeneratePreview={handleGeneratePreview}
              onClearChapterAudio={onClearChapterAudio}
              onCancelJob={onCancelJob}
              onListSegments={onListSegments}
              onPauseJob={onPauseJob}
              onResumeJob={onResumeJob}
              onRetryJob={onRetryJob}
            />
          </div>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t("studio.book.export")}</h3>
            <label className="flex items-center justify-between rounded-md border bg-card p-3 text-sm">
              <span>{t("audio.autoBuild")}</span>
              <input
                className="h-4 w-4 accent-primary"
                type="checkbox"
                checked={Boolean(audiobook?.autoBuildEnabled)}
                onChange={(event) => onToggleAutoBuild(event.target.checked)}
              />
            </label>
            <button className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border bg-card px-3 text-sm disabled:opacity-50" disabled={!audiobook?.chaptersReady} onClick={onRebuildAudiobook}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              {t("audio.rebuild")}
            </button>
            <p className="rounded-md border bg-card p-3 text-xs text-muted-foreground">
              {audiobook?.draftAssetId ? t("audio.partialReady") : t("audio.partialPending")}
            </p>
          </section>

          <JobQueue
            jobs={jobs}
            loading={loading}
            t={t}
            describeJob={(job) => ({ title: chapterTitleFor(book, job.chapterHref) })}
            onCancelJob={onCancelJob}
            onPauseJob={onPauseJob}
            onResumeJob={onResumeJob}
            onRetryJob={onRetryJob}
            onClearFinished={onClearTerminalJobs}
          />
        </div>
      </div>
    </div>
  )
}

function StudioHeader({
  audiobook,
  book,
  t,
  onBack
}: {
  audiobook: AudiobookExport | null
  book: BookDetails | null
  t: TranslationFn
  onBack: () => void
}) {
  const ready = audiobook?.chaptersReady ?? 0
  const total = audiobook?.chaptersTotal || (book?.chapters.length ?? 0)
  const m4bStatus = audiobook?.status ?? "none"
  return (
    <header className="flex shrink-0 flex-col gap-3 border-b bg-background/95 px-6 py-4">
      <div className="flex items-center gap-3">
        <button className="inline-flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{t("audioDashboard.back")}</span>
        </button>
        {book?.coverImageUrl ? (
          <img src={book.coverImageUrl} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold leading-tight">{book?.title ?? t("audioDashboard.title")}</h2>
          <p className="truncate text-xs text-muted-foreground">{t("audioDashboard.book.subtitle")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-sm bg-muted px-2 py-1 text-xs text-muted-foreground">
            {t("studio.book.chaptersReady", { ready, total })}
          </span>
          <span className="rounded-sm bg-muted px-2 py-1 text-xs text-muted-foreground">
            {t("studio.book.m4bStatus", { status: t(`audioDashboard.status.${m4bStatus}`) })}
          </span>
        </div>
      </div>
    </header>
  )
}

function chapterTitleFor(book: BookDetails, chapterHref: string): string {
  return book.chapters.find((chapter) => chapter.id === chapterHref)?.title ?? chapterHref
}
