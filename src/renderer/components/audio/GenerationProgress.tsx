import { Pause, Play, RotateCcw, Square } from "lucide-react"
import { useEffect, useState } from "react"
import type { TranslationFn } from "@renderer/app/types"
import { audioProgressForJob, isPartialTtsJob } from "@renderer/lib/jobQueue"
import { cn } from "@renderer/lib/utils"
import type { TtsJob, TtsSegment } from "@renderer/types"

const TERMINAL_JOB_STATUSES = ["completed", "failed", "cancelled"]

export function GenerationProgress({
  job,
  t,
  onCancel,
  onListSegments,
  onPause,
  onRegenerateSegment,
  onResume
}: {
  job: TtsJob
  t: TranslationFn
  onCancel: (jobId: string) => Promise<void> | void
  onListSegments: (jobId: string) => Promise<TtsSegment[]>
  onPause: (jobId: string) => Promise<void> | void
  onRegenerateSegment: (input: { segmentId: string; text: string }) => Promise<TtsSegment>
  onResume: (jobId: string) => Promise<void> | void
}) {
  const [segments, setSegments] = useState<TtsSegment[]>([])
  const isTerminal = TERMINAL_JOB_STATUSES.includes(job.status)
  const isPaused = job.status === "paused"
  const statusKeyPrefix = isPartialTtsJob(job) ? "audio.previewJobStatus" : "audio.jobStatus"
  const audioProgressPercent = Math.round(audioProgressForJob(job) * 100)

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
  const updateSegment = (updated: TtsSegment) => {
    setSegments((current) => current.map((segment) => (segment.id === updated.id ? updated : segment)))
  }

  return (
    <div className="mt-3 space-y-3">
      <div>
        <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{t(`${statusKeyPrefix}.${job.status}`)}</span>
          <span>{audioProgressPercent}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full", isPaused ? "bg-amber-500" : "bg-primary")}
            style={{ width: `${audioProgressPercent}%` }}
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
        <div className="space-y-3 rounded-md bg-muted/20 p-3">
          <p className="text-xs font-medium text-muted-foreground">
            {t("audio.segments", { ready: completedCount, total: segments.length })}
          </p>
          <div className="max-h-72 space-y-3 overflow-auto pr-1">
            {segments.map((segment) => (
              <SegmentPreviewCard
                key={segment.id}
                segment={segment}
                t={t}
                onRegenerateSegment={onRegenerateSegment}
                onSegmentUpdated={updateSegment}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function SegmentPreviewCard({
  contextLabel,
  segment,
  t,
  onRegenerateSegment,
  onSegmentUpdated
}: {
  contextLabel?: string
  segment: TtsSegment
  t: TranslationFn
  onRegenerateSegment: (input: { segmentId: string; text: string }) => Promise<TtsSegment>
  onSegmentUpdated?: (segment: TtsSegment) => void
}) {
  const [draft, setDraft] = useState(segment.text || segment.textPreview)
  const [regenerating, setRegenerating] = useState(false)

  useEffect(() => {
    setDraft(segment.text || segment.textPreview)
  }, [segment.id, segment.text, segment.textPreview])

  const regenerate = async () => {
    const text = draft.trim()
    if (!text) {
      return
    }
    setRegenerating(true)
    try {
      const updated = await onRegenerateSegment({ segmentId: segment.id, text })
      onSegmentUpdated?.(updated)
    } finally {
      setRegenerating(false)
    }
  }

  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-muted-foreground">
          {contextLabel ?? t("audio.segment.index", { index: segment.segmentIndex + 1 })}
        </span>
        <span className={cn("shrink-0", segment.status === "completed" ? "text-primary" : "text-muted-foreground")}>
          {t(`audio.segmentStatus.${segment.status}`)}
        </span>
      </div>
      <label className="mt-2 block text-xs font-medium text-muted-foreground" htmlFor={`segment-text-${segment.id}`}>
        {t("audio.segment.text")}
      </label>
      <div className="mt-1 flex items-start gap-2">
        <textarea
          id={`segment-text-${segment.id}`}
          className="min-h-20 flex-1 resize-y rounded-md border bg-card px-2.5 py-2 text-xs outline-none focus:border-primary"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-card text-muted-foreground hover:text-primary disabled:opacity-50"
          disabled={regenerating || !draft.trim()}
          title={regenerating ? t("audio.segment.regenerating") : t("audio.segment.regenerate")}
          aria-label={regenerating ? t("audio.segment.regenerating") : t("audio.segment.regenerate")}
          onClick={regenerate}
        >
          <RotateCcw className={cn("h-3.5 w-3.5", regenerating ? "animate-spin" : "")} aria-hidden="true" />
        </button>
      </div>
      {segment.audioAssetId ? (
        <audio
          className="mt-2 w-full"
          controls
          preload="none"
          src={`dreamreader://asset/${encodeURIComponent(segment.audioAssetId)}`}
        />
      ) : null}
    </div>
  )
}
