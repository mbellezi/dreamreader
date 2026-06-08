import { CircleHelp, Cpu, Download, FolderOpen, HardDrive, Pause, Play, Plus, RefreshCw, RotateCcw, SlidersHorizontal, Square, Trash2, Volume2, Wand2 } from "lucide-react"
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { SelectField } from "@renderer/components/common/Controls"
import { GenerationProgress } from "@renderer/components/audio/GenerationProgress"
import type { TranslationFn } from "@renderer/app/types"
import {
  defaultModelSettingsForEngine,
  defaultGenerationLanguageForEngine,
  generateSeed,
  languageOptionsForEngine,
  mergeModelSettingsForEngine,
  modelSettingFieldsForEngine,
  normalizeSeed,
  sanitizeModelSettingsForEngine,
  type AudioModelSettingField
} from "@renderer/lib/audioModelSettings"
import { cn } from "@renderer/lib/utils"
import type { AudioSettings, AudiobookExport, BookDetails, PronunciationEntry, RuntimeDiagnostic, RuntimeModel, TtsJob, TtsModelSettings, TtsSegment, VoiceProfile } from "@renderer/types"

const defaultEngineId = "dreamreader-local-tts"

export function AudioPanel({
  audiobook,
  audioSettings,
  book,
  chapterIndex,
  diagnostics,
  jobs,
  loading,
  models,
  pronunciationEntries,
  t,
  voices,
  onCancelJob,
  onClearChapterAudio,
  onClearTerminalJobs,
  onCreatePronunciationEntry,
  onDeletePronunciationEntry,
  onDownloadModel,
  onGenerateChapter,
  onGenerateChapters,
  onInstallModelFromPath,
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
  chapterIndex: number
  diagnostics: RuntimeDiagnostic[]
  jobs: TtsJob[]
  loading: boolean
  models: RuntimeModel[]
  pronunciationEntries: PronunciationEntry[]
  t: TranslationFn
  voices: VoiceProfile[]
  onCancelJob: (jobId: string) => Promise<void> | void
  onClearChapterAudio: (chapterHref: string) => Promise<void> | void
  onClearTerminalJobs: () => Promise<void> | void
  onCreatePronunciationEntry: (input: { pattern: string; replacement: string; scope: "global" | "book" }) => Promise<void> | void
  onDeletePronunciationEntry: (id: string) => Promise<void> | void
  onDownloadModel: (modelId: string) => Promise<void> | void
  onGenerateChapter: (input: {
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
  }) => Promise<void> | void
  onGenerateChapters: (input: {
    chapterHrefs?: string[]
    engineId: string
    generationLanguage?: string
    modelSettings?: TtsModelSettings
    quality: "draft" | "standard" | "high"
    seed?: number
    seedFixed?: boolean
    useExpressiveNarration: boolean
    voiceProfileId?: string
  }) => Promise<void> | void
  onInstallModelFromPath: () => Promise<void> | void
  onListSegments: (jobId: string) => Promise<TtsSegment[]>
  onPauseJob: (jobId: string) => Promise<void> | void
  onRebuildAudiobook: () => Promise<void> | void
  onResumeJob: (jobId: string) => Promise<void> | void
  onRetryJob: (jobId: string) => Promise<void> | void
  onToggleAutoBuild: (enabled: boolean) => Promise<void> | void
  onUpdateAudioSettings: (audioSettings: AudioSettings, delay?: number) => Promise<void> | void
}) {
  const [quality, setQuality] = useState<"draft" | "standard" | "high">("standard")
  const [generationScope, setGenerationScope] = useState<"total" | "partial">("total")
  const [paragraphCount, setParagraphCount] = useState(3)
  const [selectedChapters, setSelectedChapters] = useState<Set<string>>(new Set())
  const [selectedEngineId, setSelectedEngineId] = useState(defaultEngineId)
  const [selectedVoiceId, setSelectedVoiceId] = useState("")
  const [pronunciationPattern, setPronunciationPattern] = useState("")
  const [pronunciationReplacement, setPronunciationReplacement] = useState("")
  const [pronunciationScope, setPronunciationScope] = useState<"global" | "book">("book")
  const [useExpressiveNarration, setUseExpressiveNarration] = useState(false)
  const [modelSettingsDialogOpen, setModelSettingsDialogOpen] = useState(false)
  const [modelSettingsDraft, setModelSettingsDraft] = useState<TtsModelSettings>({})
  const chapter = book?.chapters[chapterIndex] ?? null
  const chapterAudio = useMemo(
    () => audiobook?.manifest?.chapters.find((item) => item.chapterHref === chapter?.id),
    [audiobook?.manifest?.chapters, chapter?.id]
  )
  const chapterJobs = useMemo(() => jobs.filter((job) => job.chapterHref === chapter?.id), [chapter?.id, jobs])
  const currentJob = useMemo(() => [...chapterJobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0], [chapterJobs])
  const activeJob = chapterJobs.find((job) => !isTerminalJobStatus(job.status)) ?? null
  const terminalJobs = useMemo(() => jobs.filter((job) => isTerminalJobStatus(job.status)), [jobs])
  const canRetry = currentJob?.status === "failed" || currentJob?.status === "cancelled"
  const hasChapterGeneration = Boolean(chapterAudio || chapterJobs.length)
  const neutralComparisonJob = comparisonJobFor(jobs, chapter?.id, false)
  const expressiveComparisonJob = comparisonJobFor(jobs, chapter?.id, true)
  const installedTtsModels = useMemo(
    () => models.filter((model) => model.kind === "tts" && model.installStatus === "available" && model.engineId),
    [models]
  )
  const engineOptions = useMemo(() => {
    return [
      { label: t("audio.engine.local"), value: defaultEngineId },
      ...installedTtsModels.map((model) => ({
        label: model.name,
        value: model.engineId ?? model.id
      }))
    ]
  }, [installedTtsModels, t])
  const voiceOptions = useMemo(() => {
    const compatible = voices.filter((voice) => {
      const engineIds = voice.settings?.compatibleEngineIds
      return !Array.isArray(engineIds) || engineIds.includes(selectedEngineId)
    })
    return (compatible.length ? compatible : [{ id: "", name: t("audio.voiceUnavailable"), language: "pt-BR", kind: "built_in" }]).map((voice) => ({
      label: voice.name,
      value: voice.id
    }))
  }, [selectedEngineId, t, voices])
  const hasCompatibleVoice = voiceOptions.some((option) => option.value)
  const selectedModelSettings = useMemo(
    () => mergeModelSettingsForEngine(selectedEngineId, audioSettings.modelSettingsByEngineId[selectedEngineId]),
    [audioSettings.modelSettingsByEngineId, selectedEngineId]
  )
  const modelSettingsFields = useMemo(() => modelSettingFieldsForEngine(selectedEngineId), [selectedEngineId])
  const generationLanguageOptions = useMemo(
    () =>
      languageOptionsForEngine(selectedEngineId).map((option) => ({
        label: t(option.labelKey),
        value: option.value
      })),
    [selectedEngineId, t]
  )
  const selectedGenerationLanguage =
    audioSettings.generationLanguageByEngineId[selectedEngineId] ?? defaultGenerationLanguageForEngine(selectedEngineId) ?? ""
  const generationLanguage = generationLanguageOptions.length ? selectedGenerationLanguage : undefined
  const seed = normalizeSeed(audioSettings.seed)

  const updateAudioSettingsPatch = (patch: Partial<AudioSettings>, delay = 450) => {
    onUpdateAudioSettings(
      {
        ...audioSettings,
        ...patch
      },
      delay
    )
  }

  const openModelSettings = () => {
    setModelSettingsDraft(selectedModelSettings)
    setModelSettingsDialogOpen(true)
  }

  const saveModelSettings = () => {
    onUpdateAudioSettings(
      {
        ...audioSettings,
        modelSettingsByEngineId: {
          ...audioSettings.modelSettingsByEngineId,
          [selectedEngineId]: sanitizeModelSettingsForEngine(selectedEngineId, modelSettingsDraft)
        }
      },
      0
    )
    setModelSettingsDialogOpen(false)
  }

  useEffect(() => {
    if (!selectedVoiceId && voiceOptions[0]) {
      setSelectedVoiceId(voiceOptions[0].value)
    }
  }, [selectedVoiceId, voiceOptions])

  useEffect(() => {
    if (selectedVoiceId && !voiceOptions.some((option) => option.value === selectedVoiceId)) {
      setSelectedVoiceId(voiceOptions[0]?.value ?? "")
    }
  }, [selectedVoiceId, voiceOptions])

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
            <GenerationProgress
              job={currentJob}
              t={t}
              onCancel={onCancelJob}
              onListSegments={onListSegments}
              onPause={onPauseJob}
              onResume={onResumeJob}
            />
          ) : null}

          {hasChapterGeneration ? (
            <button
              className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm"
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
        <div className="grid grid-cols-[minmax(0,1fr)_2.5rem] items-end gap-2">
          <SelectField
            label={t("audio.engine")}
            options={engineOptions}
            value={selectedEngineId}
            onChange={setSelectedEngineId}
          />
          <button
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border bg-card text-muted-foreground hover:text-foreground"
            title={t("audio.modelSettings.open")}
            onClick={openModelSettings}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <SelectField
          label={t("audio.voice")}
          options={voiceOptions}
          value={selectedVoiceId}
          onChange={setSelectedVoiceId}
        />
        <div className="space-y-3 rounded-md border bg-card p-3">
          {generationLanguageOptions.length ? (
            <SelectField
              label={t("audio.language")}
              options={generationLanguageOptions}
              value={selectedGenerationLanguage}
              onChange={(value) =>
                updateAudioSettingsPatch({
                  generationLanguageByEngineId: {
                    ...audioSettings.generationLanguageByEngineId,
                    [selectedEngineId]: value
                  }
                })
              }
            />
          ) : null}
          <div className="space-y-2">
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>{t("audio.seed.fixed")}</span>
              <input
                className="h-4 w-4 accent-primary"
                type="checkbox"
                checked={audioSettings.seedFixed}
                onChange={(event) => updateAudioSettingsPatch({ seedFixed: event.target.checked }, 0)}
              />
            </label>
            <div className="grid grid-cols-[minmax(0,1fr)_2.5rem] gap-2">
              <label className="block text-sm">
                <span className="mb-2 block text-xs font-medium text-muted-foreground">{t("audio.seed")}</span>
                <input
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none"
                  type="number"
                  min={0}
                  max={4294967295}
                  value={seed}
                  onChange={(event) => updateAudioSettingsPatch({ seed: normalizeSeed(event.target.value) })}
                />
              </label>
              <button
                className="mt-6 inline-flex h-10 w-10 items-center justify-center rounded-md border bg-background text-muted-foreground hover:text-foreground"
                title={t("audio.seed.generate")}
                onClick={() => updateAudioSettingsPatch({ seed: generateSeed() }, 0)}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
        <div className="space-y-2 rounded-md border bg-card p-3">
          <SelectField
            label={t("audio.scope")}
            options={[
              { label: t("audio.scope.total"), value: "total" },
              { label: t("audio.scope.partial"), value: "partial" }
            ]}
            value={generationScope}
            onChange={(value) => setGenerationScope(value as "total" | "partial")}
          />
          {generationScope === "partial" ? (
            <label className="block text-sm">
              <span className="mb-2 block text-xs font-medium text-muted-foreground">{t("audio.scope.paragraphs")}</span>
              <input
                className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none"
                type="number"
                min={1}
                value={paragraphCount}
                onChange={(event) => setParagraphCount(Math.max(1, Math.floor(Number(event.target.value) || 1)))}
              />
              <span className="mt-1 block text-xs text-muted-foreground">{t("audio.scope.partialHint")}</span>
            </label>
          ) : null}
        </div>
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
            disabled={Boolean(activeJob) || loading || !hasCompatibleVoice}
            onClick={() =>
              onGenerateChapter({
                chapterHref: chapter.id,
                engineId: selectedEngineId,
                generationLanguage,
                modelSettings: selectedModelSettings,
                quality,
                seed,
                seedFixed: audioSettings.seedFixed,
                useExpressiveNarration,
                voiceProfileId: selectedVoiceId || undefined,
                paragraphLimit: generationScope === "partial" ? paragraphCount : undefined
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

        <div className="space-y-3 rounded-md border bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t("audio.batch.title")}</h3>
            <div className="flex shrink-0 gap-2 text-xs">
              <button className="text-muted-foreground hover:text-foreground" onClick={() => setSelectedChapters(new Set(book.chapters.map((item) => item.id)))}>
                {t("audio.batch.selectAll")}
              </button>
              <button className="text-muted-foreground hover:text-foreground" onClick={() => setSelectedChapters(new Set())}>
                {t("audio.batch.clear")}
              </button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("audio.batch.hint")}</p>
          <div className="max-h-56 space-y-1 overflow-auto pr-1">
            {book.chapters.map((item) => (
              <label key={item.id} className="flex items-center gap-2 rounded-sm px-1 py-1 text-sm">
                <input
                  className="h-4 w-4 accent-primary"
                  type="checkbox"
                  checked={selectedChapters.has(item.id)}
                  onChange={(event) =>
                    setSelectedChapters((current) => {
                      const next = new Set(current)
                      if (event.target.checked) {
                        next.add(item.id)
                      } else {
                        next.delete(item.id)
                      }
                      return next
                    })
                  }
                />
                <span className="truncate">{item.title}</span>
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm"
              disabled={!selectedChapters.size || loading || !hasCompatibleVoice}
              onClick={() =>
                onGenerateChapters({
                  chapterHrefs: [...selectedChapters],
                  engineId: selectedEngineId,
                  generationLanguage,
                  modelSettings: selectedModelSettings,
                  quality,
                  seed,
                  seedFixed: audioSettings.seedFixed,
                  useExpressiveNarration,
                  voiceProfileId: selectedVoiceId || undefined
                })
              }
            >
              <Wand2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{t("audio.batch.generateSelected", { count: selectedChapters.size })}</span>
            </button>
            <button
              className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
              disabled={loading || !hasCompatibleVoice}
              onClick={() =>
                onGenerateChapters({
                  engineId: selectedEngineId,
                  generationLanguage,
                  modelSettings: selectedModelSettings,
                  quality,
                  seed,
                  seedFixed: audioSettings.seedFixed,
                  useExpressiveNarration,
                  voiceProfileId: selectedVoiceId || undefined
                })
              }
            >
              <Wand2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{t("audio.batch.generateBook")}</span>
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t("audio.pronunciation")}</h3>
        <div className="rounded-md border bg-card p-3">
          <div className="grid grid-cols-1 gap-2">
            <SelectField
              label={t("audio.pronunciation.scope")}
              options={[
                { label: t("audio.pronunciation.scope.book"), value: "book" },
                { label: t("audio.pronunciation.scope.global"), value: "global" }
              ]}
              value={pronunciationScope}
              onChange={(value) => setPronunciationScope(value as "global" | "book")}
            />
            <input
              className="h-9 rounded-md border bg-background px-3 text-sm outline-none"
              placeholder={t("audio.pronunciation.pattern")}
              value={pronunciationPattern}
              onChange={(event) => setPronunciationPattern(event.target.value)}
            />
            <input
              className="h-9 rounded-md border bg-background px-3 text-sm outline-none"
              placeholder={t("audio.pronunciation.replacement")}
              value={pronunciationReplacement}
              onChange={(event) => setPronunciationReplacement(event.target.value)}
            />
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm"
              disabled={!pronunciationPattern.trim() || !pronunciationReplacement.trim()}
              onClick={async () => {
                await onCreatePronunciationEntry({
                  pattern: pronunciationPattern,
                  replacement: pronunciationReplacement,
                  scope: pronunciationScope
                })
                setPronunciationPattern("")
                setPronunciationReplacement("")
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("audio.pronunciation.add")}
            </button>
          </div>
        </div>
        {pronunciationEntries.length ? (
          <div className="space-y-2">
            {pronunciationEntries.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-3 rounded-md border bg-card p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {entry.pattern} → {entry.replacement}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{t(`audio.pronunciation.scope.${entry.scope}`)}</p>
                </div>
                <button className="shrink-0 rounded-sm p-1 text-muted-foreground hover:text-destructive" onClick={() => onDeletePronunciationEntry(entry.id)} title={t("audio.pronunciation.delete")}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-md border bg-card p-3 text-sm text-muted-foreground">{t("audio.pronunciation.empty")}</p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t("audio.models")}</h3>
        {models.length ? (
          <div className="space-y-2">
            {models.map((model) => (
              <ModelCard key={model.id} model={model} t={t} onDownloadModel={onDownloadModel} onInstallModelFromPath={onInstallModelFromPath} />
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
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t("audio.queue")}</h3>
          {terminalJobs.length ? (
            <button
              className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md border bg-card px-2.5 text-xs"
              disabled={loading}
              onClick={onClearTerminalJobs}
            >
              <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{t("audio.clearFinishedQueue")}</span>
            </button>
          ) : null}
        </div>
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

      {modelSettingsDialogOpen ? (
        <ModelSettingsDialog
          draftSettings={modelSettingsDraft}
          engineName={engineOptions.find((option) => option.value === selectedEngineId)?.label ?? selectedEngineId}
          fields={modelSettingsFields}
          t={t}
          onCancel={() => setModelSettingsDialogOpen(false)}
          onChange={setModelSettingsDraft}
          onReset={() => setModelSettingsDraft(defaultModelSettingsForEngine(selectedEngineId))}
          onSave={saveModelSettings}
        />
      ) : null}
    </div>
  )
}

function ModelSettingsDialog({
  draftSettings,
  engineName,
  fields,
  t,
  onCancel,
  onChange,
  onReset,
  onSave
}: {
  draftSettings: TtsModelSettings
  engineName: string
  fields: AudioModelSettingField[]
  t: TranslationFn
  onCancel: () => void
  onChange: (settings: TtsModelSettings) => void
  onReset: () => void
  onSave: () => void
}) {
  const updateField = (field: AudioModelSettingField, value: boolean | number) => {
    onChange({
      ...draftSettings,
      [field.key]: value
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-md border bg-card p-4 shadow-lg" role="dialog" aria-modal="true" aria-label={t("audio.modelSettings.title")}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{t("audio.modelSettings.title")}</h3>
            <p className="mt-1 truncate text-xs text-muted-foreground">{engineName}</p>
          </div>
          <button className="rounded-sm px-2 py-1 text-xs text-muted-foreground hover:text-foreground" onClick={onCancel}>
            {t("audio.modelSettings.cancel")}
          </button>
        </div>

        {fields.length ? (
          <div className="mt-4 max-h-[60vh] space-y-3 overflow-auto pr-1">
            {fields.map((field) =>
              field.kind === "boolean" ? (
                <label key={String(field.key)} className="flex items-start justify-between gap-3 rounded-md border bg-background p-3 text-sm">
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 font-medium">
                      <span>{t(field.labelKey)}</span>
                      <ParameterHelp label={t(field.labelKey)} text={t(field.descriptionKey)} />
                    </span>
                  </span>
                  <input
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                    type="checkbox"
                    checked={Boolean(draftSettings[field.key])}
                    onChange={(event) => updateField(field, event.target.checked)}
                  />
                </label>
              ) : (
                <div key={String(field.key)} className="rounded-md border bg-background p-3">
                  <label className="block text-sm">
                    <span className="mb-2 flex items-center justify-between gap-3 text-xs font-medium text-muted-foreground">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate">{t(field.labelKey)}</span>
                        <ParameterHelp label={t(field.labelKey)} text={t(field.descriptionKey)} />
                      </span>
                      <span>{Number(draftSettings[field.key] ?? 0)}</span>
                    </span>
                    <input
                      className="w-full accent-primary"
                      type="range"
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      value={Number(draftSettings[field.key] ?? 0)}
                      onChange={(event) => updateField(field, Number(event.target.value))}
                    />
                  </label>
                  <div className="mt-2 flex justify-end">
                    <input
                      className="h-9 w-full rounded-md border bg-card px-2 text-sm outline-none"
                      type="number"
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      value={Number(draftSettings[field.key] ?? 0)}
                      onChange={(event) => updateField(field, Number(event.target.value))}
                    />
                  </div>
                </div>
              )
            )}
          </div>
        ) : (
          <p className="mt-4 rounded-md border bg-background p-3 text-sm text-muted-foreground">{t("audio.modelSettings.empty")}</p>
        )}

        <div className="mt-4 grid grid-cols-3 gap-2">
          <button className="inline-flex h-9 min-w-0 items-center justify-center rounded-md border bg-background px-3 text-sm" onClick={onReset}>
            <span className="truncate">{t("audio.modelSettings.reset")}</span>
          </button>
          <button className="inline-flex h-9 min-w-0 items-center justify-center rounded-md border bg-background px-3 text-sm" onClick={onCancel}>
            <span className="truncate">{t("audio.modelSettings.cancel")}</span>
          </button>
          <button className="inline-flex h-9 min-w-0 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground" onClick={onSave}>
            <span className="truncate">{t("audio.modelSettings.save")}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function ParameterHelp({ label, text }: { label: string; text: string }) {
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const tooltipId = useId()
  const [tooltipPosition, setTooltipPosition] = useState<{
    left: number
    top: number
    width: number
    maxHeight: number
    placement: "above" | "below"
  } | null>(null)

  const positionTooltip = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect()
    if (!rect) {
      setTooltipPosition(null)
      return
    }

    const viewportPadding = 16
    const tooltipGap = 8
    const width = Math.min(288, window.innerWidth - viewportPadding * 2)
    const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, viewportPadding), window.innerWidth - width - viewportPadding)
    const belowTop = rect.bottom + tooltipGap
    const aboveTop = rect.top - tooltipGap
    const availableBelow = window.innerHeight - belowTop - viewportPadding
    const availableAbove = aboveTop - viewportPadding
    const shouldOpenAbove = availableBelow < 160 && availableAbove > availableBelow
    const maxHeight = Math.min(320, Math.max(96, shouldOpenAbove ? availableAbove : availableBelow))
    const top = shouldOpenAbove ? aboveTop : belowTop

    setTooltipPosition({
      left,
      top,
      width,
      maxHeight,
      placement: shouldOpenAbove ? "above" : "below"
    })
  }, [])

  useEffect(() => {
    if (!tooltipPosition) {
      return undefined
    }

    window.addEventListener("resize", positionTooltip)
    window.addEventListener("scroll", positionTooltip, true)

    return () => {
      window.removeEventListener("resize", positionTooltip)
      window.removeEventListener("scroll", positionTooltip, true)
    }
  }, [positionTooltip, tooltipPosition])

  return (
    <span
      ref={anchorRef}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      tabIndex={0}
      aria-label={text}
      aria-describedby={tooltipPosition ? tooltipId : undefined}
      onFocus={positionTooltip}
      onBlur={() => setTooltipPosition(null)}
      onMouseEnter={positionTooltip}
      onMouseLeave={() => setTooltipPosition(null)}
    >
      <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
      {tooltipPosition && typeof document !== "undefined"
        ? createPortal(
            <span
              id={tooltipId}
              className={cn(
                "pointer-events-none fixed z-[70] max-h-[min(50vh,20rem)] overflow-auto rounded-md border bg-card px-3 py-2 text-left text-xs font-normal leading-relaxed text-foreground shadow-lg",
                tooltipPosition.placement === "above" && "-translate-y-full"
              )}
              style={{
                left: tooltipPosition.left,
                maxHeight: tooltipPosition.maxHeight,
                top: tooltipPosition.top,
                width: tooltipPosition.width
              }}
              role="tooltip"
            >
              <span className="mb-1 block font-semibold">{label}</span>
              {text}
            </span>,
            document.body
          )
        : null}
    </span>
  )
}

function ModelCard({
  model,
  t,
  onDownloadModel,
  onInstallModelFromPath
}: {
  model: RuntimeModel
  t: TranslationFn
  onDownloadModel: (modelId: string) => Promise<void> | void
  onInstallModelFromPath: () => Promise<void> | void
}) {
  const isDownloading = model.installStatus === "queued" || model.installStatus === "downloading"
  const canDownload = model.canDownload && !isDownloading && model.installStatus !== "available"
  const canInstallLocal = !isDownloading && model.installStatus !== "available"
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

      {canDownload || canInstallLocal ? (
        <div className="mt-3 grid grid-cols-1 gap-2">
          {canDownload ? (
            <button
              className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm"
              onClick={() => onDownloadModel(model.id)}
            >
              <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{t(model.installStatus === "failed" ? "audio.model.retryDownload" : "audio.model.download")}</span>
            </button>
          ) : null}
          {canInstallLocal ? (
            <button
              className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm"
              onClick={onInstallModelFromPath}
            >
              <FolderOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{t("audio.model.installLocal")}</span>
            </button>
          ) : null}
        </div>
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

function isTerminalJobStatus(status: TtsJob["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled"
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
