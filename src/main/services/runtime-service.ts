import { createWriteStream } from "node:fs"
import { mkdir, rename, stat, unlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { eq } from "drizzle-orm"
import { ModelAssetSchema, ModelDownloadJobSchema, type ModelAsset, type ModelDownloadJob } from "@shared/contracts/ai"
import type { AppDatabase } from "@main/db/client"
import { modelAssets, modelDownloadJobs, ttsEngines } from "@main/db/schema"
import { AppError } from "@main/lib/errors"
import { createId } from "@main/lib/ids"
import type { AppPaths } from "@main/lib/paths"

export const QWEN_PROSODY_MODEL_ID = "model_qwen3_4b_instruct_2507_gguf_q4km"
export const QWEN_PROSODY_GGUF_FILE = "Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf"

export type RuntimeDiagnostic = {
  id: string
  label: string
  status: "available" | "not_configured"
  detail: string
}

type RecommendedModel = {
  acceleratorPreference: string
  engineId?: string
  fileName?: string
  format: "mlx" | "gguf" | "safetensors" | "checkpoint" | "unknown"
  kind: "llm" | "tts" | "tokenizer" | "vocoder" | "runtime"
  license: string
  memoryEstimateMb?: number
  metadata: Record<string, unknown>
  name: string
  provider: string
  runtime: string
  sourceUrl?: string
  version: string
  id: string
}

const recommendedModels: RecommendedModel[] = [
  {
    id: QWEN_PROSODY_MODEL_ID,
    kind: "llm",
    name: "Qwen3 4B Instruct 2507 GGUF Q4_K_M",
    provider: "Qwen",
    version: "Qwen3-4B-Instruct-2507-Q4_K_M",
    runtime: "node-llama-cpp",
    format: "gguf",
    acceleratorPreference: "metal",
    memoryEstimateMb: 4096,
    license: "apache-2.0",
    sourceUrl: `https://huggingface.co/bartowski/Qwen_Qwen3-4B-Instruct-2507-GGUF/resolve/main/${QWEN_PROSODY_GGUF_FILE}`,
    fileName: QWEN_PROSODY_GGUF_FILE,
    metadata: {
      role: "prosody",
      huggingFaceRepo: "bartowski/Qwen_Qwen3-4B-Instruct-2507-GGUF",
      quantization: "Q4_K_M"
    }
  },
  {
    id: "model_qwen3_tts_06b_base_mlx",
    kind: "tts",
    name: "Qwen3-TTS 12Hz 0.6B Base",
    provider: "Qwen",
    version: "12Hz-0.6B-Base",
    runtime: "mlx-sidecar",
    format: "mlx",
    acceleratorPreference: "mlx",
    memoryEstimateMb: 3072,
    license: "apache-2.0",
    engineId: "qwen3-tts-06b-mlx",
    metadata: {
      role: "tts",
      huggingFaceRepo: "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
      installMode: "local-folder"
    }
  },
  {
    id: "model_qwen3_tts_17b_customvoice_mlx",
    kind: "tts",
    name: "Qwen3-TTS 12Hz 1.7B CustomVoice",
    provider: "Qwen",
    version: "12Hz-1.7B-CustomVoice",
    runtime: "mlx-sidecar",
    format: "mlx",
    acceleratorPreference: "mlx",
    memoryEstimateMb: 8192,
    license: "apache-2.0",
    engineId: "qwen3-tts-17b-mlx",
    metadata: {
      role: "tts",
      huggingFaceRepo: "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
      installMode: "local-folder"
    }
  },
  {
    id: "model_f5_tts_ptbr_pytorch",
    kind: "tts",
    name: "F5-TTS PT-BR",
    provider: "firstpixel",
    version: "pt-br",
    runtime: "python-pytorch",
    format: "safetensors",
    acceleratorPreference: process.platform === "darwin" && process.arch === "arm64" ? "mps" : "cpu",
    memoryEstimateMb: 6144,
    license: "cc-by-nc-4.0",
    engineId: "f5-tts-pt-br",
    metadata: {
      role: "tts",
      huggingFaceRepo: "firstpixel/F5-TTS-pt-br",
      installMode: "local-folder"
    }
  }
]

export class RuntimeService {
  private readonly activeDownloads = new Map<string, string>()
  private readyPromise: Promise<void> | undefined

  constructor(
    private readonly db: AppDatabase,
    private readonly paths: AppPaths
  ) {}

  async listModels(): Promise<ModelAsset[]> {
    await this.ensureReady()
    const rows = await this.db.query.modelAssets.findMany()
    const order = new Map(recommendedModels.map((model, index) => [model.id, index]))
    return rows
      .map(toModelAsset)
      .sort((a, b) => (order.get(a.id) ?? 1000) - (order.get(b.id) ?? 1000) || a.name.localeCompare(b.name))
  }

  async diagnostics(): Promise<RuntimeDiagnostic[]> {
    const appleSilicon = process.platform === "darwin" && process.arch === "arm64"
    const models = await this.listModels()
    const qwenProsody = models.find((model) => model.id === QWEN_PROSODY_MODEL_ID)
    return [
      {
        id: "local-tts-adapter",
        label: "DreamReader Local TTS",
        status: "available",
        detail: "Deterministic local WAV adapter is installed for queue, cache, and player workflows"
      },
      {
        id: "qwen-prosody-gguf",
        label: "Qwen GGUF Prosody",
        status: qwenProsody?.installStatus === "available" ? "available" : "not_configured",
        detail:
          qwenProsody?.installStatus === "available"
            ? "Qwen3-4B-Instruct-2507 GGUF Q4_K_M is registered for structured prosody analysis"
            : "Qwen3-4B-Instruct-2507 GGUF Q4_K_M is recommended but not installed"
      },
      {
        id: "local-prosody-analyzer",
        label: "Local Prosody Analyzer",
        status: "available",
        detail: "Structured local prosody analyzer remains available as fallback"
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

  async installFromPath(modelPath: string): Promise<ModelAsset> {
    await this.ensureReady()
    const info = await stat(modelPath)
    const model = modelForPath(modelPath)
    const installedAt = new Date()
    const [updated] = await this.db
      .insert(modelAssets)
      .values({
        id: model.id,
        kind: model.kind,
        name: model.name,
        provider: model.provider,
        version: model.version,
        path: modelPath,
        sizeBytes: info.isFile() ? info.size : undefined,
        license: model.license,
        runtime: model.runtime,
        format: model.format,
        acceleratorPreference: model.acceleratorPreference,
        memoryEstimateMb: model.memoryEstimateMb,
        sourceUrl: model.sourceUrl,
        installStatus: "available",
        downloadProgress: 1,
        metadataJson: {
          ...model.metadata,
          engineId: model.engineId,
          registeredFrom: "local-path"
        },
        installedAt,
        updatedAt: installedAt
      })
      .onConflictDoUpdate({
        target: modelAssets.id,
        set: {
          path: modelPath,
          sizeBytes: info.isFile() ? info.size : undefined,
          installStatus: "available",
          downloadProgress: 1,
          metadataJson: {
            ...model.metadata,
            engineId: model.engineId,
            registeredFrom: "local-path"
          },
          installedAt,
          updatedAt: installedAt
        }
      })
      .returning()
    if (model.engineId) {
      await this.markTtsEngineInstalled(model, modelPath)
    }
    return toModelAsset(updated)
  }

  async downloadModel(modelId: string): Promise<ModelDownloadJob> {
    await this.ensureReady()
    const model = await this.db.query.modelAssets.findFirst({ where: eq(modelAssets.id, modelId) })
    if (!model) {
      throw new AppError("model_not_found", "Model not found")
    }
    if (!model.sourceUrl) {
      throw new AppError("model_download_unavailable", "This model must be installed from a local folder")
    }
    const activeJobId = this.activeDownloads.get(modelId)
    if (activeJobId) {
      const active = await this.db.query.modelDownloadJobs.findFirst({
        where: eq(modelDownloadJobs.id, activeJobId)
      })
      if (active) {
        return toModelDownloadJob(active)
      }
    }

    const recommended = recommendedModels.find((item) => item.id === modelId)
    const targetDir = path.join(this.paths.modelsDir, modelId)
    const targetPath = path.join(targetDir, recommended?.fileName ?? path.basename(new URL(model.sourceUrl).pathname))
    const now = new Date()
    const [job] = await this.db
      .insert(modelDownloadJobs)
      .values({
        id: createId("model_download"),
        modelAssetId: modelId,
        status: "queued",
        sourceUrl: model.sourceUrl,
        targetPath,
        updatedAt: now
      })
      .returning()

    await this.updateModelDownloadState(modelId, "queued", 0)
    this.activeDownloads.set(modelId, job.id)
    void this.runDownload(toModelDownloadJob(job), modelId)
    return toModelDownloadJob(job)
  }

  private async runDownload(job: ModelDownloadJob, modelId: string): Promise<void> {
    const tempPath = `${job.targetPath}.part`
    try {
      await mkdir(path.dirname(job.targetPath), { recursive: true })
      await this.updateDownloadJob(job.id, {
        status: "downloading",
        startedAt: new Date(),
        progress: 0
      })
      await this.updateModelDownloadState(modelId, "downloading", 0)

      const response = await fetch(job.sourceUrl)
      if (!response.ok || !response.body) {
        throw new Error(`download_failed_${response.status}`)
      }
      const totalBytes = Number(response.headers.get("content-length") ?? 0) || undefined
      const reader = response.body.getReader()
      const stream = createWriteStream(tempPath)
      let receivedBytes = 0
      let lastUpdate = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        receivedBytes += value.byteLength
        await writeChunk(stream, value)
        const progress = totalBytes ? Math.min(receivedBytes / totalBytes, 0.999) : 0
        const now = Date.now()
        if (now - lastUpdate > 400) {
          lastUpdate = now
          await this.updateDownloadJob(job.id, { progress, receivedBytes, totalBytes })
          await this.updateModelDownloadState(modelId, "downloading", progress)
        }
      }

      await closeStream(stream)
      await rename(tempPath, job.targetPath)
      const info = await stat(job.targetPath)
      const finishedAt = new Date()
      await this.updateDownloadJob(job.id, {
        status: "available",
        progress: 1,
        receivedBytes: info.size,
        totalBytes: totalBytes ?? info.size,
        finishedAt
      })
      await this.db
        .update(modelAssets)
        .set({
          path: job.targetPath,
          sizeBytes: info.size,
          installStatus: "available",
          downloadProgress: 1,
          installedAt: finishedAt,
          updatedAt: finishedAt
        })
        .where(eq(modelAssets.id, modelId))
      const recommended = recommendedModels.find((model) => model.id === modelId)
      if (recommended?.engineId) {
        await this.markTtsEngineInstalled(recommended, job.targetPath)
      }
    } catch (error) {
      await unlink(tempPath).catch(() => undefined)
      const message = error instanceof Error ? error.message : "Model download failed"
      await this.updateDownloadJob(job.id, {
        status: "failed",
        progress: 1,
        errorCode: "model_download_failed",
        errorMessage: message,
        finishedAt: new Date()
      })
      await this.updateModelDownloadState(modelId, "failed", 1)
    } finally {
      this.activeDownloads.delete(modelId)
    }
  }

  private async ensureReady(): Promise<void> {
    this.readyPromise ??= this.ensureCatalog()
    await this.readyPromise
  }

  private async ensureCatalog(): Promise<void> {
    await mkdir(this.paths.modelsDir, { recursive: true })
    for (const model of recommendedModels) {
      const existing = await this.db.query.modelAssets.findFirst({ where: eq(modelAssets.id, model.id) })
      const possiblePath = model.fileName ? path.join(this.paths.modelsDir, model.id, model.fileName) : undefined
      const pathExists = possiblePath ? await exists(possiblePath) : false
      const installStatus = existing?.installStatus === "available" || pathExists ? "available" : existing?.installStatus ?? "not_configured"
      const downloadProgress = installStatus === "available" ? 1 : existing?.downloadProgress ?? 0
      await this.db
        .insert(modelAssets)
        .values({
          id: model.id,
          kind: model.kind,
          name: model.name,
          provider: model.provider,
          version: model.version,
          path: existing?.path ?? (pathExists ? possiblePath : undefined),
          sizeBytes: existing?.sizeBytes,
          checksum: existing?.checksum,
          license: model.license,
          runtime: model.runtime,
          format: model.format,
          acceleratorPreference: model.acceleratorPreference,
          memoryEstimateMb: model.memoryEstimateMb,
          checksumAlgorithm: existing?.checksumAlgorithm,
          sourceUrl: model.sourceUrl,
          installStatus,
          downloadProgress,
          metadataJson: {
            ...model.metadata,
            engineId: model.engineId
          },
          installedAt: existing?.installedAt ?? (pathExists ? new Date() : undefined),
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: modelAssets.id,
          set: {
            name: model.name,
            provider: model.provider,
            version: model.version,
            license: model.license,
            runtime: model.runtime,
            format: model.format,
            acceleratorPreference: model.acceleratorPreference,
            memoryEstimateMb: model.memoryEstimateMb,
            sourceUrl: model.sourceUrl,
            installStatus,
            downloadProgress,
            metadataJson: {
              ...model.metadata,
              engineId: model.engineId
            },
            updatedAt: new Date()
          }
        })
    }
  }

  private async updateModelDownloadState(modelId: string, status: ModelAsset["installStatus"], progress: number): Promise<void> {
    await this.db
      .update(modelAssets)
      .set({
        installStatus: status,
        downloadProgress: Math.min(Math.max(progress, 0), 1),
        updatedAt: new Date()
      })
      .where(eq(modelAssets.id, modelId))
  }

  private async updateDownloadJob(id: string, patch: Partial<typeof modelDownloadJobs.$inferInsert>): Promise<void> {
    await this.db
      .update(modelDownloadJobs)
      .set({
        ...patch,
        updatedAt: new Date()
      })
      .where(eq(modelDownloadJobs.id, id))
  }

  private async markTtsEngineInstalled(model: RecommendedModel, installPath: string): Promise<void> {
    if (!model.engineId) {
      return
    }

    const now = new Date()
    await this.db
      .insert(ttsEngines)
      .values({
        id: model.engineId,
        displayName: model.name,
        version: model.version,
        adapterId: adapterIdForEngine(model.engineId),
        runtime: runtimeForModel(model),
        modelFormat: model.format,
        accelerator: acceleratorForModel(model),
        capabilitiesJson: {
          id: model.engineId,
          displayName: model.name,
          runtime: runtimeForModel(model),
          modelFormat: model.format,
          languages: model.engineId === "f5-tts-pt-br" ? ["pt-BR"] : ["pt-BR", "en"]
        },
        performanceProfileJson: {
          mode: model.runtime,
          requiresSidecar: true
        },
        installed: true,
        installPath,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: ttsEngines.id,
        set: {
          installed: true,
          installPath,
          updatedAt: now
        }
      })
  }
}

function modelForPath(modelPath: string): RecommendedModel {
  const normalized = path.basename(modelPath).toLowerCase()
  if (normalized.endsWith(".gguf") || normalized.includes("qwen3-4b-instruct-2507")) {
    return recommendedModels[0]
  }
  if (normalized.includes("qwen3-tts") && normalized.includes("1.7b")) {
    return recommendedModels[2]
  }
  if (normalized.includes("qwen3-tts")) {
    return recommendedModels[1]
  }
  if (normalized.includes("f5") || normalized.endsWith(".safetensors")) {
    return recommendedModels[3]
  }
  return {
    id: createId("model"),
    kind: "runtime",
    name: path.basename(modelPath),
    provider: "local",
    version: "local",
    runtime: "external",
    format: "unknown",
    acceleratorPreference: "cpu",
    license: "unknown",
    metadata: {
      role: "runtime"
    }
  }
}

function toModelAsset(row: typeof modelAssets.$inferSelect): ModelAsset {
  return ModelAssetSchema.parse({
    id: row.id,
    kind: row.kind,
    name: row.name,
    provider: row.provider,
    version: row.version,
    runtime: row.runtime,
    format: row.format,
    acceleratorPreference: row.acceleratorPreference,
    installStatus: row.installStatus,
    downloadProgress: row.downloadProgress,
    path: row.path ?? undefined,
    sizeBytes: row.sizeBytes ?? undefined,
    checksum: row.checksum ?? undefined,
    checksumAlgorithm: row.checksumAlgorithm ?? undefined,
    license: row.license,
    memoryEstimateMb: row.memoryEstimateMb ?? undefined,
    sourceUrl: row.sourceUrl ?? undefined,
    canDownload: Boolean(row.sourceUrl),
    engineId: getString(row.metadataJson.engineId),
    metadata: row.metadataJson,
    installedAt: optionalDate(row.installedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  })
}

function toModelDownloadJob(row: typeof modelDownloadJobs.$inferSelect): ModelDownloadJob {
  return ModelDownloadJobSchema.parse({
    id: row.id,
    modelAssetId: row.modelAssetId,
    status: row.status,
    progress: row.progress,
    receivedBytes: row.receivedBytes,
    totalBytes: row.totalBytes ?? undefined,
    sourceUrl: row.sourceUrl,
    targetPath: row.targetPath,
    errorCode: row.errorCode ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    createdAt: toIso(row.createdAt),
    startedAt: optionalDate(row.startedAt),
    finishedAt: optionalDate(row.finishedAt),
    updatedAt: toIso(row.updatedAt)
  })
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

function writeChunk(stream: ReturnType<typeof createWriteStream>, chunk: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (error) => (error ? reject(error) : resolve()))
  })
}

function closeStream(stream: ReturnType<typeof createWriteStream>): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.end((error?: Error | null) => (error ? reject(error) : resolve()))
  })
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function optionalDate(value: Date | string | null | undefined): string | undefined {
  return value ? toIso(value) : undefined
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}

function adapterIdForEngine(engineId: string): string {
  if (engineId.startsWith("qwen3-tts-")) {
    return "qwen3-tts-mlx"
  }
  if (engineId === "f5-tts-pt-br") {
    return "f5-tts-pt-br"
  }
  return "external"
}

function runtimeForModel(model: RecommendedModel): string {
  if (model.runtime.includes("mlx")) {
    return "mlx"
  }
  if (model.runtime.includes("pytorch")) {
    return "pytorch"
  }
  return "external"
}

function acceleratorForModel(model: RecommendedModel): string {
  if (model.acceleratorPreference === "mlx" || model.acceleratorPreference === "metal") {
    return "apple_metal"
  }
  if (model.acceleratorPreference === "mps") {
    return "apple_mps"
  }
  return "cpu"
}
