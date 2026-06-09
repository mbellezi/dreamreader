import { describe, expect, it } from "vitest"
import { pickPreviewEngineId } from "../../src/renderer/lib/voicePreview"
import type { RuntimeModel, VoiceProfile } from "../../src/renderer/types"

function model(engineId: string | undefined, overrides: Partial<RuntimeModel> = {}): RuntimeModel {
  return {
    id: `model_${engineId ?? "none"}`,
    kind: "tts",
    name: engineId ?? "model",
    provider: "local",
    version: "1.0",
    runtime: "local",
    format: "mlx",
    acceleratorPreference: "metal",
    installStatus: "available",
    downloadProgress: 1,
    license: "test",
    canDownload: false,
    engineId,
    metadata: {},
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides
  }
}

function voice(compatibleEngineIds?: unknown): VoiceProfile {
  return {
    id: "voice_1",
    name: "Voz",
    language: "pt-BR",
    kind: "cloned",
    settings: compatibleEngineIds === undefined ? undefined : { compatibleEngineIds }
  }
}

describe("pickPreviewEngineId", () => {
  it("returns the first installed model whose engineId is compatible", () => {
    const installed = [model("engine-a"), model("engine-b")]
    expect(pickPreviewEngineId(voice(["engine-b", "engine-a"]), installed)).toBe("engine-a")
  })

  it("respects installed model order, not voice list order", () => {
    const installed = [model("engine-b"), model("engine-a")]
    expect(pickPreviewEngineId(voice(["engine-a", "engine-b"]), installed)).toBe("engine-b")
  })

  it("returns undefined when no installed model is compatible", () => {
    const installed = [model("engine-x")]
    expect(pickPreviewEngineId(voice(["engine-a"]), installed)).toBeUndefined()
  })

  it("returns undefined when the voice has no compatible engine ids", () => {
    const installed = [model("engine-a")]
    expect(pickPreviewEngineId(voice(undefined), installed)).toBeUndefined()
    expect(pickPreviewEngineId(voice([]), installed)).toBeUndefined()
  })

  it("ignores installed models without an engineId", () => {
    const installed = [model(undefined), model("engine-a")]
    expect(pickPreviewEngineId(voice(["engine-a"]), installed)).toBe("engine-a")
  })
})
