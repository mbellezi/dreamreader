import type { TtsModelSettings } from "@renderer/types"

export type AudioModelSettingField = {
  key: keyof TtsModelSettings
  kind: "boolean" | "number"
  labelKey: string
  descriptionKey: string
  max?: number
  min?: number
  step?: number
}

export type AudioLanguageOption = {
  labelKey: string
  value: string
}

const qwenDefaults: TtsModelSettings = {
  doSample: true,
  maxNewTokens: 8192,
  nonStreamingMode: true,
  repetitionPenalty: 1.05,
  subtalkerDoSample: true,
  subtalkerTemperature: 0.9,
  subtalkerTopK: 50,
  subtalkerTopP: 1,
  temperature: 0.9,
  topK: 50,
  topP: 1
}

const f5Defaults: TtsModelSettings = {
  cfgStrength: 2,
  crossFadeDuration: 0.15,
  nfeStep: 32,
  removeSilence: false,
  speed: 1,
  swaySamplingCoef: -1,
  targetRms: 0.1
}

const chatterboxDefaults: TtsModelSettings = {
  cfgWeight: 0.5,
  exaggeration: 0.5,
  maxNewTokens: 2048,
  temperature: 0.8
}

const qwenFields: AudioModelSettingField[] = [
  numberField("temperature", 0, 2, 0.05),
  numberField("topK", 0, 200, 1),
  numberField("topP", 0, 1, 0.01),
  numberField("repetitionPenalty", 0, 3, 0.01),
  numberField("maxNewTokens", 1, 32768, 128),
  booleanField("doSample"),
  booleanField("nonStreamingMode"),
  booleanField("subtalkerDoSample"),
  numberField("subtalkerTemperature", 0, 2, 0.05),
  numberField("subtalkerTopK", 0, 200, 1),
  numberField("subtalkerTopP", 0, 1, 0.01)
]

const f5Fields: AudioModelSettingField[] = [
  numberField("nfeStep", 1, 128, 1),
  numberField("cfgStrength", 0, 10, 0.1),
  numberField("swaySamplingCoef", -10, 10, 0.1),
  numberField("speed", 0.25, 2, 0.05),
  numberField("targetRms", 0, 1, 0.01),
  numberField("crossFadeDuration", 0, 2, 0.01),
  booleanField("removeSilence")
]

const chatterboxFields: AudioModelSettingField[] = [
  numberField("temperature", 0, 2, 0.05),
  numberField("exaggeration", 0, 1.5, 0.05),
  numberField("cfgWeight", 0, 2, 0.05),
  numberField("maxNewTokens", 1, 32768, 128)
]

const qwenLanguageOptions: AudioLanguageOption[] = [
  { labelKey: "audio.language.auto", value: "Auto" },
  { labelKey: "audio.language.portuguese", value: "Portuguese" },
  { labelKey: "audio.language.english", value: "English" },
  { labelKey: "audio.language.chinese", value: "Chinese" },
  { labelKey: "audio.language.japanese", value: "Japanese" },
  { labelKey: "audio.language.korean", value: "Korean" },
  { labelKey: "audio.language.german", value: "German" },
  { labelKey: "audio.language.french", value: "French" },
  { labelKey: "audio.language.russian", value: "Russian" },
  { labelKey: "audio.language.spanish", value: "Spanish" },
  { labelKey: "audio.language.italian", value: "Italian" }
]

const chatterboxLanguageOptions: AudioLanguageOption[] = [
  { labelKey: "audio.language.portuguese", value: "pt" },
  { labelKey: "audio.language.english", value: "en" },
  { labelKey: "audio.language.spanish", value: "es" },
  { labelKey: "audio.language.french", value: "fr" },
  { labelKey: "audio.language.german", value: "de" },
  { labelKey: "audio.language.italian", value: "it" },
  { labelKey: "audio.language.japanese", value: "ja" },
  { labelKey: "audio.language.korean", value: "ko" },
  { labelKey: "audio.language.chinese", value: "zh" },
  { labelKey: "audio.language.arabic", value: "ar" },
  { labelKey: "audio.language.danish", value: "da" },
  { labelKey: "audio.language.greek", value: "el" },
  { labelKey: "audio.language.finnish", value: "fi" },
  { labelKey: "audio.language.hebrew", value: "he" },
  { labelKey: "audio.language.hindi", value: "hi" },
  { labelKey: "audio.language.malay", value: "ms" },
  { labelKey: "audio.language.dutch", value: "nl" },
  { labelKey: "audio.language.norwegian", value: "no" },
  { labelKey: "audio.language.polish", value: "pl" },
  { labelKey: "audio.language.russian", value: "ru" },
  { labelKey: "audio.language.swedish", value: "sv" },
  { labelKey: "audio.language.swahili", value: "sw" },
  { labelKey: "audio.language.turkish", value: "tr" }
]

