import type { RuntimeModel, VoiceProfile } from "@renderer/types"

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
  const match = installedTtsModels.find((model) => model.engineId != null && compatibleIds.has(model.engineId))
  return match?.engineId ?? undefined
}
