import { ChevronDown, ChevronRight, RotateCcw, Square, Trash2, Volume2, Wand2 } from "lucide-react"
import { useMemo, useState } from "react"
import { GenerationProgress } from "@renderer/components/audio/GenerationProgress"
import type { TranslationFn } from "@renderer/app/types"
import { isPartialTtsJob, isTerminalJobStatus } from "@renderer/lib/jobQueue"
import { formatDuration } from "@renderer/lib/formatDuration"
import type { AudiobookExport, Chapter, TtsJob, TtsSegment } from "@renderer/types"

export function ChapterDetail({
  chapter,
  audiobook,
  jobs,
  loading,
  canGenerate,
  t,
  onGenerateChapter,
  onGeneratePreview,
  onClearChapterAudio,
  onCancelJob,
  onListSegments,
  onPauseJob,
  onResumeJob,
  onRetryJob
}: {
  chapter: Chapter | null
  audiobook: AudiobookExport | null
  jobs: TtsJob[]
  loading: boolean
  canGenerate: boolean
  t: TranslationFn
  onGenerateChapter: (chapterId: string) => void
  onGeneratePreview: (chapterId: string, paragraphLimit: number) => void
  onClearChapterAudio: (chapterId: string) => Promise<void> | void
  onCancelJob: (jobId: string) => Promise<void> | void
  onListSegments: (jobId: string) => Promise<TtsSegment[]>
  onPauseJob: (jobId: string) => Promise<void> | void
  onResumeJob: (jobId: string) => Promise<void> | void
  onRetryJob: (jobId: string) => Promise<void> | void
}) {
  const chapterAudio = useMemo(
    () => audiobook?.manifest?.chapters.find((item) => item.chapterHref === chapter?.id),
    [audiobook?.manifest?.chapters, chapter?.id]
  )
  const chapterJobs = useMemo(() => jobs.filter((job) => job.chapterHref === chapter?.id), [chapter?.id, jobs])
  const currentJob = useMemo(() => [...chapterJobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0], [chapterJobs])
  const activeJob = chapterJobs.find((job) => !isTerminalJobStatus(job.status)) ?? null
  const canRetry = currentJob?.status === "failed" || currentJob?.status === "cancelled"
  const hasChapterGeneration = Boolean(chapterAudio || chapterJobs.length)
  const neutralComparisonJob = comparisonJobFor(jobs, chapter?.id, false)
  const expressiveComparisonJob = comparisonJobFor(jobs, chapter?.id, true)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [previewParagraphs, setPreviewParagraphs] = useState(3)

  if (!chapter) {
    return <p className="rounded-md border bg-card p-3 text-sm text-muted-foreground">{t("studio.chapter.empty")}</p>
  }

  return (
    <div className="space-y-4">
      <section className="space-y-3">
        <div className="rounded-md border bg-card p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{chapter.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {chapterAudio ? t("audio.chapterReady", { duration: formatDuration(chapterAudio.durationMs) }) : t("audio.chapterMissing")}
              </p>
            </div>
            <Volume2 className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </div>

          {chapterAudio ? (
            <audio className="mt-3 w-full" controls preload="metadata" src={`dreamreader://asset/${encodeURIComponent(chapterAudio.audioAssetId)}`} />
          ) : null}

          {currentJob ? (
            <GenerationProgress
              job={currentJob}
              t={t}
              onCancel={onCancelJob}
              onListSegments={onListSegments}
              onPause={onPauseJob}
              onResume={onResumeJob}
            />
          ) : null}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              className="inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
              disabled={Boolean(activeJob) || loading || !canGenerate}
              onClick={() => onGenerateChapter(chapter.id)}
            >
              <Wand2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{chapterAudio ? t("audio.regenerate") : t("audio.generate")}</span>
            </button>
            {activeJob ? (
              <button className="inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-md border bg-card px-3 text-sm" onClick={() => onCancelJob(activeJob.id)}>
                <Square className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{t("audio.cancel")}</span>
              </button>
            ) : (
              <button className="inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-md border bg-card px-3 text-sm disabled:opacity-50" disabled={!canRetry} onClick={() => currentJob && onRetryJob(currentJob.id)}>
                <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{t("audio.retry")}</span>
              </button>
            )}
          </div>

          {hasChapterGeneration ? (
            <button
              className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm disabled:opacity-50"
              disabled={Boolean(activeJob) || loading}
              onClick={() => onClearChapterAudio(chapter.id)}
            >
              <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{t("audio.clearChapterGeneration")}</span>
            </button>
          ) : null}
        </div>
      </section>

      <section className="space-y-3">
        <button
          className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          {advancedOpen ? (
            <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span>{t("studio.advanced")}</span>
        </button>

        {advancedOpen ? (
          <div className="space-y-4">
            <div className="space-y-2 rounded-md border bg-card p-3">
              <label className="block text-sm">
                <span className="mb-2 block text-xs font-medium text-muted-foreground">{t("audio.scope.paragraphs")}</span>
                <input
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none"
                  type="number"
                  min={1}
                  value={previewParagraphs}
                  onChange={(event) => setPreviewParagraphs(Math.max(1, Math.floor(Number(event.target.value) || 1)))}
                />
                <span className="mt-1 block text-xs text-muted-foreground">{t("audio.scope.partialHint")}</span>
              </label>
              <button
                className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm disabled:opacity-50"
                disabled={Boolean(activeJob) || loading || !canGenerate}
                onClick={() => onGeneratePreview(chapter.id, previewParagraphs)}
              >
                <Wand2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{t("studio.preview.generate")}</span>
              </button>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{t("audio.comparison")}</h3>
              <div className="grid grid-cols-1 gap-2">
                <ComparisonCard job={neutralComparisonJob} label={t("audio.comparison.neutral")} t={t} />
                <ComparisonCard job={expressiveComparisonJob} label={t("audio.comparison.expressive")} t={t} />
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function ComparisonCard({ job, label, t }: { job?: TtsJob; label: string; t: TranslationFn }) {
  const audioAssetId = jobAudioAssetId(job)
  const durationMs = jobDurationMs(job)
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{label}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {audioAssetId ? t("audio.comparison.ready", { duration: formatDuration(durationMs ?? 0) }) : t("audio.comparison.empty")}
          </p>
        </div>
        {Number(job?.settings.prosodyFallbackCount ?? 0) > 0 ? (
          <span className="shrink-0 rounded-sm bg-muted px-2 py-1 text-[11px] text-muted-foreground">{t("audio.comparison.fallback")}</span>
        ) : null}
      </div>
      {audioAssetId ? (
        <audio className="mt-3 w-full" controls preload="metadata" src={`dreamreader://asset/${encodeURIComponent(audioAssetId)}`} />
      ) : null}
    </div>
  )
}

function comparisonJobFor(jobs: TtsJob[], chapterHref: string | undefined, expressive: boolean): TtsJob | undefined {
  return jobs
    .filter((job) => {
      return (
        job.chapterHref === chapterHref &&
        job.status === "completed" &&
        !isPartialTtsJob(job) &&
        Boolean(job.settings.useExpressiveNarration) === expressive &&
        Boolean(jobAudioAssetId(job))
      )
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
}

function jobAudioAssetId(job: TtsJob | undefined): string | undefined {
  return typeof job?.settings.chapterAudioAssetId === "string" ? job.settings.chapterAudioAssetId : undefined
}

function jobDurationMs(job: TtsJob | undefined): number | undefined {
  return typeof job?.settings.chapterDurationMs === "number" ? job.settings.chapterDurationMs : undefined
}
