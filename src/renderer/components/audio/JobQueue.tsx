import { Pause, Play, RotateCcw, Square, Trash2 } from "lucide-react"
import { useMemo } from "react"
import type { TranslationFn } from "@renderer/app/types"
import { activeJobCount, audioProgressForJob, hasClearableTerminalJob, isActiveJob, isTerminalJobStatus } from "@renderer/lib/jobQueue"
import { cn } from "@renderer/lib/utils"
import type { TtsJob } from "@renderer/types"

export function JobQueue({
  jobs,
  loading,
  t,
  describeJob,
  onCancelJob,
  onPauseJob,
  onResumeJob,
  onRetryJob,
  onClearFinished
}: {
  jobs: TtsJob[]
  loading: boolean
  t: TranslationFn
  describeJob: (job: TtsJob) => { title: string; subtitle?: string }
  onCancelJob: (jobId: string) => Promise<void> | void
  onPauseJob: (jobId: string) => Promise<void> | void
  onResumeJob: (jobId: string) => Promise<void> | void
  onRetryJob: (jobId: string) => Promise<void> | void
  onClearFinished: () => Promise<void> | void
}) {
  const sortedJobs = useMemo(() => [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [jobs])
  const activeCount = activeJobCount(jobs)
  const showClearFinished = hasClearableTerminalJob(jobs)

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{t("studio.queue.title")}</h2>
          <span className="text-xs text-muted-foreground">{t("studio.queue.activeCount", { count: activeCount })}</span>
        </div>
        {showClearFinished ? (
          <button
            className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md border bg-card px-2.5 text-xs"
            disabled={loading}
            onClick={onClearFinished}
          >
            <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{t("audio.clearFinishedQueue")}</span>
          </button>
        ) : null}
      </div>

      {sortedJobs.length ? (
        <div className="space-y-2">
          {sortedJobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              t={t}
              describeJob={describeJob}
              onCancelJob={onCancelJob}
              onPauseJob={onPauseJob}
              onResumeJob={onResumeJob}
              onRetryJob={onRetryJob}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-md border bg-card p-3 text-sm text-muted-foreground">{t("studio.queue.empty")}</div>
      )}
    </section>
  )
}

function JobRow({
  job,
  t,
  describeJob,
  onCancelJob,
  onPauseJob,
  onResumeJob,
  onRetryJob
}: {
  job: TtsJob
  t: TranslationFn
  describeJob: (job: TtsJob) => { title: string; subtitle?: string }
  onCancelJob: (jobId: string) => Promise<void> | void
  onPauseJob: (jobId: string) => Promise<void> | void
  onResumeJob: (jobId: string) => Promise<void> | void
  onRetryJob: (jobId: string) => Promise<void> | void
}) {
  const { title, subtitle } = describeJob(job)
  const active = isActiveJob(job)
  const paused = job.status === "paused"
  const terminal = isTerminalJobStatus(job.status)
  const canRetry = job.status === "failed" || job.status === "cancelled"
  const audioProgressPercent = Math.round(audioProgressForJob(job) * 100)

  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{title}</p>
          {subtitle ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className={cn("text-xs", job.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
            {t(`audio.jobStatus.${job.status}`)}
          </span>
          <div className="flex items-center gap-1.5">
            {active ? (
              <>
                <QueueButton icon={Pause} label={t("audio.pause")} onClick={() => onPauseJob(job.id)} />
                <QueueButton icon={Square} label={t("audio.cancel")} onClick={() => onCancelJob(job.id)} />
              </>
            ) : null}
            {paused ? (
              <>
                <QueueButton icon={Play} label={t("audio.resume")} onClick={() => onResumeJob(job.id)} />
                <QueueButton icon={Square} label={t("audio.cancel")} onClick={() => onCancelJob(job.id)} />
              </>
            ) : null}
            {terminal && canRetry ? <QueueButton icon={RotateCcw} label={t("audio.retry")} onClick={() => onRetryJob(job.id)} /> : null}
          </div>
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${audioProgressPercent}%` }} />
      </div>
    </div>
  )
}

function QueueButton({
  icon: Icon,
  label,
  onClick
}: {
  icon: typeof Square
  label: string
  onClick: () => void
}) {
  return (
    <button className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs" onClick={onClick}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </button>
  )
}
