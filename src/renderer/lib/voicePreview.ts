import type { RuntimeModel, VoiceProfile } from "@renderer/types"

const VOICE_GENERATION_ONLY_ENGINE_IDS = new Set(["qwen3-tts-17b-mlx"])

/**
 * Picks the engine id to use when previewing a custom voice.
 *
 * Returns the engineId of the first installed TTS model whose engineId is listed
 * in the voice's `settings.compatibleEngineIds`. Returns `undefined` when none match.
 */
export function pickPreviewEngineId(voice: VoiceProfile, installedTtsModels: RuntimeModel[]): string | undefined {
  const compatible = voice.settings?.compatibleEngineIds
  if (!Array.isArray(compatible) || compatible.length === 0) {
    return undefined
  }
  const compatibleIds = new Set(compatible.map(String))
  const match = installedTtsModels.find(
    (model) =>
      model.engineId != null &&
      compatibleIds.has(model.engineId) &&
      !VOICE_GENERATION_ONLY_ENGINE_IDS.has(model.engineId)
  )
  return match?.engineId ?? undefined
}
