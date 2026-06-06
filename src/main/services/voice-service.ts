import type { VoiceCloneInput, VoiceFilter, VoiceProfile } from "@shared/contracts/ai"
import { AppError } from "@main/lib/errors"
import { createId } from "@main/lib/ids"

const compatibleEngineIds = ["qwen3-tts-mlx", "f5-tts-pt-br"]
const compatibleAdapterIds = ["qwen3-tts", "f5-tts-pt-br"]
const builtInCreatedAt = "2026-06-06T00:00:00.000Z"

export class VoiceService {
  private readonly voices = new Map<string, VoiceProfile>([
    [
      "voice_builtin_ptbr_neutral",
      {
        id: "voice_builtin_ptbr_neutral",
        name: "Narrador PT-BR neutro",
        description: "Voz neutra padrao para leitura em portugues brasileiro.",
        language: "pt-BR",
        kind: "built_in",
        source: { provider: "dreamreader", preset: "pt-br-neutral" },
        tags: ["pt-BR", "narrador"],
        settings: {
          compatibleEngineIds,
          compatibleAdapterIds
        },
        createdAt: builtInCreatedAt,
        updatedAt: builtInCreatedAt
      }
    ]
  ])

  list(filter: Partial<VoiceFilter> = {}): VoiceProfile[] {
    return [...this.voices.values()].filter((voice) => {
      if (filter.language && voice.language !== filter.language) return false
      if (filter.kind && voice.kind !== filter.kind) return false
      if (filter.engineId && !getStringArray(voice.settings.compatibleEngineIds).includes(filter.engineId)) return false
      if (filter.adapterId && !getStringArray(voice.settings.compatibleAdapterIds).includes(filter.adapterId)) return false
      return true
    })
  }

  listCompatible(engineId?: string) {
    return this.list(engineId ? { engineId } : {})
  }

  createFromReference(input: VoiceCloneInput): VoiceProfile {
    const now = new Date().toISOString()
    const voice: VoiceProfile = {
      id: createId("voice"),
      name: input.name,
      language: input.language,
      kind: "cloned",
      source: {
        type: "reference_audio",
        referenceAudioPath: input.referenceAudioPath,
        transcript: input.transcript ?? ""
      },
      tags: ["pt-BR", "clonada"],
      settings: {
        compatibleEngineIds: [input.engineId],
        compatibleAdapterIds
      },
      consentConfirmedAt: now,
      consentNote: input.consentNote,
      createdFromEngineId: input.engineId,
      createdAt: now,
      updatedAt: now
    }
    this.voices.set(voice.id, voice)
    return voice
  }

  preview(input: { voiceProfileId: string; engineId: string }) {
    const voice = this.voices.get(input.voiceProfileId)
    if (!voice) {
      throw new AppError("voice_not_found", "Voice profile not found")
    }
    if (!getStringArray(voice.settings.compatibleEngineIds).includes(input.engineId)) {
      throw new AppError("voice_engine_incompatible", "Voice is not compatible with this engine")
    }
    return { audioAssetId: createId("asset_voice_preview") }
  }

  update(input: { voiceProfileId: string; name?: string; description?: string | null; tags?: string[] }) {
    const voice = this.voices.get(input.voiceProfileId)
    if (!voice) {
      throw new AppError("voice_not_found", "Voice profile not found")
    }
    const updated: VoiceProfile = {
      ...voice,
      name: input.name ?? voice.name,
      description: input.description === undefined ? voice.description : input.description ?? undefined,
      tags: input.tags ?? voice.tags,
      updatedAt: new Date().toISOString()
    }
    this.voices.set(updated.id, updated)
    return updated
  }

  delete(input: { voiceProfileId: string }) {
    const voice = this.voices.get(input.voiceProfileId)
    if (!voice) {
      throw new AppError("voice_not_found", "Voice profile not found")
    }
    if (voice.kind === "built_in") {
      throw new AppError("voice_readonly", "Built-in voices cannot be deleted")
    }
    this.voices.delete(input.voiceProfileId)
    return { deleted: true as const }
  }
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}
