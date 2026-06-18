import { describe, expect, it } from "vitest"
import { selectPreferredGenerationEngineId, type SelectOption } from "../../src/renderer/app/useGenerationConfig"
import type { VoiceProfile } from "../../src/renderer/types"

function voice(id: string, compatibleEngineIds?: string[]): VoiceProfile {
  return {
    id,
    name: id,
    language: "pt-BR",
    kind: "built_in",
    settings: compatibleEngineIds ? { compatibleEngineIds } : undefined
  }
}

const engineOptions: SelectOption[] = [
  { label: "Qwen Base", value: "qwen3-tts-17b-base-mlx" },
  { label: "Qwen VoiceDesign", value: "qwen3-tts-17b-mlx" }
]

describe("selectPreferredGenerationEngineId", () => {
  it("selects the first engine with a compatible voice", () => {
    expect(
      selectPreferredGenerationEngineId({
        engineOptions,
        voices: [voice("voice-design", ["qwen3-tts-17b-mlx"])]
      })
    ).toBe("qwen3-tts-17b-mlx")
  })

  it("keeps the default engine when it can generate", () => {
    expect(
      selectPreferredGenerationEngineId({
        defaultEngineId: "qwen3-tts-17b-base-mlx",
        engineOptions,
        voices: [voice("voice-base", ["qwen3-tts-17b-base-mlx"])]
      })
    ).toBe("qwen3-tts-17b-base-mlx")
  })

  it("falls back to an available default when no engine has a compatible voice", () => {
    expect(
      selectPreferredGenerationEngineId({
        defaultEngineId: "qwen3-tts-17b-base-mlx",
        engineOptions,
        voices: []
      })
    ).toBe("qwen3-tts-17b-base-mlx")
  })
})
