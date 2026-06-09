import type { RuntimeModel, RuntimeSidecar } from "@renderer/types"

export type VoiceEngineBundleStatus = "ready" | "partial" | "missing"

export type VoiceEngineBundle = {
  model: RuntimeModel
  sidecar?: RuntimeSidecar
  status: VoiceEngineBundleStatus
}

function sidecarForModel(model: RuntimeModel, sidecars: RuntimeSidecar[]): RuntimeSidecar | undefined {
  if (!model.engineId) {
    return undefined
  }
  return sidecars.find((sidecar) => model.engineId !== undefined && sidecar.modelEngineIds.includes(model.engineId))
}

function bundleStatus(model: RuntimeModel, sidecar: RuntimeSidecar | undefined): VoiceEngineBundleStatus {
  const modelReady = model.installStatus === "available"
  const sidecarAvailable = sidecar?.status === "available"
  const sidecarReady = !sidecar || sidecarAvailable

  if (modelReady && sidecarReady) {
    return "ready"
  }
  if (!modelReady && !sidecarAvailable) {
    return "missing"
  }
  // model available but sidecar missing, or sidecar available but model missing
  return "partial"
}

export function buildVoiceEngineBundles(models: RuntimeModel[], sidecars: RuntimeSidecar[]): VoiceEngineBundle[] {
  return models
    .filter((model) => model.kind === "tts")
    .map((model) => {
      const sidecar = sidecarForModel(model, sidecars)
      return { model, sidecar, status: bundleStatus(model, sidecar) }
    })
}

export function prosodyModels(models: RuntimeModel[]): RuntimeModel[] {
  return models.filter((model) => model.kind === "llm")
}
