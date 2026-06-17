import { ArrowLeft, FileX, RefreshCw, Save, Square, Trash2, Wand2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { ChapterDetail } from "@renderer/components/audio/ChapterDetail"
import { ChapterList } from "@renderer/components/audio/ChapterList"
import { GenerationControls } from "@renderer/components/audio/GenerationControls"
import { JobQueue } from "@renderer/components/audio/JobQueue"
import { useGenerationConfig } from "@renderer/app/useGenerationConfig"
import type { TranslationFn } from "@renderer/app/types"
import { audioChaptersForBook } from "@renderer/lib/audioChapters"
import { isTerminalJobStatus } from "@renderer/lib/jobQueue"
import type {
  AudioSettings,
  AudiobookBuildJob,
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
  audiobookBuildJob,
  audioSettings,
  book,
  jobs,
  loading,
  models,
  t,
  voices,
  onBack,
  onCancelQueuedJobs,
  onClearAllChapterAudio,
  onCancelJob,
  onClearChapterAudio,
  onClearTerminalJobs,
  onDeleteAudiobookExport,
  onGenerateChapter,
  onGenerateChapters,
  onListSegments,
  onPauseJob,
  onRebuildAudiobook,
  onSaveAudiobook,
  onResumeJob,
  onRetryJob,
  onToggleAutoBuild,
  onUpdateAudioSettings
}: {
  audiobook: AudiobookExport | null
  audiobookBuildJob: AudiobookBuildJob | null
  audioSettings: AudioSettings
  book: BookDetails | null
  jobs: TtsJob[]
  loading: boolean
  models: RuntimeModel[]
  t: TranslationFn
  voices: VoiceProfile[]
  onBack: () => void
  onCancelQueuedJobs: (jobIds: string[]) => Promise<void> | void
  onClearAllChapterAudio: (chapterHrefs: string[]) => Promise<void> | void
  onCancelJob: (jobId: string) => Promise<void> | void
  onClearChapterAudio: (chapterHref: string) => Promise<void> | void
  onClearTerminalJobs: () => Promise<void> | void
  onDeleteAudiobookExport: () => Promise<void> | void
  onGenerateChapter: (input: GenerateChapterInput) => Promise<void> | void
  onGenerateChapters: (input: GenerateChaptersInput) => Promise<void> | void
  onListSegments: (jobId: string) => Promise<TtsSegment[]>
  onPauseJob: (jobId: string) => Promise<void> | void
  onRebuildAudiobook: () => Promise<void> | void
  onSaveAudiobook: () => Promise<void> | void
  onResumeJob: (jobId: string) => Promise<void> | void
  onRetryJob: (jobId: string) => Promise<void> | void
  onToggleAutoBuild: (enabled: boolean) => Promise<void> | void
  onUpdateAudioSettings: (audioSettings: AudioSettings, delay?: number) => Promise<void> | void
}) {
  const config = useGenerationConfig({ audioSettings, models, voices, t, onUpdateAudioSettings })
  const [selectedChapters, setSelectedChapters] = useState<Set<string>>(new Set())
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null)

  const chapters = useMemo(() => audioChaptersForBook(book), [book])

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
  const activeBuildJob = audiobookBuildJob && ["queued", "building", "validating"].includes(audiobookBuildJob.status)
    ? audiobookBuildJob
    : null
  const activeAudioJobs = jobs.some((job) => !["completed", "failed", "cancelled", "paused"].includes(job.status))
  const cancellableJobs = jobs.filter((job) => !isTerminalJobStatus(job.status))
  const hasBlockingJobs = jobs.some((job) => !isTerminalJobStatus(job.status))
  const hasCompiledM4b = Boolean(audiobook?.assetId ?? audiobook?.draftAssetId)
  const hasAnyChapterAudio = chapters.some((chapter) => {
    return (
      jobs.some((job) => job.chapterHref === chapter.id) ||
      Boolean(audiobook?.manifest?.chapters.some((item) => item.chapterHref === chapter.id))
    )
  })
  const waitingForAudioBeforeM4b = Boolean(audiobook?.autoBuildEnabled && audiobook.stale && activeAudioJobs && !activeBuildJob)
  const buildProgress = Math.round((activeBuildJob?.progress ?? 0) * 100)

  if (!book) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <StudioHeader audiobook={audiobook} book={book} chaptersTotal={chapters.length} t={t} onBack={onBack} />
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
      <StudioHeader audiobook={audiobook} book={book} chaptersTotal={chapters.length} t={t} onBack={onBack} />

      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        <div className="mx-auto w-full max-w-6xl space-y-4">
          <section className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
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
            <button
              className="inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-md border bg-card px-3 text-sm disabled:opacity-50"
              disabled={!cancellableJobs.length || loading}
              onClick={() => void onCancelQueuedJobs(cancellableJobs.map((job) => job.id))}
            >
              <Square className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{t("audio.batch.cancelQueue")}</span>
            </button>
            <button
              className="inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-md border bg-card px-3 text-sm text-destructive disabled:opacity-50"
              disabled={!hasAnyChapterAudio || hasBlockingJobs || loading}
              onClick={() => void onClearAllChapterAudio(chapters.map((chapter) => chapter.id))}
            >
              <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{t("audio.batch.clearAllAudio")}</span>
            </button>
            <button
              className="inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-md border bg-card px-3 text-sm text-destructive disabled:opacity-50"
              disabled={!hasCompiledM4b || Boolean(activeBuildJob) || loading}
              onClick={() => void onDeleteAudiobookExport()}
            >
              <FileX className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{t("audio.deleteM4b")}</span>
            </button>
          </section>

          <GenerationControls config={config} t={t} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <ChapterList
              chapters={chapters}
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
              onSelectAll={() => setSelectedChapters(new Set(chapters.map((chapter) => chapter.id)))}
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
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                className="inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-md border bg-card px-3 text-sm disabled:opacity-50"
                disabled={loading || Boolean(activeBuildJob) || !audiobook?.chaptersReady}
                onClick={onRebuildAudiobook}
              >
                <RefreshCw className={`h-4 w-4 shrink-0 ${activeBuildJob ? "animate-spin" : ""}`} aria-hidden="true" />
                <span className="truncate">{activeBuildJob ? t("audio.m4bBuilding") : t("audio.rebuild")}</span>
              </button>
              <button
                className="inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-md border bg-card px-3 text-sm disabled:opacity-50"
                disabled={loading || Boolean(activeBuildJob) || !(audiobook?.assetId ?? audiobook?.draftAssetId)}
                onClick={onSaveAudiobook}
              >
                <Save className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{t("audio.saveExport")}</span>
              </button>
            </div>
            <div className="rounded-md border bg-card p-3 text-xs text-muted-foreground">
              <p>
                {activeBuildJob
                  ? t("audio.m4bBuildProgress", {
                      progress: buildProgress,
                      status: t(`audio.m4bBuildStatus.${activeBuildJob.status}`)
                    })
                  : waitingForAudioBeforeM4b
                    ? t("audio.m4bWaitingForAudio")
                    : audiobook?.draftAssetId
                      ? t("audio.partialReady")
                      : t("audio.partialPending")}
              </p>
              {activeBuildJob ? (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${buildProgress}%` }} />
                </div>
              ) : null}
            </div>
          </section>

          <JobQueue
            jobs={jobs}
            loading={loading}
            t={t}
            describeJob={(job) => ({ title: chapterTitleFor(chapters, job.chapterHref) })}
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
  chaptersTotal,
  t,
  onBack
}: {
  audiobook: AudiobookExport | null
  book: BookDetails | null
  chaptersTotal: number
  t: TranslationFn
  onBack: () => void
}) {
  const ready = audiobook?.chaptersReady ?? 0
  const total = audiobook?.chaptersTotal || chaptersTotal
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

function chapterTitleFor(chapters: Array<{ id: string; title: string }>, chapterHref: string): string {
  return chapters.find((chapter) => chapter.id === chapterHref)?.title ?? chapterHref
}