export function defaultModelSettingsForEngine(engineId: string): TtsModelSettings {
  if (isQwenEngine(engineId)) {
    return { ...qwenDefaults }
  }
  if (isChatterboxEngine(engineId)) {
    return { ...chatterboxDefaults }
  }
  if (engineId === "f5-tts-pt-br") {
    return { ...f5Defaults }
  }
  return {}
}

export function modelSettingFieldsForEngine(engineId: string): AudioModelSettingField[] {
  if (isQwenEngine(engineId)) {
    return qwenFields
  }
  if (isChatterboxEngine(engineId)) {
    return chatterboxFields
  }
  if (engineId === "f5-tts-pt-br") {
    return f5Fields
  }
  return []
}

export function languageOptionsForEngine(engineId: string): AudioLanguageOption[] {
  if (isQwenEngine(engineId)) {
    return qwenLanguageOptions
  }
  if (isChatterboxEngine(engineId)) {
    return chatterboxLanguageOptions
  }
  return []
}

export function defaultGenerationLanguageForEngine(engineId: string): string | undefined {
  if (isQwenEngine(engineId)) {
    return "Portuguese"
  }
  if (isChatterboxEngine(engineId)) {
    return "pt"
  }
  return undefined
}

export function mergeModelSettingsForEngine(engineId: string, settings: TtsModelSettings | undefined): TtsModelSettings {
  return sanitizeModelSettingsForEngine(engineId, {
    ...defaultModelSettingsForEngine(engineId),
    ...settings
  })
}

export function sanitizeModelSettingsForEngine(engineId: string, settings: TtsModelSettings): TtsModelSettings {
  const fields = modelSettingFieldsForEngine(engineId)
  const next: TtsModelSettings = {}
  const output = next as Record<string, unknown>
  for (const field of fields) {
    const value = settings[field.key]
    if (field.kind === "boolean") {
      output[field.key] = Boolean(value)
    } else {
      const fallback = defaultModelSettingsForEngine(engineId)[field.key]
      output[field.key] = clampNumber(value, field, Number(fallback ?? field.min ?? 0))
    }
  }
  return next
}

export function generateSeed(): number {
  return Math.floor(Math.random() * 4_294_967_296)
}

export function normalizeSeed(value: unknown): number {
  const seed = Math.floor(Number(value))
  if (!Number.isFinite(seed)) {
    return generateSeed()
  }
  return Math.min(Math.max(seed, 0), 4_294_967_295)
}

function isQwenEngine(engineId: string): boolean {
  return engineId.startsWith("qwen3-tts-")
}

function isChatterboxEngine(engineId: string): boolean {
  return engineId === "chatterbox-multilingual-mlx"
}

function booleanField(key: keyof TtsModelSettings): AudioModelSettingField {
  return {
    key,
    kind: "boolean",
    labelKey: `audio.modelSettings.field.${key}`,
    descriptionKey: `audio.modelSettings.field.${key}.description`
  }
}

function numberField(key: keyof TtsModelSettings, min: number, max: number, step: number): AudioModelSettingField {
  return {
    key,
    kind: "number",
    labelKey: `audio.modelSettings.field.${key}`,
    descriptionKey: `audio.modelSettings.field.${key}.description`,
    min,
    max,
    step
  }
}

function clampNumber(value: unknown, field: AudioModelSettingField, fallback: number): number {
  const numberValue = Number(value)
  const min = field.min ?? Number.NEGATIVE_INFINITY
  const max = field.max ?? Number.POSITIVE_INFINITY
  if (!Number.isFinite(numberValue)) {
    return fallback
  }
  return Math.min(Math.max(numberValue, min), max)
}
