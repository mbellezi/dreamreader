import { ChevronDown, ChevronRight, RotateCcw, Trash2, Wand2 } from "lucide-react"
import { ChapterStatusBadge } from "@renderer/components/audio/ChapterStatusBadge"
import { GenerationProgress } from "@renderer/components/audio/GenerationProgress"
import type { TranslationFn } from "@renderer/app/types"
import type { ChapterAudioStatus } from "@renderer/lib/chapterStatus"
import { cn } from "@renderer/lib/utils"
import type { AudiobookChapter, Chapter, TtsJob, TtsSegment } from "@renderer/types"

export function ChapterRow({
  chapter,
  status,
  manifestChapter,
  active,
  expanded,
  selected,
  canGenerate,
  loading,
  hasActiveJob,
  hasGeneration,
  currentJob,
  t,
  onSelect,
  onToggleSelected,
  onGenerate,
  onClear,
  onCancelJob,
  onListSegments,
  onPauseJob,
  onRegenerateSegment,
  onResumeJob,
  onRetryJob
}: {
  chapter: Chapter
  status: ChapterAudioStatus
  manifestChapter?: AudiobookChapter
  active: boolean
  expanded: boolean
  selected: boolean
  canGenerate: boolean
  loading: boolean
  hasActiveJob: boolean
  hasGeneration: boolean
  currentJob?: TtsJob
  t: TranslationFn
  onSelect: () => void
  onToggleSelected: (checked: boolean) => void
  onGenerate: () => void
  onClear: () => void
  onCancelJob: (jobId: string) => Promise<void> | void
  onListSegments: (jobId: string) => Promise<TtsSegment[]>
  onPauseJob: (jobId: string) => Promise<void> | void
  onRegenerateSegment: (input: { segmentId: string; text: string }) => Promise<TtsSegment>
  onResumeJob: (jobId: string) => Promise<void> | void
  onRetryJob: (jobId: string) => Promise<void> | void
}) {
  const canRetry = currentJob?.status === "failed" || currentJob?.status === "cancelled"

  return (
    <div
      className={cn(
        "rounded-md border bg-card p-3 transition",
        active ? "border-primary ring-2 ring-primary/15" : "hover:border-muted-foreground/40"
      )}
    >
      <div className="flex items-center gap-3">
        <button
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          type="button"
          aria-expanded={expanded}
          onClick={onSelect}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
        <input
          className="h-4 w-4 shrink-0 accent-primary"
          type="checkbox"
          aria-label={chapter.title}
          checked={selected}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onToggleSelected(event.target.checked)}
        />
        <button
          className="min-w-0 flex-1 text-left"
          type="button"
          onClick={onSelect}
        >
          <p className="truncate text-sm font-medium">{chapter.title}</p>
        </button>
        <ChapterStatusBadge status={status} t={t} />
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            disabled={!canGenerate || hasActiveJob || loading}
            title={status.kind === "ready" ? t("audio.regenerate") : t("audio.generate")}
            onClick={onGenerate}
          >
            <Wand2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="hidden sm:inline">{status.kind === "ready" ? t("audio.regenerate") : t("audio.generate")}</span>
          </button>
          {hasGeneration ? (
            <button
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-background text-muted-foreground hover:text-destructive disabled:opacity-50"
              disabled={hasActiveJob || loading}
              title={t("audio.clearChapterGeneration")}
              onClick={onClear}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
          {canRetry ? (
            <button
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-background text-muted-foreground hover:text-primary disabled:opacity-50"
              disabled={loading}
              title={t("audio.retry")}
              onClick={() => currentJob && onRetryJob(currentJob.id)}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {status.kind === "generating" || status.kind === "queued" ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary" style={{ width: `${Math.round((status.progress ?? 0) * 100)}%` }} />
        </div>
      ) : null}

      {status.kind === "ready" && manifestChapter ? (
        <audio
          className="mt-2 w-full"
          controls
          preload="none"
          src={`dreamreader://asset/${encodeURIComponent(manifestChapter.audioAssetId)}`}
        />
      ) : null}

      {expanded && currentJob ? (
        <GenerationProgress
          job={currentJob}
          t={t}
          onCancel={onCancelJob}
          onListSegments={onListSegments}
          onPause={onPauseJob}
          onRegenerateSegment={onRegenerateSegment}
          onResume={onResumeJob}
        />
      ) : null}
    </div>
  )
}
