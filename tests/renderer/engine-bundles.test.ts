import { describe, expect, it } from "vitest"
import { buildVoiceEngineBundles, prosodyModels } from "../../src/renderer/lib/engineBundles"
import type { RuntimeModel, RuntimeSidecar } from "../../src/renderer/types"

function model(overrides: Partial<RuntimeModel> = {}): RuntimeModel {
  return {
    id: overrides.id ?? "model_1",
    kind: "tts",
    name: "Model",
    provider: "local",
    version: "1.0",
    runtime: "local",
    format: "mlx",
    acceleratorPreference: "metal",
    installStatus: "available",
    downloadProgress: 1,
    license: "test",
    canDownload: false,
    engineId: "engine-a",
    metadata: {},
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides
  }
}

function sidecar(overrides: Partial<RuntimeSidecar> = {}): RuntimeSidecar {
  return {
    id: overrides.id ?? "sidecar_1",
    adapterId: "adapter",
    name: "Sidecar",
    runtime: "python",
    status: "available",
    modelEngineIds: ["engine-a"],
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides
  }
}

describe("buildVoiceEngineBundles", () => {
  it("matches a TTS model to its sidecar by engineId", () => {
    const bundles = buildVoiceEngineBundles([model()], [sidecar()])
    expect(bundles).toHaveLength(1)
    expect(bundles[0].sidecar?.id).toBe("sidecar_1")
  })

  it("does not match a sidecar that does not power the model engineId", () => {
    const bundles = buildVoiceEngineBundles([model({ engineId: "engine-a" })], [sidecar({ modelEngineIds: ["engine-z"] })])
    expect(bundles[0].sidecar).toBeUndefined()
  })

  it("only includes TTS models", () => {
    const bundles = buildVoiceEngineBundles([model({ id: "m1" }), model({ id: "m2", kind: "llm" })], [])
    expect(bundles.map((bundle) => bundle.model.id)).toEqual(["m1"])
  })

  it("is ready when model available and sidecar available", () => {
    const bundles = buildVoiceEngineBundles([model({ installStatus: "available" })], [sidecar({ status: "available" })])
    expect(bundles[0].status).toBe("ready")
  })

  it("is ready when model available and there is no sidecar", () => {
    const bundles = buildVoiceEngineBundles([model({ installStatus: "available", engineId: "engine-a" })], [])
    expect(bundles[0].status).toBe("ready")
  })

  it("is partial when model available but sidecar not available", () => {
    const bundles = buildVoiceEngineBundles([model({ installStatus: "available" })], [sidecar({ status: "not_configured" })])
    expect(bundles[0].status).toBe("partial")
  })

  it("is partial when sidecar available but model not available", () => {
    const bundles = buildVoiceEngineBundles([model({ installStatus: "not_configured" })], [sidecar({ status: "available" })])
    expect(bundles[0].status).toBe("partial")
  })

  it("is missing when model not available and sidecar not available", () => {
    const bundles = buildVoiceEngineBundles([model({ installStatus: "not_configured" })], [sidecar({ status: "failed" })])
    expect(bundles[0].status).toBe("missing")
  })

  it("is missing when model not available and there is no sidecar", () => {
    const bundles = buildVoiceEngineBundles([model({ installStatus: "failed", engineId: "engine-a" })], [])
    expect(bundles[0].status).toBe("missing")
  })

  it("attaches one shared sidecar to multiple TTS models", () => {
    const shared = sidecar({ id: "shared", modelEngineIds: ["engine-a", "engine-b"] })
    const bundles = buildVoiceEngineBundles(
      [model({ id: "m1", engineId: "engine-a" }), model({ id: "m2", engineId: "engine-b" })],
      [shared]
    )
    expect(bundles).toHaveLength(2)
    expect(bundles[0].sidecar?.id).toBe("shared")
    expect(bundles[1].sidecar?.id).toBe("shared")
  })
})

describe("prosodyModels", () => {
  it("returns only llm models", () => {
    const result = prosodyModels([model({ id: "tts", kind: "tts" }), model({ id: "llm", kind: "llm" }), model({ id: "voc", kind: "vocoder" })])
    expect(result.map((entry) => entry.id)).toEqual(["llm"])
  })
})
