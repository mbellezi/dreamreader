export const DEFAULT_VOICE_PROFILE_ID = "voice_builtin_ptbr_neutral"

export type BuiltInVoicePreset = {
  bindingKind: "preset" | "voice_design_prompt"
  description: string
  engineIds: string[]
  id: string
  language: string
  name: string
  settings: Record<string, unknown>
  source: Record<string, unknown>
  tags: string[]
}

const QWEN_17B_ENGINE_ID = "qwen3-tts-17b-mlx"

const qwenVoiceDesignPresets = [
  {
    id: "ptbr_neutral",
    name: "Qwen VoiceDesign PT-BR neutro",
    description: "Preset VoiceDesign para narracao neutra em portugues brasileiro.",
    prompt:
      "A clear neutral audiobook narrator voice speaking Brazilian Portuguese with a natural Brazilian accent, not European Portuguese. Keep the same speaker identity across every segment, with steady pacing and calm articulation."
  },
  {
    id: "ptbr_male",
    name: "Qwen VoiceDesign PT-BR masculino",
    description: "Preset VoiceDesign masculino para narracao em portugues brasileiro.",
    prompt:
      "A natural adult male audiobook narrator speaking Brazilian Portuguese with a Brazilian accent, not European Portuguese. Keep the same speaker identity across every segment, with warm tone, steady pacing, and clear diction."
  },
  {
    id: "ptbr_female",
    name: "Qwen VoiceDesign PT-BR feminino",
    description: "Preset VoiceDesign feminino para narracao em portugues brasileiro.",
    prompt:
      "A natural adult female audiobook narrator speaking Brazilian Portuguese with a Brazilian accent, not European Portuguese. Keep the same speaker identity across every segment, with warm tone, steady pacing, and clear diction."
  }
] as const

export const builtInVoicePresets: BuiltInVoicePreset[] = [
  {
    id: DEFAULT_VOICE_PROFILE_ID,
    name: "Narrador PT-BR neutro",
    description: "Voz neutra padrao para leitura em portugues brasileiro.",
    language: "pt-BR",
    tags: ["pt-BR", "narrador"],
    source: {
      provider: "dreamreader",
      preset: "pt-br-neutral"
    },
    settings: {
      preset: "pt-br-neutral"
    },
    engineIds: ["dreamreader-local-tts"],
    bindingKind: "preset"
  },
  ...qwenVoiceDesignPresets.map((preset) => ({
    id: `voice_qwen3_design_${preset.id}`,
    name: preset.name,
    description: preset.description,
    language: "pt-BR",
    tags: ["qwen3-tts", "pt-BR", "voice-design"],
    source: {
      provider: "qwen3-tts",
      preset: preset.id,
      type: "voice_design_prompt"
    },
    settings: {
      voiceDesignPrompt: preset.prompt
    },
    engineIds: [QWEN_17B_ENGINE_ID],
    bindingKind: "voice_design_prompt" as const
  }))
]

export function builtInBindingIdFor(voiceProfileId: string, engineId: string): string {
  return `voice_binding_${sanitizePathPart(voiceProfileId)}_${sanitizePathPart(engineId)}`
}

export function builtInCompatibilityFor(preset: BuiltInVoicePreset, engineId: string): Record<string, unknown> {
  return {
    builtIn: true,
    engines: preset.engineIds,
    engineId,
    languages: [preset.language],
    provider: preset.source.provider
  }
}

export function builtInSettingsFor(preset: BuiltInVoicePreset, engineId: string): Record<string, unknown> {
  return {
    ...preset.settings,
    preset: preset.source.preset
  }
}

export function builtInBindingKindFor(preset: BuiltInVoicePreset, engineId: string): "preset" | "voice_design_prompt" {
  void engineId
  return preset.bindingKind
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 96) || "voice"
}
