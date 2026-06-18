import { useEffect, useMemo, useState } from "react"
import type { TranslationFn } from "@renderer/app/types"
import {
  defaultGenerationLanguageForEngine,
  generateSeed,
  languageOptionsForEngine,
  mergeModelSettingsForEngine,
  modelSettingFieldsForEngine,
  normalizeSeed,
  sanitizeModelSettingsForEngine,
  type AudioModelSettingField
} from "@renderer/lib/audioModelSettings"
import type { AudioSettings, RuntimeModel, TtsModelSettings, VoiceProfile } from "@renderer/types"

export type GenerationQuality = "draft" | "standard" | "high"

export type ChapterGenerationParams = {
  chapterHref: string
  engineId: string
  generationLanguage?: string
  modelSettings?: TtsModelSettings
  quality: GenerationQuality
  seed?: number
  seedFixed?: boolean
  useExpressiveNarration: boolean
  voiceProfileId?: string
  paragraphLimit?: number
}

export type BatchGenerationParams = {
  chapterHrefs?: string[]
  engineId: string
  generationLanguage?: string
  modelSettings?: TtsModelSettings
  quality: GenerationQuality
  seed?: number
  seedFixed?: boolean
  useExpressiveNarration: boolean
  voiceProfileId?: string
}

export type SelectOption = { label: string; value: string }

export type GenerationConfig = {
  selectedEngineId: string
  setSelectedEngineId: (value: string) => void
  selectedVoiceId: string
  setSelectedVoiceId: (value: string) => void
  quality: GenerationQuality
  setQuality: (value: GenerationQuality) => void
  useExpressiveNarration: boolean
  setUseExpressiveNarration: (value: boolean) => void
  engineOptions: SelectOption[]
  voiceOptions: SelectOption[]
  hasCompatibleVoice: boolean
  generationLanguageOptions: SelectOption[]
  selectedGenerationLanguage: string
  setGenerationLanguage: (value: string) => void
  seed: number
  setSeed: (value: unknown) => void
  randomizeSeed: () => void
  seedFixed: boolean
  setSeedFixed: (value: boolean) => void
  selectedModelSettings: TtsModelSettings
  modelSettingsFields: AudioModelSettingField[]
  modelSettingsDialogOpen: boolean
  modelSettingsDraft: TtsModelSettings
  setModelSettingsDraft: (settings: TtsModelSettings) => void
  openModelSettings: () => void
  closeModelSettings: () => void
  saveModelSettings: () => void
  canGenerate: boolean
  canGenerateReason?: "missing_engine" | "missing_voice"
  buildChapterParams: (chapterHref: string, paragraphLimit?: number) => ChapterGenerationParams
  buildBatchParams: (chapterHrefs?: string[]) => BatchGenerationParams
}

