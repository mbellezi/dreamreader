import { Cpu, Download, FileAudio, FolderOpen, HardDrive, Mic2, Plus, RefreshCw, RotateCcw, Sparkles, Square, Trash2, Volume2, Wand2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { SelectField } from "@renderer/components/common/Controls"
import type { TranslationFn } from "@renderer/app/types"
import { cn } from "@renderer/lib/utils"
import type { AudiobookExport, BookDetails, PronunciationEntry, RuntimeDiagnostic, RuntimeModel, TtsJob, VoiceProfile } from "@renderer/types"

const defaultEngineId = "dreamreader-local-tts"

export function AudioPanel({
  audiobook,
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
  onCreateVoiceFromDesignPrompt,
  onCreateVoiceFromReference,
  onCreatePronunciationEntry,
  onDeleteVoice,
  onDeletePronunciationEntry,
  onDownloadModel,
  onGenerateChapter,
  onInstallModelFromPath,
  onRebuildAudiobook,
  onRetryJob,
  onSelectVoiceReferenceAudio,
  onToggleAutoBuild
}: {
  audiobook: AudiobookExport | null
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
  onClearChapterAudio: () => Promise<void> | void
  onClearTerminalJobs: () => Promise<void> | void
  onCreateVoiceFromDesignPrompt: (input: { engineId: string; language: string; name: string; prompt: string }) => Promise<VoiceProfile | void> | VoiceProfile | void
  onCreateVoiceFromReference: (input: {
    consentConfirmed: true
    consentNote: string
    engineId: string
    language: string
    name: string
    referenceAudioPath: string
    transcript?: string
  }) => Promise<VoiceProfile | void> | VoiceProfile | void
  onCreatePronunciationEntry: (input: { pattern: string; replacement: string; scope: "global" | "book" }) => Promise<void> | void
  onDeleteVoice: (voiceProfileId: string) => Promise<void> | void
  onDeletePronunciationEntry: (id: string) => Promise<void> | void
  onDownloadModel: (modelId: string) => Promise<void> | void
  onGenerateChapter: (input: {
    engineId: string
    quality: "draft" | "standard" | "high"
    useExpressiveNarration: boolean
    voiceProfileId?: string
  }) => Promise<void> | void
  onInstallModelFromPath: () => Promise<void> | void
  onRebuildAudiobook: () => Promise<void> | void
  onRetryJob: (jobId: string) => Promise<void> | void
  onSelectVoiceReferenceAudio: () => Promise<string | null>
  onToggleAutoBuild: (enabled: boolean) => Promise<void> | void
}) {
  const [quality, setQuality] = useState<"draft" | "standard" | "high">("standard")
  const [selectedEngineId, setSelectedEngineId] = useState(defaultEngineId)
  const [selectedVoiceId, setSelectedVoiceId] = useState("")
  const [voiceManagerMode, setVoiceManagerMode] = useState<"reference" | "design">("reference")
  const [referenceEngineId, setReferenceEngineId] = useState("")
  const [referenceVoiceName, setReferenceVoiceName] = useState("")
  const [referenceAudioPath, setReferenceAudioPath] = useState("")
  const [referenceTranscript, setReferenceTranscript] = useState("")
  const [referenceConsentNote, setReferenceConsentNote] = useState("")
  const [referenceConsentConfirmed, setReferenceConsentConfirmed] = useState(false)
  const [designEngineId, setDesignEngineId] = useState("qwen3-tts-17b-mlx")
  const [designVoiceName, setDesignVoiceName] = useState("")
  const [designPrompt, setDesignPrompt] = useState("")
  const [pronunciationPattern, setPronunciationPattern] = useState("")
  const [pronunciationReplacement, setPronunciationReplacement] = useState("")
  const [pronunciationScope, setPronunciationScope] = useState<"global" | "book">("book")
  const [useExpressiveNarration, setUseExpressiveNarration] = useState(false)
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
  const referenceEngineOptions = useMemo(
    () =>
      installedTtsModels
        .filter((model) => isReferenceVoiceEngine(model.engineId))
        .map((model) => ({ label: model.name, value: model.engineId ?? model.id })),
    [installedTtsModels]
  )
  const designEngineOptions = useMemo(
    () =>
      installedTtsModels
        .filter((model) => model.engineId === "qwen3-tts-17b-mlx")
        .map((model) => ({ label: model.name, value: model.engineId ?? model.id })),
    [installedTtsModels]
  )
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
  const referenceSelectOptions = referenceEngineOptions.length
    ? referenceEngineOptions
    : [{ label: t("audio.voiceManager.noReferenceEngine"), value: "" }]
  const designSelectOptions = designEngineOptions.length
    ? designEngineOptions
    : [{ label: t("audio.voiceManager.noDesignEngine"), value: "" }]
  const customVoicesForEngine = useMemo(
    () =>
      voices.filter((voice) => {
        if (voice.kind !== "cloned" && voice.kind !== "generated") return false
        const engineIds = voice.settings?.compatibleEngineIds
        return !Array.isArray(engineIds) || engineIds.includes(selectedEngineId)
      }),
    [selectedEngineId, voices]
  )
  const referenceTranscriptRequired = requiresReferenceTranscript(referenceEngineId)
  const canCreateReferenceVoice =
    Boolean(referenceEngineId) &&
    Boolean(referenceVoiceName.trim()) &&
    Boolean(referenceAudioPath) &&
    (!referenceTranscriptRequired || Boolean(referenceTranscript.trim())) &&
    Boolean(referenceConsentNote.trim()) &&
    referenceConsentConfirmed &&
    !loading
  const canCreateDesignVoice = Boolean(designEngineId) && Boolean(designVoiceName.trim()) && Boolean(designPrompt.trim()) && !loading

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

  useEffect(() => {
    if (referenceEngineOptions.some((option) => option.value === selectedEngineId)) {
      setReferenceEngineId(selectedEngineId)
      return
    }
    if (!referenceEngineOptions.some((option) => option.value === referenceEngineId)) {
      setReferenceEngineId(referenceEngineOptions[0]?.value ?? "")
    }
  }, [referenceEngineId, referenceEngineOptions, selectedEngineId])

  useEffect(() => {
    if (!designEngineOptions.some((option) => option.value === designEngineId)) {
      setDesignEngineId(designEngineOptions[0]?.value ?? "")
    }
  }, [designEngineId, designEngineOptions])

  const chooseReferenceAudio = async () => {
    const audioPath = await onSelectVoiceReferenceAudio()
    if (audioPath) {
      setReferenceAudioPath(audioPath)
    }
  }

  const createReferenceVoice = async () => {
    if (!canCreateReferenceVoice) {
      return
    }
    const voice = await onCreateVoiceFromReference({
      consentConfirmed: true,
      consentNote: referenceConsentNote.trim(),
      engineId: referenceEngineId,
      language: "pt-BR",
      name: referenceVoiceName.trim(),
      referenceAudioPath,
      transcript: referenceTranscript.trim() || undefined
    })
    setReferenceVoiceName("")
    setReferenceAudioPath("")
    setReferenceTranscript("")
    setReferenceConsentNote("")
    setReferenceConsentConfirmed(false)
    if (voice?.id) {
      setSelectedEngineId(referenceEngineId)
      setSelectedVoiceId(voice.id)
    }
  }

  const createDesignVoice = async () => {
    if (!canCreateDesignVoice) {
      return
    }
    const voice = await onCreateVoiceFromDesignPrompt({
      engineId: designEngineId,
      language: "pt-BR",
      name: designVoiceName.trim(),
      prompt: designPrompt.trim()
    })
    setDesignVoiceName("")
    setDesignPrompt("")
    if (voice?.id) {
      setSelectedEngineId(designEngineId)
      setSelectedVoiceId(voice.id)
    }
  }

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

          {hasChapterGeneration ? (
            <button
              className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm"
              disabled={Boolean(activeJob) || loading}
              onClick={onClearChapterAudio}
            >
              <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{t("audio.clearChapterGeneration")}</span>
            </button>
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
          options={voiceOptions}
          value={selectedVoiceId}
          onChange={setSelectedVoiceId}
        />
        <div className="space-y-3 rounded-md border bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t("audio.voiceManager.title")}</h3>
            <div className="grid shrink-0 grid-cols-2 gap-1 rounded-md border bg-background p-1">
              <button
                className={cn(
                  "inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-sm px-2 text-xs text-muted-foreground",
                  voiceManagerMode === "reference" && "bg-card text-foreground shadow-sm"
                )}
                title={t("audio.voiceManager.reference")}
                onClick={() => setVoiceManagerMode("reference")}
              >
                <Mic2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{t("audio.voiceManager.reference")}</span>
              </button>
              <button
                className={cn(
                  "inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-sm px-2 text-xs text-muted-foreground",
                  voiceManagerMode === "design" && "bg-card text-foreground shadow-sm"
                )}
                title={t("audio.voiceManager.design")}
                onClick={() => setVoiceManagerMode("design")}
              >
                <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{t("audio.voiceManager.design")}</span>
              </button>
            </div>
          </div>

          {voiceManagerMode === "reference" ? (
            <div className="grid grid-cols-1 gap-2">
              <SelectField
                label={t("audio.voiceManager.engine")}
                options={referenceSelectOptions}
                value={referenceEngineId}
                onChange={setReferenceEngineId}
              />
              <input
                className="h-9 rounded-md border bg-background px-3 text-sm outline-none"
                placeholder={t("audio.voiceManager.name")}
                value={referenceVoiceName}
                onChange={(event) => setReferenceVoiceName(event.target.value)}
              />
              <button
                className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm"
                disabled={!referenceEngineId || loading}
                onClick={chooseReferenceAudio}
              >
                <FileAudio className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{referenceAudioPath ? fileNameForPath(referenceAudioPath) : t("audio.voiceManager.selectReference")}</span>
              </button>
              <textarea
                className="min-h-20 rounded-md border bg-background px-3 py-2 text-sm outline-none"
                placeholder={t("audio.voiceManager.transcript")}
                value={referenceTranscript}
                onChange={(event) => setReferenceTranscript(event.target.value)}
              />
              {referenceTranscriptRequired ? (
                <p className="rounded-md border bg-background p-2 text-xs text-muted-foreground">
                  {t("audio.voiceManager.f5TranscriptRequired")}
                </p>
              ) : null}
              <input
                className="h-9 rounded-md border bg-background px-3 text-sm outline-none"
                placeholder={t("audio.voiceManager.consentNote")}
                value={referenceConsentNote}
                onChange={(event) => setReferenceConsentNote(event.target.value)}
              />
              <label className="flex items-center justify-between rounded-md border bg-background p-3 text-sm">
                <span>{t("audio.voiceManager.consent")}</span>
                <input
                  className="h-4 w-4 accent-primary"
                  type="checkbox"
                  checked={referenceConsentConfirmed}
                  onChange={(event) => setReferenceConsentConfirmed(event.target.checked)}
                />
              </label>
              <button
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm"
                disabled={!canCreateReferenceVoice}
                onClick={createReferenceVoice}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t("audio.voiceManager.createReference")}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              <SelectField
                label={t("audio.voiceManager.engine")}
                options={designSelectOptions}
                value={designEngineId}
                onChange={setDesignEngineId}
              />
              <input
                className="h-9 rounded-md border bg-background px-3 text-sm outline-none"
                placeholder={t("audio.voiceManager.name")}
                value={designVoiceName}
                onChange={(event) => setDesignVoiceName(event.target.value)}
              />
              <textarea
                className="min-h-24 rounded-md border bg-background px-3 py-2 text-sm outline-none"
                placeholder={t("audio.voiceManager.designPrompt")}
                value={designPrompt}
                onChange={(event) => setDesignPrompt(event.target.value)}
              />
              <button
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm"
                disabled={!canCreateDesignVoice}
                onClick={createDesignVoice}
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                {t("audio.voiceManager.createDesign")}
              </button>
            </div>
          )}

          <div className="space-y-2">
            {customVoicesForEngine.length ? (
              customVoicesForEngine.map((voice) => (
                <div key={voice.id} className="flex items-center justify-between gap-3 rounded-md border bg-background p-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{voice.name}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{t(`audio.voiceManager.kind.${voice.kind}`)}</p>
                  </div>
                  <button
                    className="shrink-0 rounded-sm p-1 text-muted-foreground hover:text-destructive"
                    disabled={loading}
                    onClick={async () => {
                      await onDeleteVoice(voice.id)
                      if (selectedVoiceId === voice.id) {
                        setSelectedVoiceId("")
                      }
                    }}
                    title={t("audio.voiceManager.delete")}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ))
            ) : (
              <p className="rounded-md border bg-background p-3 text-sm text-muted-foreground">{t("audio.voiceManager.empty")}</p>
            )}
          </div>
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
    </div>
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

function isReferenceVoiceEngine(engineId: string | undefined): boolean {
  return engineId === "qwen3-tts-06b-mlx" || engineId === "qwen3-tts-17b-base-mlx" || engineId === "f5-tts-pt-br"
}

function requiresReferenceTranscript(engineId: string): boolean {
  return engineId === "qwen3-tts-06b-mlx" || engineId === "qwen3-tts-17b-base-mlx" || engineId === "f5-tts-pt-br"
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

function fileNameForPath(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath
}
