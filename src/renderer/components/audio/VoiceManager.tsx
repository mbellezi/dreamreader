import { AlertTriangle, Check, FileAudio, Loader2, Mic2, Pencil, Play, Plus, Sparkles, Trash2, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { SelectField } from "@renderer/components/common/Controls"
import type { TranslationFn } from "@renderer/app/types"
import { cn } from "@renderer/lib/utils"
import { pickPreviewEngineId } from "@renderer/lib/voicePreview"
import type { RuntimeModel, VoiceProfile } from "@renderer/types"

const CLONE_ENGINE_IDS = ["qwen3-tts-06b-mlx", "qwen3-tts-17b-base-mlx", "chatterbox-multilingual-mlx", "f5-tts-pt-br"]
const DESIGN_ENGINE_ID = "qwen3-tts-17b-mlx"
const REFERENCE_WARN_MS = 12_000

export function VoiceManager({
  voices,
  models,
  loading,
  t,
  onCreateVoiceFromReference,
  onCreateVoiceFromDesignPrompt,
  onUpdateVoice,
  onDeleteVoice,
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
  onCreateVoiceFromDesignPrompt: (input: { engineId: string; language: string; name: string; prompt: string }) => Promise<VoiceProfile | void> | VoiceProfile | void
  onUpdateVoice: (input: { voiceProfileId: string; name: string }) => Promise<void> | void
  onDeleteVoice: (voiceProfileId: string) => Promise<void> | void
  onSelectVoiceReferenceAudio: () => Promise<{ path: string; durationMs?: number; sampleRate?: number } | null>
  onPreviewVoice: (voiceProfileId: string, engineId: string) => Promise<string | null>
}) {
  const [mode, setMode] = useState<"reference" | "design">("reference")
  const [referenceName, setReferenceName] = useState("")
  const [referenceAudioPath, setReferenceAudioPath] = useState("")
  const [referenceDurationMs, setReferenceDurationMs] = useState<number | undefined>(undefined)
  const [referenceTranscript, setReferenceTranscript] = useState("")
  const [referenceConsentNote, setReferenceConsentNote] = useState("")
  const [referenceConsentConfirmed, setReferenceConsentConfirmed] = useState(false)
  const [designEngineId, setDesignEngineId] = useState(DESIGN_ENGINE_ID)
  const [designName, setDesignName] = useState("")
  const [designPrompt, setDesignPrompt] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState("")

  const installedTtsModels = useMemo(
    () => models.filter((model) => model.kind === "tts" && model.installStatus === "available" && model.engineId),
    [models]
  )
  const hasCloneEngine = installedTtsModels.some((model) => CLONE_ENGINE_IDS.includes(model.engineId ?? ""))
  const designEngineOptions = useMemo(
    () => installedTtsModels.filter((model) => model.engineId === DESIGN_ENGINE_ID).map((model) => ({ label: model.name, value: model.engineId ?? model.id })),
    [installedTtsModels]
  )
  const customVoices = useMemo(() => voices.filter((voice) => voice.kind === "cloned" || voice.kind === "generated" || voice.kind === "imported"), [voices])

  const referenceTooLong = typeof referenceDurationMs === "number" && referenceDurationMs > REFERENCE_WARN_MS
  const canCreateReference =
    Boolean(referenceName.trim()) &&
    Boolean(referenceAudioPath) &&
    Boolean(referenceTranscript.trim()) &&
    Boolean(referenceConsentNote.trim()) &&
    referenceConsentConfirmed &&
    !loading
  const canCreateDesign = Boolean(designEngineId) && Boolean(designName.trim()) && Boolean(designPrompt.trim()) && !loading

  useEffect(() => {
    if (!designEngineOptions.some((option) => option.value === designEngineId)) {
      setDesignEngineId(designEngineOptions[0]?.value ?? DESIGN_ENGINE_ID)
    }
  }, [designEngineId, designEngineOptions])

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
  }

  const createDesign = async () => {
    if (!canCreateDesign) {
      return
    }
    await onCreateVoiceFromDesignPrompt({ engineId: designEngineId, language: "pt-BR", name: designName.trim(), prompt: designPrompt.trim() })
    setDesignName("")
    setDesignPrompt("")
  }

  const saveRename = async (voiceProfileId: string) => {
    if (editingName.trim()) {
      await onUpdateVoice({ voiceProfileId, name: editingName.trim() })
    }
    setEditingId(null)
    setEditingName("")
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-md border bg-card p-3">
        <div className="grid grid-cols-2 gap-1 rounded-md border bg-background p-1">
          <button
            className={cn("inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-sm px-2 text-xs text-muted-foreground", mode === "reference" && "bg-card text-foreground shadow-sm")}
            onClick={() => setMode("reference")}
          >
            <Mic2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{t("voiceManager.reference")}</span>
          </button>
          <button
            className={cn("inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-sm px-2 text-xs text-muted-foreground", mode === "design" && "bg-card text-foreground shadow-sm")}
            onClick={() => setMode("design")}
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{t("voiceManager.design")}</span>
          </button>
        </div>

        {mode === "reference" ? (
          <div className="grid grid-cols-1 gap-2">
            <p className="text-xs text-muted-foreground">{t("voiceManager.referenceShared")}</p>
            {!hasCloneEngine ? (
              <p className="rounded-md border bg-background p-2 text-xs text-muted-foreground">{t("voiceManager.noCloneEngine")}</p>
            ) : null}
            <input
              className="h-9 rounded-md border bg-background px-3 text-sm outline-none"
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
              className="min-h-20 rounded-md border bg-background px-3 py-2 text-sm outline-none"
              placeholder={t("voiceManager.transcript")}
              value={referenceTranscript}
              onChange={(event) => setReferenceTranscript(event.target.value)}
            />
            <input
              className="h-9 rounded-md border bg-background px-3 text-sm outline-none"
              placeholder={t("voiceManager.consentNote")}
              value={referenceConsentNote}
              onChange={(event) => setReferenceConsentNote(event.target.value)}
            />
            <label className="flex items-center justify-between rounded-md border bg-background p-3 text-sm">
              <span>{t("voiceManager.consent")}</span>
              <input className="h-4 w-4 accent-primary" type="checkbox" checked={referenceConsentConfirmed} onChange={(event) => setReferenceConsentConfirmed(event.target.checked)} />
            </label>
            <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm" disabled={!canCreateReference} onClick={createReference}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("voiceManager.createReference")}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            <p className="text-xs text-muted-foreground">{t("voiceManager.designHint")}</p>
            <SelectField
              label={t("voiceManager.engine")}
              options={designEngineOptions.length ? designEngineOptions : [{ label: t("voiceManager.noDesignEngine"), value: "" }]}
              value={designEngineId}
              onChange={setDesignEngineId}
            />
            <input
              className="h-9 rounded-md border bg-background px-3 text-sm outline-none"
              placeholder={t("voiceManager.name")}
              value={designName}
              onChange={(event) => setDesignName(event.target.value)}
            />
            <textarea
              className="min-h-24 rounded-md border bg-background px-3 py-2 text-sm outline-none"
              placeholder={t("voiceManager.designPrompt")}
              value={designPrompt}
              onChange={(event) => setDesignPrompt(event.target.value)}
            />
            <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm" disabled={!canCreateDesign} onClick={createDesign}>
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {t("voiceManager.createDesign")}
            </button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t("voiceManager.listTitle")}</h3>
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
            />
          ))
        ) : (
          <p className="rounded-md border bg-card p-3 text-sm text-muted-foreground">{t("voiceManager.empty")}</p>
        )}
      </div>
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
  onDeleteVoice
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
}) {
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState(false)

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
