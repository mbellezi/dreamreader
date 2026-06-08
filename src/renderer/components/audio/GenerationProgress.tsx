import { Pause, Play, Square } from "lucide-react"
import { useEffect, useState } from "react"
import type { TranslationFn } from "@renderer/app/types"
import { cn } from "@renderer/lib/utils"
import type { TtsJob, TtsSegment } from "@renderer/types"

const TERMINAL_JOB_STATUSES = ["completed", "failed", "cancelled"]

export function GenerationProgress({
  job,
  t,
  onCancel,
  onListSegments,
  onPause,
  onResume
}: {
  job: TtsJob
  t: TranslationFn
  onCancel: (jobId: string) => Promise<void> | void
  onListSegments: (jobId: string) => Promise<TtsSegment[]>
  onPause: (jobId: string) => Promise<void> | void
  onResume: (jobId: string) => Promise<void> | void
}) {
  const [segments, setSegments] = useState<TtsSegment[]>([])
  const isTerminal = TERMINAL_JOB_STATUSES.includes(job.status)
  const isPaused = job.status === "paused"

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const next = await onListSegments(job.id)
      if (!cancelled) {
        setSegments(next)
      }
    }
    void load()
    if (isTerminal || isPaused) {
      return () => {
        cancelled = true
      }
    }
    const interval = window.setInterval(() => void load(), 600)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [isPaused, isTerminal, job.id, onListSegments])

  const completedCount = segments.filter((segment) => segment.status === "completed").length

  return (
    <div className="mt-3 space-y-3">
      <div>
        <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{t(`audio.jobStatus.${job.status}`)}</span>
          <span>{Math.round(job.progress * 100)}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full", isPaused ? "bg-amber-500" : "bg-primary")}
            style={{ width: `${Math.round(job.progress * 100)}%` }}
          />
        </div>
        {job.errorMessage ? <p className="mt-2 text-xs text-destructive">{job.errorMessage}</p> : null}
      </div>

      {!isTerminal ? (
        <div className="grid grid-cols-2 gap-2">
          {isPaused ? (
            <button
              className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm"
              onClick={() => onResume(job.id)}
            >
              <Play className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{t("audio.resume")}</span>
            </button>
          ) : (
            <button
              className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm"
              onClick={() => onPause(job.id)}
            >
              <Pause className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{t("audio.pause")}</span>
            </button>
          )}
          <button
            className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm"
            onClick={() => onCancel(job.id)}
          >
            <Square className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{t("audio.cancel")}</span>
          </button>
        </div>
      ) : null}

      {segments.length ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t("audio.segments", { ready: completedCount, total: segments.length })}
          </p>
          <div className="max-h-72 space-y-2 overflow-auto pr-1">
            {segments.map((segment) => (
              <div key={segment.id} className="rounded-md border bg-background p-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-muted-foreground">
                    {t("audio.segment.index", { index: segment.segmentIndex + 1 })}
                  </span>
                  <span className={cn("shrink-0", segment.status === "completed" ? "text-primary" : "text-muted-foreground")}>
                    {t(`audio.segmentStatus.${segment.status}`)}
                  </span>
                </div>
                {segment.textPreview ? <p className="mt-1 line-clamp-2 text-xs">{segment.textPreview}</p> : null}
                {segment.audioAssetId ? (
                  <audio
                    className="mt-2 w-full"
                    controls
                    preload="none"
                    src={`dreamreader://asset/${encodeURIComponent(segment.audioAssetId)}`}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
