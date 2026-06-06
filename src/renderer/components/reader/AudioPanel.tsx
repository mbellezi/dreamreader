import { Cpu, Download, HardDrive, RefreshCw, RotateCcw, Square, Volume2, Wand2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { SelectField } from "@renderer/components/common/Controls"
import type { TranslationFn } from "@renderer/app/types"
import { cn } from "@renderer/lib/utils"
import type { AudiobookExport, BookDetails, RuntimeDiagnostic, RuntimeModel, TtsJob, VoiceProfile } from "@renderer/types"

const defaultEngineId = "dreamreader-local-tts"

export function AudioPanel({
  audiobook,
  book,
  chapterIndex,
  diagnostics,
  jobs,
  loading,
  models,
  t,
  voices,
  onCancelJob,
  onDownloadModel,
  onGenerateChapter,
  onRebuildAudiobook,
  onRetryJob,
  onToggleAutoBuild
}: {
  audiobook: AudiobookExport | null
  book: BookDetails | null
  chapterIndex: number
  diagnostics: RuntimeDiagnostic[]
  jobs: TtsJob[]
  loading: boolean
  models: RuntimeModel[]
  t: TranslationFn
  voices: VoiceProfile[]
  onCancelJob: (jobId: string) => Promise<void> | void
  onDownloadModel: (modelId: string) => Promise<void> | void
  onGenerateChapter: (input: {
    engineId: string
    quality: "draft" | "standard" | "high"
    useExpressiveNarration: boolean
    voiceProfileId?: string
  }) => Promise<void> | void
  onRebuildAudiobook: () => Promise<void> | void
  onRetryJob: (jobId: string) => Promise<void> | void
  onToggleAutoBuild: (enabled: boolean) => Promise<void> | void
}) {
  const [quality, setQuality] = useState<"draft" | "standard" | "high">("standard")
  const [selectedEngineId, setSelectedEngineId] = useState(defaultEngineId)
  const [selectedVoiceId, setSelectedVoiceId] = useState("")
  const [useExpressiveNarration, setUseExpressiveNarration] = useState(false)
  const chapter = book?.chapters[chapterIndex] ?? null
  const chapterAudio = useMemo(
    () => audiobook?.manifest?.chapters.find((item) => item.chapterHref === chapter?.id),
    [audiobook?.manifest?.chapters, chapter?.id]
  )
  const currentJob = useMemo(
    () =>
      [...jobs]
        .filter((job) => job.chapterHref === chapter?.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0],
    [chapter?.id, jobs]
  )
  const activeJob = currentJob && !["completed", "failed", "cancelled"].includes(currentJob.status) ? currentJob : null
  const canRetry = currentJob?.status === "failed" || currentJob?.status === "cancelled"
  const neutralComparisonJob = comparisonJobFor(jobs, chapter?.id, false)
  const expressiveComparisonJob = comparisonJobFor(jobs, chapter?.id, true)
  const engineOptions = useMemo(() => {
    const installedTtsModels = models.filter((model) => model.kind === "tts" && model.installStatus === "available" && model.engineId)
    return [
      { label: t("audio.engine.local"), value: defaultEngineId },
      ...installedTtsModels.map((model) => ({
        label: model.name,
        value: model.engineId ?? model.id
      }))
    ]
  }, [models, t])

  useEffect(() => {
    if (!selectedVoiceId && voices[0]) {
      setSelectedVoiceId(voices[0].id)
    }
  }, [selectedVoiceId, voices])

  useEffect(() => {
    if (!engineOptions.some((option) => option.value === selectedEngineId)) {
      setSelectedEngineId(defaultEngineId)
    }
  }, [engineOptions, selectedEngineId])

  if (!book || !chapter) {
    return <p className="rounded-md border bg-card p-3 text-sm text-muted-foreground">{t("audio.noChapter")}</p>
  }

  return (
    <div className="h-full min-h-0 space-y-4 overflow-auto pr-1">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{t("audio.title")}</h2>
          <span className="text-xs text-muted-foreground">
            {t("audio.chapterCount", {
              ready: audiobook?.chaptersReady ?? 0,
              total: audiobook?.chaptersTotal || book.chapters.length
            })}
          </span>
        </div>

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
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{t(`audio.jobStatus.${currentJob.status}`)}</span>
                <span>{Math.round(currentJob.progress * 100)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary" style={{ width: `${Math.round(currentJob.progress * 100)}%` }} />
              </div>
              {currentJob.errorMessage ? <p className="mt-2 text-xs text-destructive">{currentJob.errorMessage}</p> : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="space-y-3">
        <SelectField
          label={t("audio.engine")}
          options={engineOptions}
          value={selectedEngineId}
          onChange={setSelectedEngineId}
        />
        <SelectField
          label={t("audio.voice")}
          options={(voices.length ? voices : [{ id: "", name: t("audio.voiceDefault"), language: "pt-BR", kind: "built_in" }]).map((voice) => ({
            label: voice.name,
            value: voice.id
          }))}
          value={selectedVoiceId}
          onChange={setSelectedVoiceId}
        />
        <SelectField
          label={t("audio.quality")}
          options={["draft", "standard", "high"].map((item) => ({
            label: t(`audio.quality.${item}`),
            value: item
          }))}
          value={quality}
          onChange={(value) => setQuality(value as "draft" | "standard" | "high")}
        />
        <label className="flex items-center justify-between rounded-md border bg-card p-3 text-sm">
          <span>{t("audio.expressive")}</span>
          <input
            className="h-4 w-4 accent-primary"
            type="checkbox"
            checked={useExpressiveNarration}
            onChange={(event) => setUseExpressiveNarration(event.target.checked)}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            className="inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
            disabled={Boolean(activeJob) || loading}
            onClick={() =>
              onGenerateChapter({
                engineId: selectedEngineId,
                quality,
                useExpressiveNarration,
                voiceProfileId: selectedVoiceId || undefined
              })
            }
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
            <button className="inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-md border bg-card px-3 text-sm" disabled={!canRetry} onClick={() => currentJob && onRetryJob(currentJob.id)}>
              <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{t("audio.retry")}</span>
            </button>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t("audio.models")}</h3>
        {models.length ? (
          <div className="space-y-2">
            {models.map((model) => (
              <ModelCard key={model.id} model={model} t={t} onDownloadModel={onDownloadModel} />
            ))}
          </div>
        ) : (
          <p className="rounded-md border bg-card p-3 text-sm text-muted-foreground">{t("audio.models.empty")}</p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t("audio.comparison")}</h3>
        <div className="grid grid-cols-1 gap-2">
          <ComparisonCard job={neutralComparisonJob} label={t("audio.comparison.neutral")} t={t} />
          <ComparisonCard job={expressiveComparisonJob} label={t("audio.comparison.expressive")} t={t} />
        </div>
      </section>

      <section className="space-y-3">
        <label className="flex items-center justify-between rounded-md border bg-card p-3 text-sm">
          <span>{t("audio.autoBuild")}</span>
          <input
            className="h-4 w-4 accent-primary"
            type="checkbox"
            checked={Boolean(audiobook?.autoBuildEnabled)}
            onChange={(event) => onToggleAutoBuild(event.target.checked)}
          />
        </label>
        <button className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border bg-card px-3 text-sm" disabled={!audiobook?.chaptersReady} onClick={onRebuildAudiobook}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {t("audio.rebuild")}
        </button>
        <p className="rounded-md border bg-card p-3 text-xs text-muted-foreground">
          {audiobook?.draftAssetId ? t("audio.partialReady") : t("audio.partialPending")}
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t("audio.queue")}</h3>
        {jobs.length ? (
          jobs
            .slice()
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((job) => (
              <div key={job.id} className="rounded-md border bg-card p-3">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate">{chapterTitleFor(book, job.chapterHref)}</span>
                  <span className={cn("shrink-0 text-muted-foreground", job.status === "failed" && "text-destructive")}>{t(`audio.jobStatus.${job.status}`)}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary" style={{ width: `${Math.round(job.progress * 100)}%` }} />
                </div>
              </div>
            ))
        ) : (
          <p className="rounded-md border bg-card p-3 text-sm text-muted-foreground">{t("audio.emptyQueue")}</p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t("audio.diagnostics")}</h3>
        {diagnostics.map((diagnostic) => (
          <div key={diagnostic.id} className="rounded-md border bg-card p-3">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-medium">{diagnosticLabel(diagnostic, t)}</span>
              <span className={diagnostic.status === "available" ? "text-primary" : "text-muted-foreground"}>
                {t(`audio.diagnosticStatus.${diagnostic.status}`)}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{diagnosticDetail(diagnostic, t)}</p>
          </div>
        ))}
      </section>
    </div>
  )
}

function ModelCard({
  model,
  t,
  onDownloadModel
}: {
  model: RuntimeModel
  t: TranslationFn
  onDownloadModel: (modelId: string) => Promise<void> | void
}) {
  const isDownloading = model.installStatus === "queued" || model.installStatus === "downloading"
  const canDownload = model.canDownload && !isDownloading && model.installStatus !== "available"
  const progress = Math.round(model.downloadProgress * 100)

  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {model.kind === "tts" ? (
              <Volume2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : (
              <Cpu className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <p className="truncate text-sm font-medium">{model.name}</p>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {t(`audio.modelKind.${model.kind}`)} · {model.runtime} · {model.format}
          </p>
        </div>
        <span className={cn("shrink-0 text-xs", model.installStatus === "available" ? "text-primary" : model.installStatus === "failed" ? "text-destructive" : "text-muted-foreground")}>
          {t(`audio.modelStatus.${model.installStatus}`)}
        </span>
      </div>

      {isDownloading ? (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t("audio.model.progress")}</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : null}

      {model.installStatus === "available" && model.path ? (
        <p className="mt-2 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          <HardDrive className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{model.path}</span>
        </p>
      ) : null}

      {model.installStatus !== "available" && !model.canDownload ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("audio.model.localInstallHint")}</p>
      ) : null}

      {canDownload ? (
        <button
          className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm"
          onClick={() => onDownloadModel(model.id)}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          {t(model.installStatus === "failed" ? "audio.model.retryDownload" : "audio.model.download")}
        </button>
      ) : null}
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

function diagnosticLabel(diagnostic: RuntimeDiagnostic, t: TranslationFn): string {
  return translatedOrFallback(t, `audio.diagnostic.${diagnostic.id}.label`, diagnostic.label)
}

function diagnosticDetail(diagnostic: RuntimeDiagnostic, t: TranslationFn): string {
  if (diagnostic.id === "apple-silicon") {
    return t(`audio.diagnostic.apple-silicon.detail.${diagnostic.status === "available" ? "available" : "fallback"}`)
  }
  return translatedOrFallback(t, `audio.diagnostic.${diagnostic.id}.detail`, diagnostic.detail, { detail: diagnostic.detail })
}

function translatedOrFallback(
  t: TranslationFn,
  key: string,
  fallback: string,
  values?: Record<string, string | number>
): string {
  const value = t(key, values)
  return value === key ? fallback : value
}

function chapterTitleFor(book: BookDetails, chapterHref: string): string {
  return book.chapters.find((chapter) => chapter.id === chapterHref)?.title ?? chapterHref
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, "0")
  return `${minutes}:${seconds}`
}