export function useGenerationConfig({
  audioSettings,
  models,
  voices,
  t,
  onUpdateAudioSettings
}: {
  audioSettings: AudioSettings
  models: RuntimeModel[]
  voices: VoiceProfile[]
  t: TranslationFn
  onUpdateAudioSettings: (audioSettings: AudioSettings, delay?: number) => Promise<void> | void
}): GenerationConfig {
  const [selectedEngineId, setSelectedEngineId] = useState("")
  const [selectedVoiceId, setSelectedVoiceId] = useState("")
  const [modelSettingsDialogOpen, setModelSettingsDialogOpen] = useState(false)
  const [modelSettingsDraft, setModelSettingsDraft] = useState<TtsModelSettings>({})

  const installedTtsModels = useMemo(
    () => models.filter((model) => model.kind === "tts" && model.installStatus === "available" && model.engineId),
    [models]
  )
  const engineOptions = useMemo<SelectOption[]>(() => {
    const options = installedTtsModels.map((model) => ({
      label: model.name,
      value: model.engineId ?? model.id
    }))
    return options.length ? options : [{ label: t("audio.models.empty"), value: "" }]
  }, [installedTtsModels, t])
  const voiceOptions = useMemo<SelectOption[]>(() => {
    if (!selectedEngineId) {
      return [{ label: t("audio.voiceUnavailable"), value: "" }]
    }
    const compatible = compatibleVoicesForEngine(voices, selectedEngineId)
    return (compatible.length ? compatible : [{ id: "", name: t("audio.voiceUnavailable"), language: "pt-BR", kind: "built_in" }]).map(
      (voice) => ({
        label: voice.name,
        value: voice.id
      })
    )
  }, [selectedEngineId, t, voices])
  const hasCompatibleVoice = voiceOptions.some((option) => option.value)
  const canGenerateReason = !selectedEngineId ? "missing_engine" : hasCompatibleVoice ? undefined : "missing_voice"
  const selectedModelSettings = useMemo(
    () => mergeModelSettingsForEngine(selectedEngineId, audioSettings.modelSettingsByEngineId[selectedEngineId]),
    [audioSettings.modelSettingsByEngineId, selectedEngineId]
  )
  const modelSettingsFields = useMemo(() => modelSettingFieldsForEngine(selectedEngineId), [selectedEngineId])
  const generationLanguageOptions = useMemo<SelectOption[]>(
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
  const quality = audioSettings.defaultQuality ?? "standard"
  const useExpressiveNarration = audioSettings.expressiveNarrationEnabled

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

  const closeModelSettings = () => {
    setModelSettingsDialogOpen(false)
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
    if (engineOptions.some((option) => option.value === selectedEngineId)) {
      return
    }
    setSelectedEngineId(
      selectPreferredGenerationEngineId({
        defaultEngineId: audioSettings.defaultEngineId,
        engineOptions,
        voices
      })
    )
  }, [audioSettings.defaultEngineId, engineOptions, selectedEngineId, voices])

  useEffect(() => {
    if (selectedVoiceId && voiceOptions.some((option) => option.value === selectedVoiceId)) {
      return
    }
    const preferred =
      audioSettings.defaultVoiceProfileId &&
      voiceOptions.some((option) => option.value === audioSettings.defaultVoiceProfileId)
        ? audioSettings.defaultVoiceProfileId
        : voiceOptions[0]?.value ?? ""
    setSelectedVoiceId(preferred)
  }, [audioSettings.defaultVoiceProfileId, selectedVoiceId, voiceOptions])

  const buildChapterParams = (chapterHref: string, paragraphLimit?: number): ChapterGenerationParams => ({
    chapterHref,
    engineId: selectedEngineId,
    generationLanguage,
    modelSettings: selectedModelSettings,
    quality,
    seed,
    seedFixed: audioSettings.seedFixed,
    useExpressiveNarration,
    voiceProfileId: selectedVoiceId || undefined,
    paragraphLimit
  })

  const buildBatchParams = (chapterHrefs?: string[]): BatchGenerationParams => ({
    chapterHrefs,
    engineId: selectedEngineId,
    generationLanguage,
    modelSettings: selectedModelSettings,
    quality,
    seed,
    seedFixed: audioSettings.seedFixed,
    useExpressiveNarration,
    voiceProfileId: selectedVoiceId || undefined
  })

  return {
    selectedEngineId,
    setSelectedEngineId: (value: string) => {
      setSelectedEngineId(value)
      if (value) {
        updateAudioSettingsPatch({ defaultEngineId: value }, 0)
      }
    },
    selectedVoiceId,
    setSelectedVoiceId: (value: string) => {
      setSelectedVoiceId(value)
      if (value) {
        updateAudioSettingsPatch({ defaultVoiceProfileId: value }, 0)
      }
    },
    quality,
    setQuality: (value: GenerationQuality) => updateAudioSettingsPatch({ defaultQuality: value }, 0),
    useExpressiveNarration,
    setUseExpressiveNarration: (value: boolean) => updateAudioSettingsPatch({ expressiveNarrationEnabled: value }, 0),
    engineOptions,
    voiceOptions,
    hasCompatibleVoice,
    generationLanguageOptions,
    selectedGenerationLanguage,
    setGenerationLanguage: (value: string) =>
      updateAudioSettingsPatch({
        generationLanguageByEngineId: {
          ...audioSettings.generationLanguageByEngineId,
          [selectedEngineId]: value
        }
      }),
    seed,
    setSeed: (value: unknown) => updateAudioSettingsPatch({ seed: normalizeSeed(value) }),
    randomizeSeed: () => updateAudioSettingsPatch({ seed: generateSeed() }, 0),
    seedFixed: audioSettings.seedFixed,
    setSeedFixed: (value: boolean) => updateAudioSettingsPatch({ seedFixed: value }, 0),
    selectedModelSettings,
    modelSettingsFields,
    modelSettingsDialogOpen,
    modelSettingsDraft,
    setModelSettingsDraft,
    openModelSettings,
    closeModelSettings,
    saveModelSettings,
    canGenerate: Boolean(selectedEngineId) && hasCompatibleVoice,
    canGenerateReason,
    buildChapterParams,
    buildBatchParams
  }
}

export function selectPreferredGenerationEngineId({
  defaultEngineId,
  engineOptions,
  voices
}: {
  defaultEngineId?: string
  engineOptions: SelectOption[]
  voices: VoiceProfile[]
}): string {
  const availableEngineIds = engineOptions.map((option) => option.value).filter(Boolean)
  const defaultIsAvailable = Boolean(defaultEngineId && availableEngineIds.includes(defaultEngineId))
  if (defaultEngineId && defaultIsAvailable && compatibleVoicesForEngine(voices, defaultEngineId).length > 0) {
    return defaultEngineId
  }

  const compatibleEngineId = availableEngineIds.find((engineId) => compatibleVoicesForEngine(voices, engineId).length > 0)
  if (compatibleEngineId) {
    return compatibleEngineId
  }

  return defaultIsAvailable ? defaultEngineId ?? "" : availableEngineIds[0] ?? ""
}

function compatibleVoicesForEngine(voices: VoiceProfile[], engineId: string): VoiceProfile[] {
  if (!engineId) {
    return []
  }
  return voices.filter((voice) => {
    const engineIds = voice.settings?.compatibleEngineIds
    return !Array.isArray(engineIds) || engineIds.includes(engineId)
  })
}
