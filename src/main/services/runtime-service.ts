import os from "node:os"
import path from "node:path"

import { createId } from "@main/lib/ids"

export type RuntimeDiagnostic = {
  id: string
  label: string
  status: "available" | "not_configured"
  detail: string
}

export class RuntimeService {
  listModels() {
    return [
      {
        id: "dreamreader-local-tts",
        kind: "tts",
        runtime: "node-wav-adapter",
        status: "available",
        accelerator: "cpu"
      },
      {
        id: "llm-prosody-gguf",
        kind: "llm",
        runtime: "node-llama-cpp",
        status: "not_configured",
        accelerator: process.platform === "darwin" && process.arch === "arm64" ? "metal" : "cpu"
      },
      {
        id: "qwen3-tts-mlx",
        kind: "tts",
        runtime: "mlx-sidecar",
        status: "not_configured",
        accelerator: process.platform === "darwin" && process.arch === "arm64" ? "mlx" : "cpu"
      },
      {
        id: "f5-tts-pt-br",
        kind: "tts",
        runtime: "python-pytorch",
        status: "not_configured",
        accelerator: process.platform === "darwin" && process.arch === "arm64" ? "mps" : "cpu"
      }
    ]
  }

  diagnostics(): RuntimeDiagnostic[] {
    const appleSilicon = process.platform === "darwin" && process.arch === "arm64"
    return [
      {
        id: "local-tts-adapter",
        label: "DreamReader Local TTS",
        status: "available",
        detail: "Deterministic local WAV adapter is installed for queue, cache, and player workflows"
      },
      {
        id: "device",
        label: "Device",
        status: "available",
        detail: `${os.platform()} ${os.arch()} ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`
      },
      {
        id: "apple-silicon",
        label: "Apple Silicon",
        status: appleSilicon ? "available" : "not_configured",
        detail: appleSilicon ? "MLX/Metal/MPS targets enabled by policy" : "Using portable fallback policy"
      }
    ]
  }

  installFromPath(modelPath: string) {
    const extension = path.extname(modelPath).toLowerCase().replace(".", "")
    const format = extension === "gguf" ? "gguf" : extension === "safetensors" ? "safetensors" : "unknown"
    return {
      id: createId("model"),
      path: modelPath,
      format,
      status: "registered",
      acceleratorPreference: process.platform === "darwin" && process.arch === "arm64" ? "apple_silicon" : "cpu",
      registeredAt: new Date().toISOString()
    }
  }
}
