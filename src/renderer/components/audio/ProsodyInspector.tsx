import { AlertTriangle, ChevronDown, ChevronRight, Sparkles } from "lucide-react"
import { useEffect, useState } from "react"
import type { TranslationFn } from "@renderer/app/types"
import {
  emotionChipClass,
  intensityPercent,
  type ProsodyEngineSupport,
  prosodyEngineSupport,
  summarizeProsody
} from "@renderer/lib/prosody"
import { cn } from "@renderer/lib/utils"
import type { TtsJob, TtsSegment } from "@renderer/types"

const TERMINAL_JOB_STATUSES = ["completed", "failed", "cancelled"]

export function ProsodyInspector({
  job,
  t,
  onListSegments
}: {
  job: TtsJob | undefined
  t: TranslationFn
  onListSegments: (jobId: string) => Promise<TtsSegment[]>
}) {
  const [segments, setSegments] = useState<TtsSegment[]>([])
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)
  const jobId = job?.id
  const isLive = job ? !TERMINAL_JOB_STATUSES.includes(job.status) : false

  useEffect(() => {
    setOpen(false)
    setSegments([])
    setLoaded(false)
  }, [jobId])

  useEffect(() => {
    if (!open || !jobId) {
      setSegments([])
      setLoaded(false)
      return
    }
    let cancelled = false
    const load = async () => {
      const next = await onListSegments(jobId)
      if (!cancelled) {
        setSegments(next)
        setLoaded(true)
      }
    }
    void load()
    if (!isLive) {
      return () => {
        cancelled = true
      }
    }
    const interval = window.setInterval(() => void load(), 700)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [isLive, jobId, onListSegments, open])

  const analyzerId = job && typeof job.settings.prosodyAnalyzerId === "string" ? job.settings.prosodyAnalyzerId : undefined
  const support = prosodyEngineSupport(job?.engineId)
  const counts = summarizeProsody(segments)
  const prosodySegments = segments.filter((segment) => segment.prosody)

  return (
    <div className="space-y-3">
      <button
        className="flex w-full items-center justify-between gap-3 rounded-md border bg-card p-3 text-left"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold">
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate">{t("studio.prosody.title")}</span>
        </span>
        {analyzerId ? <span className="truncate text-[11px] text-muted-foreground">{t("studio.prosody.analyzer", { id: analyzerId })}</span> : null}
      </button>

      {open && !job ? (
        <p className="rounded-md border bg-card p-3 text-sm text-muted-foreground">{t("studio.prosody.empty")}</p>
      ) : null}

      {open && job ? (
        <div
          className={cn(
            "flex items-start gap-2 rounded-md border p-3 text-xs",
            support === "reference" ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-card text-muted-foreground"
          )}
        >
          {support === "reference" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : null}
          <span>{t(`studio.prosody.engineSupport.${support}`)}</span>
        </div>
      ) : null}

      {open && loaded && prosodySegments.length === 0 ? (
        <p className="rounded-md border bg-card p-3 text-sm text-muted-foreground">{t("studio.prosody.noSegments")}</p>
      ) : null}

      {open && prosodySegments.length ? (
        <>
          <p className="text-xs text-muted-foreground">
            {t("studio.prosody.summary", {
              total: counts.segments,
              emotional: counts.emotionalSegments,
              instruction: counts.withInstruction
            })}
          </p>
          <div className="max-h-80 space-y-2 overflow-auto pr-1">
            {prosodySegments.map((segment) => (
              <ProsodySegmentCard key={segment.id} segment={segment} support={support} t={t} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

function ProsodySegmentCard({
  segment,
  support,
  t
}: {
  segment: TtsSegment
  support: ProsodyEngineSupport
  t: TranslationFn
}) {
  const prosody = segment.prosody
  if (!prosody) {
    return null
  }
  const intensity = intensityPercent(prosody.intensity)

  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">#{segment.segmentIndex + 1}</span>
        <span className={cn("rounded-sm px-2 py-0.5 text-[11px] font-medium", emotionChipClass(prosody.emotion))}>
          {t(`studio.prosody.emotion.${prosody.emotion}`)}
        </span>
      </div>

      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{segment.textPreview}</p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>{t("studio.prosody.pace")}: {t(`studio.prosody.pace.${prosody.pace}`)}</span>
        <span>{t("studio.prosody.pitch")}: {t(`studio.prosody.pitch.${prosody.pitch}`)}</span>
        <span>{t("studio.prosody.pause")}: {prosody.pauseAfterMs} ms</span>
      </div>

      <div className="mt-2">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{t("studio.prosody.intensity")}</span>
          <span>{intensity}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary" style={{ width: `${intensity}%` }} />
        </div>
      </div>

      {prosody.instructionPtBr.trim() ? (
        <p
          className={cn(
            "mt-2 rounded-sm bg-background px-2 py-1 text-xs",
            support !== "instruction" && "text-muted-foreground line-through decoration-muted-foreground/50"
          )}
          title={support !== "instruction" ? t(`studio.prosody.engineSupport.${support}`) : undefined}
        >
          {prosody.instructionPtBr}
        </p>
      ) : (
        <p className="mt-2 text-[11px] italic text-muted-foreground">{t("studio.prosody.noInstruction")}</p>
      )}
    </div>
  )
}
