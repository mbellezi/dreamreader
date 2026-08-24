import { AlertTriangle, Check, Download, FileAudio, Loader2, Mic2, Pencil, Play, Plus, Sparkles, Trash2, Upload, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { SelectField } from "@renderer/components/common/Controls"
import type { TranslationFn } from "@renderer/app/types"
import { cn } from "@renderer/lib/utils"
import { pickPreviewEngineId } from "@renderer/lib/voicePreview"
import type { RuntimeModel, VoiceDesignPreview, VoiceProfile } from "@renderer/types"

const CLONE_ENGINE_IDS = ["qwen3-tts-06b-mlx", "qwen3-tts-17b-base-mlx", "chatterbox-multilingual-mlx", "moss-tts-v15-mlx", "f5-tts-pt-br"]
const DESIGN_ENGINE_ID = "qwen3-tts-17b-mlx"
const DESIGN_LANGUAGE_OPTIONS = [
  { labelKey: "audio.language.portuguese", sampleKey: "voiceManager.sampleText.default.pt-BR", value: "pt-BR" },
  { labelKey: "audio.language.english", sampleKey: "voiceManager.sampleText.default.en", value: "en" },
  { labelKey: "audio.language.spanish", sampleKey: "voiceManager.sampleText.default.es", value: "es" },
  { labelKey: "audio.language.french", sampleKey: "voiceManager.sampleText.default.fr", value: "fr" },
  { labelKey: "audio.language.german", sampleKey: "voiceManager.sampleText.default.de", value: "de" },
  { labelKey: "audio.language.italian", sampleKey: "voiceManager.sampleText.default.it", value: "it" },
  { labelKey: "audio.language.japanese", sampleKey: "voiceManager.sampleText.default.ja", value: "ja" },
  { labelKey: "audio.language.korean", sampleKey: "voiceManager.sampleText.default.ko", value: "ko" },
  { labelKey: "audio.language.chinese", sampleKey: "voiceManager.sampleText.default.zh", value: "zh" },
  { labelKey: "audio.language.russian", sampleKey: "voiceManager.sampleText.default.ru", value: "ru" }
]
const REFERENCE_WARN_MS = 12_000

export function VoiceManager({
  voices,
  models,
  loading,
  t,
  onCreateVoiceFromReference,
  onGenerateVoiceDesignPreview,
  onCommitVoiceDesignPreview,
  onDiscardVoiceDesignPreview,
  onUpdateVoice,
  onDeleteVoice,
  onExportVoice,
  onImportVoices,
  onSelectVoiceReferenceAudio,
  onPreviewVoice
}: {
  voices: VoiceProfile[]
  models: RuntimeModel[]
  loading: boolean
  t: TranslationFn
  onCreateVoiceFromReference: (input: {
    consentConfirmed: true
    consentNote: string
    language: string
    name: string
    referenceAudioPath: string
    transcript?: string
  }) => Promise<VoiceProfile | void> | VoiceProfile | void
  onGenerateVoiceDesignPreview: (input: {
    engineId: string
    language: string
    prompt: string
    referenceVoiceProfileId?: string
    sampleText: string
  }) => Promise<VoiceDesignPreview | void> | VoiceDesignPreview | void
  onCommitVoiceDesignPreview: (input: { previewId: string; name: string }) => Promise<VoiceProfile | void> | VoiceProfile | void
  onDiscardVoiceDesignPreview: (previewId: string) => Promise<void> | void
  onUpdateVoice: (input: { voiceProfileId: string; name: string }) => Promise<void> | void
  onDeleteVoice: (voiceProfileId: string) => Promise<void> | void
  onExportVoice: (voiceProfileId: string) => Promise<void> | void
  onImportVoices: () => Promise<void> | void
  onSelectVoiceReferenceAudio: () => Promise<{ path: string; durationMs?: number; sampleRate?: number } | null>
  onPreviewVoice: (voiceProfileId: string, engineId: string) => Promise<string | null>
}) {
  const [referenceDialogOpen, setReferenceDialogOpen] = useState(false)
  const [designDialogOpen, setDesignDialogOpen] = useState(false)
  const [referenceName, setReferenceName] = useState("")
  const [referenceAudioPath, setReferenceAudioPath] = useState("")
  const [referenceDurationMs, setReferenceDurationMs] = useState<number | undefined>(undefined)
  const [referenceTranscript, setReferenceTranscript] = useState("")
  const [referenceConsentNote, setReferenceConsentNote] = useState("")
  const [referenceConsentConfirmed, setReferenceConsentConfirmed] = useState(false)
  const [designEngineId, setDesignEngineId] = useState(DESIGN_ENGINE_ID)
  const [designLanguage, setDesignLanguage] = useState("pt-BR")
  const [designName, setDesignName] = useState("")
  const [designPrompt, setDesignPrompt] = useState("")
  const [designReferenceVoiceId, setDesignReferenceVoiceId] = useState("")
  const [designSampleText, setDesignSampleText] = useState(() => t("voiceManager.sampleText.default.pt-BR"))
  const [designSampleTextTouched, setDesignSampleTextTouched] = useState(false)
  const [designPreview, setDesignPreview] = useState<VoiceDesignPreview | null>(null)
  const [designGenerating, setDesignGenerating] = useState(false)
  const [designCommitLoading, setDesignCommitLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState("")
  const [importLoading, setImportLoading] = useState(false)
  const designPreviewRef = useRef<VoiceDesignPreview | null>(null)
  const discardDesignPreviewRef = useRef(onDiscardVoiceDesignPreview)

  const installedTtsModels = useMemo(
    () => models.filter((model) => model.kind === "tts" && model.installStatus === "available" && model.engineId),
    [models]
  )
  const hasCloneEngine = installedTtsModels.some((model) => CLONE_ENGINE_IDS.includes(model.engineId ?? ""))
  const designEngineOptions = useMemo(
    () => installedTtsModels.filter((model) => model.engineId === DESIGN_ENGINE_ID).map((model) => ({ label: model.name, value: model.engineId ?? model.id })),
    [installedTtsModels]
  )
  const designLanguageOptions = useMemo(
    () => DESIGN_LANGUAGE_OPTIONS.map((option) => ({ label: t(option.labelKey), value: option.value })),
    [t]
  )
  const customVoices = useMemo(() => voices.filter((voice) => voice.kind === "cloned" || voice.kind === "generated" || voice.kind === "imported"), [voices])
  const selectedDesignModel = installedTtsModels.find((model) => model.engineId === designEngineId)
  const designSupportsReference = voiceDesignSupportsReference(selectedDesignModel)
  const designReferenceVoiceOptions = useMemo(
    () => [
      { label: t("voiceManager.referenceVoice.none"), value: "" },
      ...customVoices.map((voice) => ({ label: voice.name, value: voice.id }))
    ],
    [customVoices, t]
  )
  const designSampleTextDefault = t(sampleTextKeyForLanguage(designLanguage))

  const referenceTooLong = typeof referenceDurationMs === "number" && referenceDurationMs > REFERENCE_WARN_MS
  const canCreateReference =
    Boolean(referenceName.trim()) &&
    Boolean(referenceAudioPath) &&
    Boolean(referenceTranscript.trim()) &&
    Boolean(referenceConsentNote.trim()) &&
    referenceConsentConfirmed &&
    !loading
  const canGenerateDesign =
    Boolean(designEngineId) &&
    Boolean(designPrompt.trim()) &&
    Boolean(designSampleText.trim()) &&
    !designGenerating &&
    !designCommitLoading &&
    !loading
  const canCommitDesign = Boolean(designPreview) && !designGenerating && !designCommitLoading && !loading

  useEffect(() => {
    if (!designEngineOptions.some((option) => option.value === designEngineId)) {
      setDesignEngineId(designEngineOptions[0]?.value ?? DESIGN_ENGINE_ID)
    }
  }, [designEngineId, designEngineOptions])

  useEffect(() => {
    if (!designSampleTextTouched) {
      setDesignSampleText(designSampleTextDefault)
    }
  }, [designSampleTextDefault, designSampleTextTouched])

  useEffect(() => {
    if (!designSupportsReference || !designReferenceVoiceOptions.some((option) => option.value === designReferenceVoiceId)) {
      setDesignReferenceVoiceId("")
    }
  }, [designReferenceVoiceId, designReferenceVoiceOptions, designSupportsReference])

  useEffect(() => {
    designPreviewRef.current = designPreview
  }, [designPreview])

  useEffect(() => {
    discardDesignPreviewRef.current = onDiscardVoiceDesignPreview
  }, [onDiscardVoiceDesignPreview])

  useEffect(() => {
    return () => {
      const preview = designPreviewRef.current
      if (preview) {
        void discardDesignPreviewRef.current(preview.id)
      }
    }
  }, [])

  const chooseReferenceAudio = async () => {
    const selection = await onSelectVoiceReferenceAudio()
    if (selection) {
      setReferenceAudioPath(selection.path)
      setReferenceDurationMs(selection.durationMs)
    }
  }

  const createReference = async () => {
    if (!canCreateReference) {
      return
    }
    await onCreateVoiceFromReference({
      consentConfirmed: true,
      consentNote: referenceConsentNote.trim(),
      language: "pt-BR",
      name: referenceName.trim(),
      referenceAudioPath,
      transcript: referenceTranscript.trim()
    })
    setReferenceName("")
    setReferenceAudioPath("")
    setReferenceDurationMs(undefined)
    setReferenceTranscript("")
    setReferenceConsentNote("")
    setReferenceConsentConfirmed(false)
    setReferenceDialogOpen(false)
  }

  const discardCurrentDesignPreview = async () => {
    const preview = designPreviewRef.current
    if (!preview) {
      return
    }
    setDesignPreview(null)
    designPreviewRef.current = null
    await onDiscardVoiceDesignPreview(preview.id)
  }

  const generateDesign = async () => {
    if (!canGenerateDesign) {
      return
    }
    setDesignGenerating(true)
    try {
      await discardCurrentDesignPreview()
      const preview = await onGenerateVoiceDesignPreview({
        engineId: designEngineId,
        language: designLanguage,
        prompt: designPrompt.trim(),
        referenceVoiceProfileId: designReferenceVoiceId || undefined,
        sampleText: designSampleText.trim()
      })
      if (preview) {
        setDesignPreview(preview)
      }
    } finally {
      setDesignGenerating(false)
    }
  }

  const commitDesign = async () => {
    if (!canCommitDesign || !designPreview) {
      return
    }
    setDesignCommitLoading(true)
    try {
      await onCommitVoiceDesignPreview({
        previewId: designPreview.id,
        name: designName.trim() || t("voiceManager.defaultDesignName")
      })
      setDesignPreview(null)
      designPreviewRef.current = null
      setDesignName("")
      setDesignPrompt("")
      setDesignDialogOpen(false)
    } finally {
      setDesignCommitLoading(false)
    }
  }

  const closeDesignDialog = async () => {
    if (designGenerating || designCommitLoading) {
      return
    }
    try {
      await discardCurrentDesignPreview()
    } finally {
      setDesignDialogOpen(false)
    }
  }

  const saveRename = async (voiceProfileId: string) => {
    if (editingName.trim()) {
      await onUpdateVoice({ voiceProfileId, name: editingName.trim() })
    }
    setEditingId(null)
    setEditingName("")
  }

  const importVoicePackages = async () => {
    if (importLoading || loading) {
      return
    }
    setImportLoading(true)
    try {
      await onImportVoices()
    } finally {
      setImportLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm"
              onClick={() => setReferenceDialogOpen(true)}
            >
              <Mic2 className="h-4 w-4" aria-hidden="true" />
              <span>{t("voiceManager.cloneVoice")}</span>
            </button>
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm"
              onClick={() => setDesignDialogOpen(true)}
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              <span>{t("voiceManager.createVoice")}</span>
            </button>
          </div>
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
            disabled={loading || importLoading}
            onClick={() => void importVoicePackages()}
          >
            {importLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
            <span>{t("voiceManager.import")}</span>
          </button>
        </div>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{t("voiceManager.listTitle")}</h3>
        </div>
        {customVoices.length ? (
          customVoices.map((voice) => (
            <VoiceRow
              key={voice.id}
              voice={voice}
              previewEngineId={pickPreviewEngineId(voice, installedTtsModels)}
              loading={loading}
              isEditing={editingId === voice.id}
              editingName={editingName}
              t={t}
              onPreviewVoice={onPreviewVoice}
              onStartEdit={() => {
                setEditingId(voice.id)
                setEditingName(voice.name)
              }}
              onChangeEditingName={setEditingName}
              onSaveRename={() => void saveRename(voice.id)}
              onCancelEdit={() => setEditingId(null)}
              onDeleteVoice={onDeleteVoice}
              onExportVoice={onExportVoice}
            />
          ))
        ) : (
          <p className="rounded-md border bg-card p-3 text-sm text-muted-foreground">{t("voiceManager.empty")}</p>
        )}
      </div>

      {referenceDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-4 backdrop-blur-sm">
          <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-md border bg-card p-4 shadow-lg" role="dialog" aria-modal="true" aria-label={t("voiceManager.reference")}>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">{t("voiceManager.reference")}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{t("voiceManager.referenceShared")}</p>
            </div>
            <div className="mt-4 grid min-h-0 grid-cols-1 gap-2 overflow-auto pr-1">
              {!hasCloneEngine ? (
                <p className="rounded-md border bg-background p-2 text-xs text-muted-foreground">{t("voiceManager.noCloneEngine")}</p>
              ) : null}
              <input
                className="h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                placeholder={t("voiceManager.name")}
                value={referenceName}
                onChange={(event) => setReferenceName(event.target.value)}
              />
              <button
                className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm"
                disabled={loading}
                onClick={chooseReferenceAudio}
              >
                <FileAudio className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{referenceAudioPath ? fileNameForPath(referenceAudioPath) : t("voiceManager.selectReference")}</span>
              </button>
              {referenceTooLong ? (
                <p className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{t("voiceManager.durationWarning", { seconds: Math.round((referenceDurationMs ?? 0) / 1000) })}</span>
                </p>
              ) : null}
              <textarea
                className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                placeholder={t("voiceManager.transcript")}
                value={referenceTranscript}
                onChange={(event) => setReferenceTranscript(event.target.value)}
              />
              <input
                className="h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                placeholder={t("voiceManager.consentNote")}
                value={referenceConsentNote}
                onChange={(event) => setReferenceConsentNote(event.target.value)}
              />
              <label className="flex items-center justify-between rounded-md border bg-background p-3 text-sm">
                <span>{t("voiceManager.consent")}</span>
                <input className="h-4 w-4 accent-primary" type="checkbox" checked={referenceConsentConfirmed} onChange={(event) => setReferenceConsentConfirmed(event.target.checked)} />
              </label>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button className="inline-flex h-9 items-center justify-center rounded-md border bg-background px-3 text-sm" onClick={() => setReferenceDialogOpen(false)}>
                {t("voiceManager.closeDialog")}
              </button>
              <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground" disabled={!canCreateReference} onClick={createReference}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t("voiceManager.createReference")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {designDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-4 backdrop-blur-sm">
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-md border bg-card p-4 shadow-lg" role="dialog" aria-modal="true" aria-label={t("voiceManager.design")}>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">{t("voiceManager.design")}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{t("voiceManager.designHint")}</p>
            </div>
            <div className="mt-4 grid min-h-0 grid-cols-1 gap-2 overflow-auto pr-1">
              <SelectField
                label={t("voiceManager.engine")}
                options={designEngineOptions.length ? designEngineOptions : [{ label: t("voiceManager.noDesignEngine"), value: "" }]}
                value={designEngineId}
                onChange={(value) => {
                  void discardCurrentDesignPreview().catch(() => undefined)
                  setDesignEngineId(value)
                }}
              />
              {!hasCloneEngine ? (
                <p className="rounded-md border bg-background p-2 text-xs text-muted-foreground">{t("voiceManager.noGeneratedVoiceTarget")}</p>
              ) : null}
              <SelectField
                label={t("voiceManager.language")}
                options={designLanguageOptions}
                value={designLanguage}
                onChange={(value) => {
                  void discardCurrentDesignPreview().catch(() => undefined)
                  setDesignLanguage(value)
                  setDesignSampleTextTouched(false)
                }}
              />
              {designSupportsReference ? (
                <SelectField
                  label={t("voiceManager.referenceVoice")}
                  options={designReferenceVoiceOptions}
                  value={designReferenceVoiceId}
                  onChange={(value) => {
                    void discardCurrentDesignPreview().catch(() => undefined)
                    setDesignReferenceVoiceId(value)
                  }}
                />
              ) : null}
              <label className="grid grid-cols-1 gap-2">
                <span className="text-xs font-medium text-muted-foreground">{t("voiceManager.name")}</span>
                <div className="flex h-10 w-full items-center rounded-md border bg-background px-3">
                  <input
                    className={cn(
                      "h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground",
                      designName ? "text-foreground" : "text-muted-foreground"
                    )}
                    placeholder={t("voiceManager.defaultDesignName")}
                    value={designName}
                    onChange={(event) => setDesignName(event.target.value)}
                  />
                </div>
              </label>
              <label className="grid grid-cols-1 gap-2">
                <span className="text-xs font-medium text-muted-foreground">{t("voiceManager.designPrompt")}</span>
                <textarea
                  className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  placeholder={t("voiceManager.designPrompt")}
                  value={designPrompt}
                  onChange={(event) => {
                    void discardCurrentDesignPreview().catch(() => undefined)
                    setDesignPrompt(event.target.value)
                  }}
                />
              </label>
              <div className="grid grid-cols-1 gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">{t("voiceManager.sampleText")}</span>
                  <button
                    className="inline-flex h-7 items-center justify-center gap-1.5 rounded-md border bg-background px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      void discardCurrentDesignPreview().catch(() => undefined)
                      setDesignSampleText(designSampleTextDefault)
                      setDesignSampleTextTouched(false)
                    }}
                  >
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("voiceManager.sampleText.fillDefault")}
                  </button>
                </div>
                <textarea
                  className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  placeholder={t("voiceManager.sampleText")}
                  value={designSampleText}
                  onChange={(event) => {
                    void discardCurrentDesignPreview().catch(() => undefined)
                    setDesignSampleText(event.target.value)
                    setDesignSampleTextTouched(true)
                  }}
                />
              </div>
              {designPreview ? (
                <div className="rounded-md border bg-background p-3">
                  <p className="text-xs font-medium text-muted-foreground">{t("voiceManager.designPreviewReady")}</p>
                  <audio className="mt-2 h-8 w-full" controls preload="none" src={`dreamreader://asset/${encodeURIComponent(designPreview.audioAssetId)}`} />
                </div>
              ) : null}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <button className="inline-flex h-9 items-center justify-center rounded-md border bg-background px-3 text-sm" disabled={designGenerating || designCommitLoading} onClick={() => void closeDesignDialog()}>
                {t("voiceManager.closeDialog")}
              </button>
              <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm" disabled={!canGenerateDesign} onClick={() => void generateDesign()}>
                {designGenerating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                {designPreview ? t("voiceManager.regenerateDesignPreview") : t("voiceManager.createDesign")}
              </button>
              <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground" disabled={!canCommitDesign} onClick={() => void commitDesign()}>
                {designCommitLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                {t("voiceManager.addDesignPreview")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function VoiceRow({
  voice,
  previewEngineId,
  loading,
  isEditing,
  editingName,
  t,
  onPreviewVoice,
  onStartEdit,
  onChangeEditingName,
  onSaveRename,
  onCancelEdit,
  onDeleteVoice,
  onExportVoice
}: {
  voice: VoiceProfile
  previewEngineId: string | undefined
  loading: boolean
  isEditing: boolean
  editingName: string
  t: TranslationFn
  onPreviewVoice: (voiceProfileId: string, engineId: string) => Promise<string | null>
  onStartEdit: () => void
  onChangeEditingName: (value: string) => void
  onSaveRename: () => void
  onCancelEdit: () => void
  onDeleteVoice: (voiceProfileId: string) => Promise<void> | void
  onExportVoice: (voiceProfileId: string) => Promise<void> | void
}) {
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)

  const runPreview = async () => {
    if (!previewEngineId || previewLoading) {
      return
    }
    setPreviewLoading(true)
    setPreviewError(false)
    setPreviewAssetId(null)
    try {
      const assetId = await onPreviewVoice(voice.id, previewEngineId)
      if (assetId) {
        setPreviewAssetId(assetId)
      } else {
        setPreviewError(true)
      }
    } catch {
      setPreviewError(true)
    } finally {
      setPreviewLoading(false)
    }
  }

  const exportVoice = async () => {
    if (exportLoading || loading) {
      return
    }
    setExportLoading(true)
    try {
      await onExportVoice(voice.id)
    } finally {
      setExportLoading(false)
    }
  }

  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <input
              className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none"
              autoFocus
              value={editingName}
              onChange={(event) => onChangeEditingName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSaveRename()
                if (event.key === "Escape") onCancelEdit()
              }}
            />
          ) : (
            <p className="truncate text-sm font-medium">{voice.name}</p>
          )}
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {t(`voiceManager.kind.${voice.kind}`)}
            {enginesLabel(voice) ? ` · ${enginesLabel(voice)}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isEditing ? (
            <>
              <button className="rounded-sm p-1 text-muted-foreground hover:text-primary" title={t("voiceManager.save")} onClick={onSaveRename}>
                <Check className="h-4 w-4" aria-hidden="true" />
              </button>
              <button className="rounded-sm p-1 text-muted-foreground hover:text-foreground" title={t("voiceManager.cancelEdit")} onClick={onCancelEdit}>
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </>
          ) : (
            <>
              <button
                className="rounded-sm p-1 text-muted-foreground hover:text-primary disabled:opacity-50"
                disabled={!previewEngineId || previewLoading}
                title={previewEngineId ? t("voiceManager.preview") : t("voiceManager.noPreviewEngine")}
                onClick={() => void runPreview()}
              >
                {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
              </button>
              <button
                className="rounded-sm p-1 text-muted-foreground hover:text-foreground"
                title={t("voiceManager.edit")}
                onClick={onStartEdit}
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                className="rounded-sm p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
                disabled={loading || exportLoading}
                title={t("voiceManager.export")}
                onClick={() => void exportVoice()}
              >
                {exportLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
              </button>
              <button className="rounded-sm p-1 text-muted-foreground hover:text-destructive" disabled={loading} title={t("voiceManager.delete")} onClick={() => onDeleteVoice(voice.id)}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>
      {previewAssetId ? (
        <audio
          className="mt-2 h-8 w-full"
          controls
          autoPlay
          preload="none"
          src={`dreamreader://asset/${encodeURIComponent(previewAssetId)}`}
        />
      ) : previewError ? (
        <p className="mt-2 text-xs text-destructive">{t("voiceManager.previewFailed")}</p>
      ) : null}
    </div>
  )
}

function enginesLabel(voice: VoiceProfile): string {
  const ids = voice.settings?.compatibleEngineIds
  return Array.isArray(ids) ? ids.map(String).join(", ") : ""
}

function fileNameForPath(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath
}

function sampleTextKeyForLanguage(language: string): string {
  return DESIGN_LANGUAGE_OPTIONS.find((option) => option.value === language)?.sampleKey ?? "voiceManager.sampleText.default.pt-BR"
}

function voiceDesignSupportsReference(model: RuntimeModel | undefined): boolean {
  const capabilities = model?.metadata.capabilities
  if (capabilities && typeof capabilities === "object" && !Array.isArray(capabilities)) {
    return (capabilities as Record<string, unknown>).supportsVoiceClone === true
  }
  return model?.metadata.supportsVoiceClone === true
}
