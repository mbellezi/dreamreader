import { spawn } from "node:child_process"
import { createWriteStream } from "node:fs"
import { mkdir, readdir, rename, rm, stat, symlink, unlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { desc, eq } from "drizzle-orm"
import {
  ModelAssetSchema,
  ModelDownloadJobSchema,
  HuggingFaceTokenStatusSchema,
  RuntimeInstallBackendSchema,
  RuntimeOperationJobSchema,
  RuntimeSidecarSchema,
  type HuggingFaceTokenStatus,
  type ModelAsset,
  type ModelDownloadJob,
  type RuntimeInstallBackend,
  type RuntimeOperationJob,
  type RuntimeOperationKind,
  type RuntimeSidecar
} from "@shared/contracts/ai"
import type { JsonValue } from "@shared/contracts/common"
import type { AppDatabase } from "@main/db/client"
import { modelAssets, modelDownloadJobs, runtimeManifests, settings as settingsTable, ttsEngines } from "@main/db/schema"
import { AppError } from "@main/lib/errors"
import { createId } from "@main/lib/ids"
import type { AppPaths } from "@main/lib/paths"

export const QWEN_PROSODY_MODEL_ID = "model_qwen3_4b_instruct_2507_gguf_q4km"
export const QWEN_PROSODY_GGUF_FILE = "Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf"
export const CHATTERBOX_MULTILINGUAL_MODEL_DIR_NAME = "chatterbox-multilingual-mlx"
export const F5_TTS_MODEL_DIR_NAME = "f5-tts-pt-br"
export const QWEN3_TTS_06B_MODEL_DIR_NAME = "qwen3-tts-06b-mlx"
export const QWEN3_TTS_17B_MODEL_DIR_NAME = "qwen3-tts-17b-mlx"
export const QWEN3_TTS_17B_BASE_MODEL_DIR_NAME = "qwen3-tts-17b-base-mlx"

export type RuntimeDiagnostic = {
  id: string
  label: string
  status: "available" | "not_configured"
  detail: string
}

const HUGGING_FACE_TOKEN_SETTINGS_KEY = "secrets.huggingFaceToken"

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
      installMode: "user-data-folder",
      localFolder: `models/${QWEN3_TTS_06B_MODEL_DIR_NAME}`,
      supportedBackends: ["mlx"]
    }
  },
  {
    id: "model_qwen3_tts_17b_customvoice_mlx",
    kind: "tts",
    name: "Qwen3-TTS 12Hz 1.7B VoiceDesign",
    provider: "Qwen",
    version: "12Hz-1.7B-VoiceDesign-4bit",
    runtime: "mlx-sidecar",
    format: "mlx",
    acceleratorPreference: "mlx",
    memoryEstimateMb: 8192,
    license: "apache-2.0",
    engineId: "qwen3-tts-17b-mlx",
    metadata: {
      role: "tts",
      huggingFaceRepo: "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit",
      installMode: "user-data-folder",
      localFolder: `models/${QWEN3_TTS_17B_MODEL_DIR_NAME}`,
      supportedBackends: ["mlx"]
    }
  },
  {
    id: "model_qwen3_tts_17b_base_mlx",
    kind: "tts",
    name: "Qwen3-TTS 12Hz 1.7B Base",
    provider: "Qwen",
    version: "12Hz-1.7B-Base-4bit",
    runtime: "mlx-sidecar",
    format: "mlx",
    acceleratorPreference: "mlx",
    memoryEstimateMb: 8192,
    license: "apache-2.0",
    engineId: "qwen3-tts-17b-base-mlx",
    metadata: {
      role: "tts",
      huggingFaceRepo: "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-4bit",
      installMode: "user-data-folder",
      localFolder: `models/${QWEN3_TTS_17B_BASE_MODEL_DIR_NAME}`,
      supportedBackends: ["mlx"]
    }
  },
  {
    id: "model_chatterbox_multilingual_mlx",
    kind: "tts",
    name: "Chatterbox Multilingual MLX",
    provider: "ResembleAI / mlx-community",
    version: "chatterbox-fp16",
    runtime: "mlx-sidecar",
    format: "mlx",
    acceleratorPreference: "mlx",
    memoryEstimateMb: 4096,
    license: "apache-2.0",
    engineId: "chatterbox-multilingual-mlx",
    metadata: {
      role: "tts",
      huggingFaceRepo: "mlx-community/chatterbox-fp16",
      installMode: "user-data-folder",
      localFolder: `models/${CHATTERBOX_MULTILINGUAL_MODEL_DIR_NAME}`,
      originalRepo: "ResembleAI/chatterbox",
      originalLicense: "mit",
      prosodyControls: ["exaggeration", "cfgWeight", "pauseAfterMs"],
      supportedBackends: ["mlx"]
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
      installMode: "user-data-folder",
      localFolder: `models/${F5_TTS_MODEL_DIR_NAME}`,
      supportedBackends: ["mlx", "cuda", "vulkan"]
    }
  }
]

const recommendedModelIds = new Set(recommendedModels.map((model) => model.id))

const recommendedRuntimeManifests = [
  {
    id: "runtime_qwen3_tts_mlx_sidecar",
    adapterId: "qwen3-tts-mlx",
    runtime: "mlx",
    version: "sidecar-v1",
    capabilities: {
      protocol: "dreamreader-tts-sidecar/v1",
      engines: ["qwen3-tts-06b-mlx", "qwen3-tts-17b-mlx", "qwen3-tts-17b-base-mlx"],
      output: ["audio/wav", "audio/mp4"]
    }
  },
  {
    id: "runtime_chatterbox_mlx_sidecar",
    adapterId: "chatterbox-mlx",
    runtime: "mlx",
    version: "sidecar-v1",
    capabilities: {
      protocol: "dreamreader-tts-sidecar/v1",
      engines: ["chatterbox-multilingual-mlx"],
      output: ["audio/wav", "audio/mp4"],
      prosodyControls: ["exaggeration", "cfgWeight", "pauseAfterMs"]
    }
  },
  {
    id: "runtime_f5_tts_pt_br_pytorch_sidecar",
    adapterId: "f5-tts-pt-br",
    runtime: "pytorch",
    version: "sidecar-v1",
    capabilities: {
      protocol: "dreamreader-tts-sidecar/v1",
      engines: ["f5-tts-pt-br"],
      output: ["audio/wav", "audio/mp4"]
    }
  }
]

export class RuntimeService {
  private readonly activeDownloads = new Map<string, string>()
  private readonly activeOperations = new Map<string, string>()
  private readonly operations = new Map<string, RuntimeOperationJob>()
  private readyPromise: Promise<void> | undefined

  constructor(
    private readonly db: AppDatabase,
    private readonly paths: AppPaths
  ) {}

  async listModels(): Promise<ModelAsset[]> {
    await this.ensureCatalog()
    const rows = await this.db.query.modelAssets.findMany()
    const engines = await this.db.query.ttsEngines.findMany()
    const engineCapabilitiesById = new Map(engines.map((engine) => [engine.id, engine.capabilitiesJson]))
    const order = new Map(recommendedModels.map((model, index) => [model.id, index]))
    const models: ModelAsset[] = []

    for (const row of rows) {
      const model = toModelAsset(row)
      if (model.engineId) {
        const capabilities = engineCapabilitiesById.get(model.engineId)
        if (capabilities) {
          model.metadata = {
            ...model.metadata,
            capabilities: capabilities as JsonValue
          }
        }
      }
      const currentSize = model.path ? await pathSize(model.path) : undefined
      if (currentSize !== undefined) {
        model.sizeBytes = currentSize
        if (row.sizeBytes !== currentSize) {
          await this.db
            .update(modelAssets)
            .set({
              sizeBytes: currentSize,
              updatedAt: new Date()
            })
            .where(eq(modelAssets.id, row.id))
        }
      }
      models.push(model)
    }

    return models.sort((a, b) => (order.get(a.id) ?? 1000) - (order.get(b.id) ?? 1000) || a.name.localeCompare(b.name))
  }

  async diagnostics(): Promise<RuntimeDiagnostic[]> {
    const appleSilicon = process.platform === "darwin" && process.arch === "arm64"
    const models = await this.listModels()
    const manifests = await this.db.query.runtimeManifests.findMany()
    const qwenProsody = models.find((model) => model.id === QWEN_PROSODY_MODEL_ID)
    const qwenTtsReady = sidecarReady(models, manifests, "qwen3-tts-mlx")
    const chatterboxReady = sidecarReady(models, manifests, "chatterbox-mlx")
    const f5Ready = sidecarReady(models, manifests, "f5-tts-pt-br")
    return [
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
        id: "qwen3-tts-sidecar",
        label: "Qwen3-TTS Sidecar",
        status: qwenTtsReady ? "available" : "not_configured",
        detail: qwenTtsReady
          ? "Qwen3-TTS model and MLX sidecar are configured for synthesis"
          : "Install a Qwen3-TTS model and register a qwen3-tts-mlx sidecar executable"
      },
      {
        id: "f5-tts-sidecar",
        label: "F5-TTS PT-BR Sidecar",
        status: f5Ready ? "available" : "not_configured",
        detail: f5Ready
          ? "F5-TTS PT-BR model and PyTorch sidecar are configured for synthesis"
          : "Install the F5-TTS PT-BR model and register an f5-tts-pt-br sidecar executable"
      },
      {
        id: "chatterbox-tts-sidecar",
        label: "Chatterbox Multilingual MLX Sidecar",
        status: chatterboxReady ? "available" : "not_configured",
        detail: chatterboxReady
          ? "Chatterbox Multilingual model and MLX sidecar are configured for synthesis"
          : "Install the Chatterbox Multilingual MLX model and register a chatterbox-mlx sidecar executable"
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

  async listModelDownloadJobs(): Promise<ModelDownloadJob[]> {
    await this.ensureReady()
    const rows = await this.db.query.modelDownloadJobs.findMany({
      orderBy: [desc(modelDownloadJobs.updatedAt)],
      limit: 30
    })
    return rows.map(toModelDownloadJob)
  }

  async listOperations(): Promise<RuntimeOperationJob[]> {
    return [...this.operations.values()]
      .map((operation) => RuntimeOperationJobSchema.parse(operation))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 30)
  }

  async getHuggingFaceTokenStatus(): Promise<HuggingFaceTokenStatus> {
    const row = await this.db.query.settings.findFirst({ where: eq(settingsTable.key, HUGGING_FACE_TOKEN_SETTINGS_KEY) })
    return HuggingFaceTokenStatusSchema.parse({
      configured: Boolean(row?.valueJson.encryptedToken),
      storage: row?.valueJson.storage === "electron-safe-storage" ? "electron-safe-storage" : undefined,
      updatedAt: optionalDate(row?.updatedAt)
    })
  }

  async updateHuggingFaceToken(token: string): Promise<HuggingFaceTokenStatus> {
    const normalizedToken = token.trim()
    if (!normalizedToken) {
      await this.db.delete(settingsTable).where(eq(settingsTable.key, HUGGING_FACE_TOKEN_SETTINGS_KEY))
      return this.getHuggingFaceTokenStatus()
    }

    const encryptedToken = await encryptSecret(normalizedToken)
    await this.db
      .insert(settingsTable)
      .values({
        key: HUGGING_FACE_TOKEN_SETTINGS_KEY,
        valueJson: {
          encryptedToken,
          storage: "electron-safe-storage"
        },
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: {
          valueJson: {
            encryptedToken,
            storage: "electron-safe-storage"
          },
          updatedAt: new Date()
        }
      })
    return this.getHuggingFaceTokenStatus()
  }

  private async readHuggingFaceToken(): Promise<string | undefined> {
    const row = await this.db.query.settings.findFirst({ where: eq(settingsTable.key, HUGGING_FACE_TOKEN_SETTINGS_KEY) })
    const encryptedToken = typeof row?.valueJson.encryptedToken === "string" ? row.valueJson.encryptedToken : undefined
    if (!encryptedToken) {
      return undefined
    }
    return decryptSecret(encryptedToken)
  }

  async listSidecars(): Promise<RuntimeSidecar[]> {
    await this.ensureReady()
    const manifests = await this.db.query.runtimeManifests.findMany()
    const rows: RuntimeSidecar[] = []

    for (const definition of recommendedRuntimeManifests) {
      const manifest = manifests.find((item) => item.id === definition.id)
      const scriptPath = sidecarScriptForAdapter(definition.adapterId, this.paths.sidecarsDir)
      const executablePath = manifest?.executablePath ?? undefined
      const runtimeSize = executablePath ? await runtimeSizeForExecutable(executablePath, this.paths) : undefined
      rows.push(
        RuntimeSidecarSchema.parse({
          id: definition.id,
          adapterId: definition.adapterId,
          name: sidecarName(definition.adapterId),
          runtime: definition.runtime,
          status: executablePath ? "available" : "not_configured",
          executablePath,
          scriptPath,
          healthcheckCommand: manifest?.healthcheckCommand ?? undefined,
          sizeBytes: runtimeSize,
          modelEngineIds: definition.capabilities.engines,
          createdAt: toIso(manifest?.createdAt ?? new Date()),
          updatedAt: toIso(manifest?.updatedAt ?? new Date())
        })
      )
    }

    return rows
  }

  async installRecommendedModel(modelId: string, backend: RuntimeInstallBackend = "auto"): Promise<RuntimeOperationJob> {
    await this.ensureReady()
    const model = recommendedModelById(modelId)
    const installBackend = resolveRuntimeInstallBackend(backend)
    assertModelBackendSupported(model, installBackend)
    const operation = this.createOperation("model_install", "model", modelId)
    void this.runRecommendedModelInstall(operation.id, model, installBackend)
    return operation
  }

  async deleteModel(modelId: string, deleteFiles = true): Promise<ModelAsset> {
    await this.ensureReady()
    const model = await this.db.query.modelAssets.findFirst({ where: eq(modelAssets.id, modelId) })
    if (!model) {
      throw new AppError("model_not_found", "Model not found")
    }

    const operation = this.createOperation("model_delete", "model", modelId)
    this.updateOperation(operation.id, {
      status: "running",
      startedAt: new Date().toISOString(),
      progress: 0.2,
      progressLabelKey: "modelManager.progress.deleting"
    })
    this.appendOperationLog(operation.id, "info", "modelManager.log.modelDeleteStarted", { target: model.name })

    try {
      if (deleteFiles && model.path && isSafeManagedModelPath(model.path, this.paths)) {
        await rm(model.path, { force: true, recursive: true })
        await removeEmptyParentModelDir(model.path, this.paths.modelsDir)
        this.appendOperationLog(operation.id, "info", "modelManager.log.modelFilesDeleted", { path: model.path })
      } else if (deleteFiles && model.path) {
        this.appendOperationLog(operation.id, "warning", "modelManager.log.modelExternalPathPreserved", { path: model.path })
      }

      const now = new Date()
      const [updated] = await this.db
        .update(modelAssets)
        .set({
          path: null,
          sizeBytes: null,
          installStatus: "not_configured",
          downloadProgress: 0,
          installedAt: null,
          updatedAt: now
        })
        .where(eq(modelAssets.id, modelId))
        .returning()
      await this.markTtsEngineUninstalled(getString(model.metadataJson.engineId))
      this.updateOperation(operation.id, {
        status: "completed",
        progress: 1,
        progressLabelKey: "modelManager.progress.completed",
        finishedAt: new Date().toISOString()
      })
      this.appendOperationLog(operation.id, "info", "modelManager.log.modelDeleted", { target: model.name })
      return toModelAsset(updated)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Model deletion failed"
      this.updateOperation(operation.id, {
        status: "failed",
        progress: 1,
        errorCode: "model_delete_failed",
        errorMessage: message,
        finishedAt: new Date().toISOString()
      })
      this.appendOperationLog(operation.id, "error", "modelManager.log.operationFailed", { message })
      throw error
    }
  }

  async installSidecar(sidecarId: string, backend: RuntimeInstallBackend = "auto"): Promise<RuntimeOperationJob> {
    await this.ensureReady()
    const sidecar = recommendedRuntimeManifests.find((item) => item.id === sidecarId)
    if (!sidecar) {
      throw new AppError("sidecar_not_found", "Sidecar not found")
    }
    const installBackend = resolveRuntimeInstallBackend(backend)
    assertSidecarBackendSupported(sidecar.adapterId, installBackend)
    const operation = this.createOperation("sidecar_install", "sidecar", sidecarId)
    void this.runSidecarInstall(operation.id, sidecar, installBackend)
    return operation
  }

  async uninstallSidecar(sidecarId: string): Promise<RuntimeOperationJob> {
    await this.ensureReady()
    const sidecar = recommendedRuntimeManifests.find((item) => item.id === sidecarId)
    if (!sidecar) {
      throw new AppError("sidecar_not_found", "Sidecar not found")
    }
    const operation = this.createOperation("sidecar_uninstall", "sidecar", sidecarId)
    void this.runSidecarUninstall(operation.id, sidecar)
    return operation
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
    const operation = this.createOperation("model_download", "model", modelId)
    void this.runDownload(toModelDownloadJob(job), modelId, operation.id)
    return toModelDownloadJob(job)
  }

  private async runDownload(job: ModelDownloadJob, modelId: string, operationId?: string): Promise<void> {
    const tempPath = `${job.targetPath}.part`
    try {
      if (operationId) {
        this.updateOperation(operationId, {
          status: "running",
          startedAt: new Date().toISOString(),
          progress: 0,
          progressLabelKey: "modelManager.progress.downloading"
        })
        this.appendOperationLog(operationId, "info", "modelManager.log.downloadStarted", { target: path.basename(job.targetPath) })
      }
      await mkdir(path.dirname(job.targetPath), { recursive: true })
      await this.updateDownloadJob(job.id, {
        status: "downloading",
        startedAt: new Date(),
        progress: 0
      })
      await this.updateModelDownloadState(modelId, "downloading", 0)

      const huggingFaceToken = await this.readHuggingFaceToken()
      const response = await fetch(job.sourceUrl, {
        headers: huggingFaceToken ? { Authorization: `Bearer ${huggingFaceToken}` } : undefined
      })
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
          if (operationId) {
            this.updateOperation(operationId, {
              progress,
              progressLabelKey: "modelManager.progress.downloadBytes",
              progressLabelValues: {
                received: receivedBytes,
                total: totalBytes ?? 0
              }
            })
          }
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
      if (operationId) {
        this.updateOperation(operationId, {
          status: "completed",
          progress: 1,
          progressLabelKey: "modelManager.progress.completed",
          finishedAt: new Date().toISOString()
        })
        this.appendOperationLog(operationId, "info", "modelManager.log.downloadCompleted", { target: path.basename(job.targetPath) })
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
      if (operationId) {
        this.updateOperation(operationId, {
          status: "failed",
          progress: 1,
          errorCode: "model_download_failed",
          errorMessage: message,
          finishedAt: new Date().toISOString()
        })
        this.appendOperationLog(operationId, "error", "modelManager.log.operationFailed", { message })
      }
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
    await this.removeDeprecatedDreamReaderCatalogEntries()
    for (const model of recommendedModels) {
      const existing = await this.db.query.modelAssets.findFirst({ where: eq(modelAssets.id, model.id) })
      const detectedPath = await detectedModelPathFor(model, this.paths)
      const detectedPathReady = Boolean(detectedPath)
      const existingPath = existing?.path && isUsablePersistedPath(existing.path, this.paths) ? existing.path : undefined
      const resolvedPath = existingPath ?? detectedPath
      const installStatus =
        resolvedPath && existing?.installStatus === "available"
          ? "available"
          : detectedPathReady
            ? "available"
            : existing?.installStatus === "available"
              ? "not_configured"
              : existing?.installStatus ?? "not_configured"
      const downloadProgress = installStatus === "available" ? 1 : existing?.downloadProgress ?? 0
      const installedAt = installStatus === "available" ? existing?.installedAt ?? (detectedPathReady ? new Date() : undefined) : null
      await this.db
        .insert(modelAssets)
        .values({
          id: model.id,
          kind: model.kind,
          name: model.name,
          provider: model.provider,
          version: model.version,
          path: resolvedPath ?? null,
          sizeBytes: installStatus === "available" ? existing?.sizeBytes : null,
          checksum: installStatus === "available" ? existing?.checksum : null,
          license: model.license,
          runtime: model.runtime,
          format: model.format,
          acceleratorPreference: model.acceleratorPreference,
          memoryEstimateMb: model.memoryEstimateMb,
          checksumAlgorithm: installStatus === "available" ? existing?.checksumAlgorithm : null,
          sourceUrl: model.sourceUrl,
          installStatus,
          downloadProgress,
          metadataJson: {
            ...model.metadata,
            engineId: model.engineId
          },
          installedAt,
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
            path: resolvedPath ?? null,
            sizeBytes: installStatus === "available" ? existing?.sizeBytes : null,
            checksum: installStatus === "available" ? existing?.checksum : null,
            checksumAlgorithm: installStatus === "available" ? existing?.checksumAlgorithm : null,
            installStatus,
            downloadProgress,
            metadataJson: {
              ...model.metadata,
              engineId: model.engineId
            },
            installedAt,
            updatedAt: new Date()
          }
        })
      if (installStatus === "available" && model.engineId && resolvedPath) {
        await this.markTtsEngineInstalled(model, resolvedPath)
      } else if (model.engineId) {
        await this.markTtsEngineUninstalled(model.engineId)
      }
    }
    for (const manifest of recommendedRuntimeManifests) {
      const existing = await this.db.query.runtimeManifests.findFirst({ where: eq(runtimeManifests.id, manifest.id) })
      const detectedRuntime = await detectedRuntimeForManifest(manifest.adapterId, this.paths)
      const disabled = existing?.environmentJson?.disabled === true
      const existingExecutablePath = existing?.executablePath && isUsablePersistedPath(existing.executablePath, this.paths) ? existing.executablePath : undefined
      const executablePath = disabled ? undefined : existingExecutablePath ?? detectedRuntime?.executablePath
      const environmentJson = disabled
        ? { disabled: true }
        : existingExecutablePath && existing
        ? existing.environmentJson
        : detectedRuntime?.environmentJson ?? existing?.environmentJson ?? {}
      const healthcheckCommand = disabled ? undefined : existingExecutablePath ? existing?.healthcheckCommand : detectedRuntime?.healthcheckCommand
      await this.db
        .insert(runtimeManifests)
        .values({
          id: manifest.id,
          adapterId: manifest.adapterId,
          runtime: manifest.runtime,
          version: manifest.version,
          capabilitiesJson: manifest.capabilities,
          environmentJson,
          executablePath: executablePath ?? null,
          healthcheckCommand: healthcheckCommand ?? null,
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: runtimeManifests.id,
          set: {
            adapterId: manifest.adapterId,
            runtime: manifest.runtime,
            version: manifest.version,
            capabilitiesJson: manifest.capabilities,
            environmentJson,
            executablePath: executablePath ?? null,
            healthcheckCommand: healthcheckCommand ?? null,
            updatedAt: new Date()
          }
        })
    }
  }

  private async removeDeprecatedDreamReaderCatalogEntries(): Promise<void> {
    const rows = await this.db.query.modelAssets.findMany()
    for (const row of rows) {
      if (isDeprecatedDreamReaderLocalModelAsset(row)) {
        await this.db.delete(modelAssets).where(eq(modelAssets.id, row.id))
      }
    }

    const manifests = await this.db.query.runtimeManifests.findMany()
    for (const manifest of manifests) {
      if (isDeprecatedDreamReaderLocalRuntimeManifest(manifest)) {
        await this.db.delete(runtimeManifests).where(eq(runtimeManifests.id, manifest.id))
      }
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
        capabilitiesJson: capabilitiesForModel(model),
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

  private async markTtsEngineUninstalled(engineId: string | undefined): Promise<void> {
    if (!engineId) {
      return
    }

    await this.db
      .update(ttsEngines)
      .set({
        installed: false,
        installPath: null,
        updatedAt: new Date()
      })
      .where(eq(ttsEngines.id, engineId))
  }

  private createOperation(kind: RuntimeOperationKind, targetKind: "model" | "sidecar", targetId: string): RuntimeOperationJob {
    const activeKey = `${kind}:${targetKind}:${targetId}`
    const activeOperationId = this.activeOperations.get(activeKey)
    const activeOperation = activeOperationId ? this.operations.get(activeOperationId) : undefined
    if (activeOperation && activeOperation.status !== "completed" && activeOperation.status !== "failed") {
      return RuntimeOperationJobSchema.parse(activeOperation)
    }

    const now = new Date().toISOString()
    const operation = RuntimeOperationJobSchema.parse({
      id: createId("runtime_operation"),
      kind,
      targetKind,
      targetId,
      status: "queued",
      progress: 0,
      progressLabelKey: "modelManager.progress.queued",
      progressLabelValues: {},
      logs: [],
      createdAt: now,
      updatedAt: now
    })
    this.operations.set(operation.id, operation)
    this.activeOperations.set(activeKey, operation.id)
    this.appendOperationLog(operation.id, "info", "modelManager.log.operationQueued", { target: targetId })
    return operation
  }

  private updateOperation(id: string, patch: Partial<RuntimeOperationJob>): RuntimeOperationJob | undefined {
    const current = this.operations.get(id)
    if (!current) {
      return undefined
    }

    const next = RuntimeOperationJobSchema.parse({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    })
    this.operations.set(id, next)
    if (next.status === "completed" || next.status === "failed") {
      this.activeOperations.delete(`${next.kind}:${next.targetKind}:${next.targetId}`)
    }
    return next
  }

  private appendOperationLog(
    operationId: string,
    level: "info" | "warning" | "error",
    messageKey: string,
    values: Record<string, string | number> = {}
  ): void {
    const current = this.operations.get(operationId)
    if (!current) {
      return
    }

    const now = new Date().toISOString()
    this.operations.set(
      operationId,
      RuntimeOperationJobSchema.parse({
        ...current,
        logs: [
          ...current.logs,
          {
            id: createId("runtime_log"),
            level,
            messageKey,
            values,
            createdAt: now
          }
        ].slice(-300),
        updatedAt: now
      })
    )
  }

  private async runRecommendedModelInstall(operationId: string, model: RecommendedModel, backend: ResolvedInstallBackend): Promise<void> {
    try {
      this.updateOperation(operationId, {
        status: "running",
        startedAt: new Date().toISOString(),
        progress: 0.05,
        progressLabelKey: "modelManager.progress.preparing"
      })
      const repoId = getString(model.metadata.huggingFaceRepo)
      const localFolder = getString(model.metadata.localFolder)
      if (!repoId || !localFolder) {
        throw new AppError("model_install_unavailable", "This model does not expose an automatic installer")
      }

      const pythonExecutable = await this.ensureLocalPython(operationId, 0.05, 0.35)
      await this.ensurePythonPackage(operationId, pythonExecutable, "huggingface_hub", 0.35, 0.45)
      const localDir = managedModelPathFor(model, this.paths)
      if (!localDir) {
        throw new AppError("model_install_unavailable", "This model does not expose an automatic installer")
      }
      await mkdir(localDir, { recursive: true })
      const huggingFaceToken = await this.readHuggingFaceToken()
      this.appendOperationLog(operationId, "info", "modelManager.log.backendSelected", { backend })
      this.appendOperationLog(operationId, "info", "modelManager.log.modelSnapshotStarted", { repo: repoId, path: localDir })
      this.updateOperation(operationId, {
        progress: 0.5,
        progressLabelKey: "modelManager.progress.downloading"
      })
      await this.runProcess(
        operationId,
        pythonExecutable,
        [
          "-c",
          [
            "import os, sys",
            "from huggingface_hub import snapshot_download",
            "repo_id = sys.argv[1]",
            "local_dir = sys.argv[2]",
            "token = os.environ.get('HF_TOKEN') or None",
            "snapshot_download(repo_id=repo_id, local_dir=local_dir, token=token)"
          ].join("; "),
          repoId,
          localDir
        ],
        {
          cwd: this.paths.userData,
          env: {
            ...process.env,
            HF_HOME: this.paths.huggingFaceDir,
            ...(huggingFaceToken ? { HF_TOKEN: huggingFaceToken } : {})
          },
          progressStart: 0.5,
          progressEnd: 0.9,
          progressLabelKey: "modelManager.progress.downloading"
        }
      )
      await this.ensureCatalog()
      const installed = await this.db.query.modelAssets.findFirst({ where: eq(modelAssets.id, model.id) })
      if (!installed || installed.installStatus !== "available") {
        throw new AppError("model_install_incomplete", "Downloaded model folder did not pass readiness checks")
      }
      this.updateOperation(operationId, {
        status: "completed",
        progress: 1,
        progressLabelKey: "modelManager.progress.completed",
        finishedAt: new Date().toISOString()
      })
      this.appendOperationLog(operationId, "info", "modelManager.log.modelSnapshotCompleted", { target: model.name })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Model installation failed"
      await this.updateModelDownloadState(model.id, "failed", 1).catch(() => undefined)
      this.updateOperation(operationId, {
        status: "failed",
        progress: 1,
        errorCode: "model_install_failed",
        errorMessage: message,
        finishedAt: new Date().toISOString()
      })
      this.appendOperationLog(operationId, "error", "modelManager.log.operationFailed", { message })
    }
  }

  private async runSidecarInstall(
    operationId: string,
    sidecar: (typeof recommendedRuntimeManifests)[number],
    backend: ResolvedInstallBackend
  ): Promise<void> {
    try {
      this.updateOperation(operationId, {
        status: "running",
        startedAt: new Date().toISOString(),
        progress: 0.05,
        progressLabelKey: "modelManager.progress.preparing"
      })
      this.appendOperationLog(operationId, "info", "modelManager.log.backendSelected", { backend })
      const pythonExecutable = await this.ensureLocalPython(operationId, 0.05, 0.45)
      const pipSteps = pipInstallStepsForAdapter(sidecar.adapterId, backend, this.paths.sidecarsDir)
      if (pipSteps.length === 0) {
        throw new AppError("sidecar_install_unavailable", "Sidecar installer is not configured")
      }
      const stepSize = 0.47 / pipSteps.length
      for (const [index, step] of pipSteps.entries()) {
        this.appendOperationLog(operationId, "info", "modelManager.log.pipInstalling", { target: step.label })
        await this.runProcess(operationId, pythonExecutable, step.args, {
          cwd: this.paths.userData,
          env: process.env,
          progressStart: 0.45 + index * stepSize,
          progressEnd: 0.45 + (index + 1) * stepSize,
          progressLabelKey: "modelManager.progress.installingDependencies"
        })
      }
      const detectedRuntime = await detectedRuntimeForManifest(sidecar.adapterId, this.paths, backend)
      if (!detectedRuntime) {
        throw new AppError("sidecar_runtime_not_detected", "Sidecar runtime could not be detected after installation")
      }
      await this.db
        .update(runtimeManifests)
        .set({
          executablePath: detectedRuntime.executablePath,
          environmentJson: detectedRuntime.environmentJson,
          healthcheckCommand: detectedRuntime.healthcheckCommand,
          updatedAt: new Date()
        })
        .where(eq(runtimeManifests.id, sidecar.id))
      await this.ensureCatalog()
      this.updateOperation(operationId, {
        status: "completed",
        progress: 1,
        progressLabelKey: "modelManager.progress.completed",
        finishedAt: new Date().toISOString()
      })
      this.appendOperationLog(operationId, "info", "modelManager.log.sidecarRegistered", { target: sidecarName(sidecar.adapterId) })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sidecar installation failed"
      this.updateOperation(operationId, {
        status: "failed",
        progress: 1,
        errorCode: "sidecar_install_failed",
        errorMessage: message,
        finishedAt: new Date().toISOString()
      })
      this.appendOperationLog(operationId, "error", "modelManager.log.operationFailed", { message })
    }
  }

  private async runSidecarUninstall(
    operationId: string,
    sidecar: (typeof recommendedRuntimeManifests)[number]
  ): Promise<void> {
    try {
      this.updateOperation(operationId, {
        status: "running",
        startedAt: new Date().toISOString(),
        progress: 0.4,
        progressLabelKey: "modelManager.progress.uninstalling"
      })
      await this.db
        .update(runtimeManifests)
        .set({
          executablePath: null,
          environmentJson: { disabled: true },
          healthcheckCommand: null,
          updatedAt: new Date()
        })
        .where(eq(runtimeManifests.id, sidecar.id))
      this.updateOperation(operationId, {
        status: "completed",
        progress: 1,
        progressLabelKey: "modelManager.progress.completed",
        finishedAt: new Date().toISOString()
      })
      this.appendOperationLog(operationId, "info", "modelManager.log.sidecarUninstalled", { target: sidecarName(sidecar.adapterId) })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sidecar uninstall failed"
      this.updateOperation(operationId, {
        status: "failed",
        progress: 1,
        errorCode: "sidecar_uninstall_failed",
        errorMessage: message,
        finishedAt: new Date().toISOString()
      })
      this.appendOperationLog(operationId, "error", "modelManager.log.operationFailed", { message })
    }
  }

  private async ensureLocalPython(operationId: string, progressStart: number, progressEnd: number): Promise<string> {
    const detectedRuntime = await detectedPythonRuntime(this.paths)
    if (detectedRuntime) {
      this.appendOperationLog(operationId, "info", "modelManager.log.pythonDetected", { path: detectedRuntime.executablePath })
      this.updateOperation(operationId, {
        progress: progressEnd,
        progressLabelKey: "modelManager.progress.pythonReady"
      })
      return detectedRuntime.executablePath
    }

    const pythonDir = this.paths.pythonDir
    const pythonExecutable = localPythonExecutablePath(this.paths)

    await mkdir(this.paths.runtimeDownloadsDir, { recursive: true })
    const target = standalonePythonTarget()
    this.appendOperationLog(operationId, "info", "modelManager.log.pythonFinding", { target })
    const asset = await findStandalonePythonAsset(target)
    const archivePath = path.join(this.paths.runtimeDownloadsDir, asset.name)
    const extractDir = path.join(this.paths.runtimeDownloadsDir, "python-extract")
    await rm(extractDir, { force: true, recursive: true })
    await mkdir(extractDir, { recursive: true })

    if (!(await exists(archivePath))) {
      this.appendOperationLog(operationId, "info", "modelManager.log.pythonDownloadStarted", { target: asset.name })
      await this.downloadFileWithProgress(operationId, asset.url, archivePath, progressStart, Math.max(progressStart, progressEnd - 0.22))
    } else {
      this.appendOperationLog(operationId, "info", "modelManager.log.pythonArchiveCached", { path: archivePath })
    }

    this.appendOperationLog(operationId, "info", "modelManager.log.pythonExtracting", { path: archivePath })
    await rm(pythonDir, { force: true, recursive: true })
    await this.runProcess(operationId, "tar", ["-xzf", archivePath, "-C", extractDir], {
      cwd: this.paths.userData,
      env: process.env,
      progressStart: Math.max(progressStart, progressEnd - 0.2),
      progressEnd: Math.max(progressStart, progressEnd - 0.06),
      progressLabelKey: "modelManager.progress.extracting"
    })
    const extractedPythonDir = path.join(extractDir, "python")
    if (!(await exists(extractedPythonDir))) {
      throw new AppError("python_archive_invalid", "Standalone Python archive did not contain a python directory")
    }
    await rename(extractedPythonDir, pythonDir)
    if (!(await exists(pythonExecutable))) {
      const pythonAliasTarget = await firstExistingPath(localPythonExecutableCandidates(this.paths))
      if (!pythonAliasTarget) {
        throw new AppError("python_archive_invalid", "Standalone Python did not provide a python executable")
      }
      if (process.platform === "win32") {
        throw new AppError("python_archive_invalid", "Standalone Python did not provide python.exe")
      }
      await symlink(path.basename(pythonAliasTarget), pythonExecutable)
    }
    await rm(extractDir, { force: true, recursive: true })
    this.updateOperation(operationId, {
      progress: progressEnd,
      progressLabelKey: "modelManager.progress.pythonReady"
    })
    this.appendOperationLog(operationId, "info", "modelManager.log.pythonReady", { path: pythonExecutable })
    return pythonExecutable
  }

  private async ensurePythonPackage(
    operationId: string,
    pythonExecutable: string,
    packageName: string,
    progressStart: number,
    progressEnd: number
  ): Promise<void> {
    this.appendOperationLog(operationId, "info", "modelManager.log.pipInstalling", { target: packageName })
    await this.runProcess(operationId, pythonExecutable, ["-m", "pip", "install", packageName], {
      cwd: this.paths.userData,
      env: process.env,
      progressStart,
      progressEnd,
      progressLabelKey: "modelManager.progress.installingDependencies"
    })
  }

  private async downloadFileWithProgress(
    operationId: string,
    url: string,
    targetPath: string,
    progressStart: number,
    progressEnd: number
  ): Promise<void> {
    const tempPath = `${targetPath}.part`
    await mkdir(path.dirname(targetPath), { recursive: true })
    const response = await fetch(url)
    if (!response.ok || !response.body) {
      throw new Error(`download_failed_${response.status}`)
    }
    const totalBytes = Number(response.headers.get("content-length") ?? 0) || undefined
    const reader = response.body.getReader()
    const stream = createWriteStream(tempPath)
    let receivedBytes = 0
    let lastUpdate = 0

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        receivedBytes += value.byteLength
        await writeChunk(stream, value)
        const ratio = totalBytes ? receivedBytes / totalBytes : 0
        const progress = totalBytes ? progressStart + Math.min(ratio, 1) * (progressEnd - progressStart) : progressStart
        const now = Date.now()
        if (now - lastUpdate > 400) {
          lastUpdate = now
          this.updateOperation(operationId, {
            progress,
            progressLabelKey: "modelManager.progress.downloadBytes",
            progressLabelValues: {
              received: receivedBytes,
              total: totalBytes ?? 0
            }
          })
        }
      }
      await closeStream(stream)
      await rename(tempPath, targetPath)
      this.updateOperation(operationId, {
        progress: progressEnd,
        progressLabelKey: "modelManager.progress.downloadBytes",
        progressLabelValues: {
          received: receivedBytes,
          total: totalBytes ?? receivedBytes
        }
      })
    } catch (error) {
      await unlink(tempPath).catch(() => undefined)
      throw error
    }
  }

  private runProcess(
    operationId: string,
    command: string,
    args: string[],
    options: {
      cwd: string
      env: NodeJS.ProcessEnv
      progressStart: number
      progressEnd: number
      progressLabelKey: string
    }
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env
      })
      let lastProgressTick = Date.now()
      let progress = options.progressStart

      const handleOutput = (chunk: Buffer) => {
        const text = chunk.toString("utf8")
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim()
          if (trimmed) {
            this.appendOperationLog(operationId, "info", "modelManager.log.processOutput", { message: trimmed.slice(0, 700) })
          }
        }
        const now = Date.now()
        if (now - lastProgressTick > 800) {
          lastProgressTick = now
          progress = Math.min(options.progressEnd - 0.02, progress + (options.progressEnd - options.progressStart) / 20)
          this.updateOperation(operationId, {
            progress,
            progressLabelKey: options.progressLabelKey
          })
        }
      }

      child.stdout.on("data", handleOutput)
      child.stderr.on("data", handleOutput)
      child.on("error", reject)
      child.on("close", (code) => {
        if (code && code !== 0) {
          reject(new Error(`${command} exited with code ${code}`))
          return
        }
        this.updateOperation(operationId, {
          progress: options.progressEnd,
          progressLabelKey: options.progressLabelKey
        })
        resolve()
      })
    })
  }
}

async function pathSize(filePath: string): Promise<number | undefined> {
  try {
    const info = await stat(filePath)
    if (info.isFile()) {
      return info.size
    }
    if (!info.isDirectory()) {
      return 0
    }

    let total = 0
    const entries = await readdir(filePath, { withFileTypes: true })
    for (const entry of entries) {
      const childSize = await pathSize(path.join(filePath, entry.name))
      total += childSize ?? 0
    }
    return total
  } catch {
    return undefined
  }
}

function isSafeManagedModelPath(modelPath: string, paths: AppPaths): boolean {
  return isPathInside(modelPath, paths.modelsDir)
}

function isManagedRuntimePath(candidatePath: string, paths: AppPaths): boolean {
  return isPathInside(candidatePath, paths.runtimeDir)
}

async function runtimeSizeForExecutable(executablePath: string, paths: AppPaths): Promise<number | undefined> {
  if (isManagedRuntimePath(executablePath, paths)) {
    return pathSize(paths.pythonDir)
  }
  if (isDevPathLayout(paths) && isPathInside(executablePath, projectLocalPythonDir(paths))) {
    return pathSize(projectLocalPythonDir(paths))
  }
  return undefined
}

function isLegacyProjectLocalPath(candidatePath: string): boolean {
  return /(^|[\\/])\.dreamreader-local([\\/]|$)/.test(candidatePath)
}

function isDevPathLayout(paths: AppPaths): boolean {
  return path.resolve(paths.resourcesDir) === path.resolve(paths.appRoot) && !path.resolve(paths.appRoot).endsWith(".asar")
}

function isUsablePersistedPath(candidatePath: string, paths: AppPaths): boolean {
  return !isLegacyProjectLocalPath(candidatePath) || isDevPathLayout(paths)
}

function isPathInside(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath))
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative)
}

async function removeEmptyParentModelDir(modelPath: string, userModelsDir: string): Promise<void> {
  const parent = path.dirname(modelPath)
  if (!isPathInside(parent, userModelsDir)) {
    return
  }
  const entries = await readdir(parent).catch(() => [])
  if (!entries.length) {
    await rm(parent, { force: true, recursive: true })
  }
}

function sidecarName(adapterId: string): string {
  if (adapterId === "qwen3-tts-mlx") {
    return "Qwen3-TTS MLX"
  }
  if (adapterId === "chatterbox-mlx") {
    return "Chatterbox Multilingual MLX"
  }
  if (adapterId === "f5-tts-pt-br") {
    return "F5-TTS PT-BR PyTorch"
  }
  return adapterId
}

function requirementsPathForAdapter(adapterId: string, sidecarsDir: string): string | undefined {
  if (adapterId === "qwen3-tts-mlx") {
    return path.join(sidecarsDir, "tts", "requirements-qwen3-tts-mlx.txt")
  }
  if (adapterId === "chatterbox-mlx") {
    return path.join(sidecarsDir, "tts", "requirements-chatterbox-mlx.txt")
  }
  if (adapterId === "f5-tts-pt-br") {
    return path.join(sidecarsDir, "tts", "requirements-f5-tts-ptbr.txt")
  }
  return undefined
}

type ResolvedInstallBackend = Exclude<RuntimeInstallBackend, "auto">

type PipInstallStep = {
  label: string
  args: string[]
}

function resolveRuntimeInstallBackend(backend: RuntimeInstallBackend): ResolvedInstallBackend {
  const parsed = RuntimeInstallBackendSchema.parse(backend)
  if (parsed !== "auto") {
    return assertBackendSupportedOnHost(parsed)
  }

  if (process.platform === "darwin" && process.arch === "arm64") {
    return "mlx"
  }
  if (process.platform === "linux" || process.platform === "win32") {
    const envBackend = RuntimeInstallBackendSchema.safeParse(process.env.DREAMREADER_TTS_BACKEND)
    if (envBackend.success && envBackend.data !== "auto") {
      return assertBackendSupportedOnHost(envBackend.data)
    }
    return "cuda"
  }
  throw new AppError("install_platform_unsupported", `Unsupported install platform: ${process.platform}/${process.arch}`)
}

function assertBackendSupportedOnHost(backend: ResolvedInstallBackend): ResolvedInstallBackend {
  if (process.platform === "darwin" && process.arch === "arm64" && backend === "mlx") {
    return backend
  }
  if ((process.platform === "linux" || process.platform === "win32") && (backend === "cuda" || backend === "vulkan")) {
    return backend
  }
  throw new AppError("install_backend_unsupported", `${backend} is not supported on ${process.platform}/${process.arch}`)
}

function assertModelBackendSupported(model: RecommendedModel, backend: ResolvedInstallBackend): void {
  const supportedBackends = Array.isArray(model.metadata.supportedBackends) ? model.metadata.supportedBackends.map(String) : ["mlx"]
  if (!supportedBackends.includes(backend)) {
    throw new AppError("model_backend_unsupported", `${model.name} supports ${supportedBackends.join(" or ")} installs, not ${backend}`)
  }
}

function assertSidecarBackendSupported(adapterId: string, backend: ResolvedInstallBackend): void {
  const supportedBackends =
    adapterId === "f5-tts-pt-br" ? ["mlx", "cuda", "vulkan"] : adapterId.endsWith("-mlx") || adapterId.includes("mlx") ? ["mlx"] : [backend]
  if (!supportedBackends.includes(backend)) {
    throw new AppError("sidecar_backend_unsupported", `${sidecarName(adapterId)} supports ${supportedBackends.join(" or ")} installs, not ${backend}`)
  }
}

function pipInstallStepsForAdapter(adapterId: string, backend: ResolvedInstallBackend, sidecarsDir: string): PipInstallStep[] {
  const requirementsPath = requirementsPathForAdapter(adapterId, sidecarsDir)
  if (adapterId !== "f5-tts-pt-br") {
    return requirementsPath ? [{ label: path.basename(requirementsPath), args: ["-m", "pip", "install", "-r", requirementsPath] }] : []
  }

  const baseRequirementsPath = path.join(sidecarsDir, "tts", "requirements-f5-tts-ptbr-base.txt")
  if (backend === "cuda") {
    return [
      {
        label: "torch/torchaudio CUDA",
        args: [
          "-m",
          "pip",
          "install",
          "torch",
          "torchaudio",
          "--index-url",
          process.env.DREAMREADER_TORCH_CUDA_INDEX_URL || "https://download.pytorch.org/whl/cu128"
        ]
      },
      { label: path.basename(baseRequirementsPath), args: ["-m", "pip", "install", "-r", baseRequirementsPath] }
    ]
  }
  if (backend === "vulkan") {
    return [
      { label: "torch/torchaudio Vulkan", args: ["-m", "pip", "install", "torch", "torchaudio"] },
      { label: path.basename(baseRequirementsPath), args: ["-m", "pip", "install", "-r", baseRequirementsPath] }
    ]
  }
  return requirementsPath ? [{ label: path.basename(requirementsPath), args: ["-m", "pip", "install", "-r", requirementsPath] }] : []
}

function backendRuntimeEnvironment(adapterId: string, backend: ResolvedInstallBackend): Record<string, string> {
  const env: Record<string, string> = {
    DREAMREADER_TTS_BACKEND: backend
  }
  if (adapterId === "f5-tts-pt-br") {
    env.DREAMREADER_TTS_DEVICE = backend === "mlx" ? "mps" : backend
  }
  return env
}

function standalonePythonTarget(): string {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "aarch64-apple-darwin"
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return "x86_64-apple-darwin"
  }
  if (process.platform === "linux" && process.arch === "arm64") {
    return "aarch64-unknown-linux-gnu"
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return "x86_64-unknown-linux-gnu"
  }
  if (process.platform === "win32" && process.arch === "arm64") {
    return "aarch64-pc-windows-msvc"
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return "x86_64-pc-windows-msvc"
  }
  throw new AppError("python_runtime_unsupported", `Unsupported platform for standalone Python: ${process.platform}/${process.arch}`)
}

async function findStandalonePythonAsset(target: string): Promise<{ name: string; url: string }> {
  const response = await fetch("https://api.github.com/repos/astral-sh/python-build-standalone/releases?per_page=1")
  if (!response.ok) {
    throw new Error(`python_asset_lookup_failed_${response.status}`)
  }
  const releases = (await response.json()) as Array<{ assets?: Array<{ name?: unknown; browser_download_url?: unknown }> }>
  const assets = releases.flatMap((release) => release.assets ?? [])
  const asset = assets.find((item) => {
    const name = String(item.name ?? "")
    return (
      name.startsWith("cpython-3.12.") &&
      name.includes(target) &&
      name.endsWith("install_only_stripped.tar.gz") &&
      !name.includes("freethreaded") &&
      !name.includes("debug")
    )
  })
  if (!asset?.browser_download_url || !asset.name) {
    throw new Error(`Could not find a CPython 3.12 standalone asset for ${target}`)
  }
  return { name: String(asset.name), url: String(asset.browser_download_url) }
}

async function encryptSecret(secret: string): Promise<string> {
  const { safeStorage } = await import("electron")
  if (!safeStorage.isEncryptionAvailable()) {
    throw new AppError("secret_storage_unavailable", "Secure storage is not available")
  }
  return safeStorage.encryptString(secret).toString("base64")
}

async function decryptSecret(encryptedSecret: string): Promise<string | undefined> {
  const { safeStorage } = await import("electron")
  if (!safeStorage.isEncryptionAvailable()) {
    throw new AppError("secret_storage_unavailable", "Secure storage is not available")
  }
  return safeStorage.decryptString(Buffer.from(encryptedSecret, "base64"))
}

function modelForPath(modelPath: string): RecommendedModel {
  const normalized = path.basename(modelPath).toLowerCase()
  if (normalized.endsWith(".gguf") || normalized.includes("qwen3-4b-instruct-2507")) {
    return recommendedModelById(QWEN_PROSODY_MODEL_ID)
  }
  if (
    normalized.includes(QWEN3_TTS_17B_BASE_MODEL_DIR_NAME) ||
    (normalized.includes("qwen3-tts") && (normalized.includes("1.7b") || normalized.includes("17b")) && normalized.includes("base"))
  ) {
    return recommendedModelById("model_qwen3_tts_17b_base_mlx")
  }
  if (normalized.includes("qwen3-tts") && (normalized.includes("1.7b") || normalized.includes("17b"))) {
    return recommendedModelById("model_qwen3_tts_17b_customvoice_mlx")
  }
  if (normalized.includes("qwen3-tts")) {
    return recommendedModelById("model_qwen3_tts_06b_base_mlx")
  }
  if (normalized.includes("chatterbox")) {
    return recommendedModelById("model_chatterbox_multilingual_mlx")
  }
  if (normalized.includes("f5") || normalized.endsWith(".safetensors")) {
    return recommendedModelById("model_f5_tts_ptbr_pytorch")
  }
  throw new AppError("model_path_unrecognized", "The selected path does not match a supported DreamReader model")
}

function recommendedModelById(id: string): RecommendedModel {
  const model = recommendedModels.find((item) => item.id === id)
  if (!model) {
    throw new AppError("model_not_found", "Model not found")
  }
  return model
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

function isDeprecatedDreamReaderLocalModelAsset(row: typeof modelAssets.$inferSelect): boolean {
  if (recommendedModelIds.has(row.id)) {
    return false
  }

  const metadata = row.metadataJson ?? {}
  const text = [
    row.id,
    row.kind,
    row.name,
    row.provider,
    row.runtime,
    row.format,
    row.path,
    getString(metadata.engineId),
    getString(metadata.adapterId),
    getString(metadata.registeredFrom),
    getString(metadata.role)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  return (
    text.includes("dreamreader-local-tts") ||
    text.includes("dreamreader-local-wav") ||
    (row.kind === "tts" && text.includes("dreamreader") && (text.includes("local") || text.includes("wav") || text.includes("tts"))) ||
    (row.kind === "runtime" &&
      row.provider === "local" &&
      row.runtime === "external" &&
      row.format === "unknown" &&
      (getString(metadata.role) === "runtime" || getString(metadata.registeredFrom) === "local-path" || text.includes("dreamreader")))
  )
}

function isDeprecatedDreamReaderLocalRuntimeManifest(row: typeof runtimeManifests.$inferSelect): boolean {
  const text = [row.id, row.adapterId, row.runtime, row.version].join(" ").toLowerCase()
  return (
    text.includes("dreamreader-local-tts") ||
    text.includes("dreamreader-local-wav") ||
    (text.includes("dreamreader") && (text.includes("local") || text.includes("wav") || text.includes("tts")))
  )
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

async function firstExistingPath(paths: string[]): Promise<string | undefined> {
  for (const item of paths) {
    if (await exists(item)) {
      return item
    }
  }
  return undefined
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
  if (engineId === "chatterbox-multilingual-mlx") {
    return "chatterbox-mlx"
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

function capabilitiesForModel(model: RecommendedModel): Record<string, unknown> {
  const runtime = runtimeForModel(model)
  const isChatterbox = model.engineId === "chatterbox-multilingual-mlx"
  return {
    id: model.engineId,
    displayName: model.name,
    runtime,
    modelFormat: model.format,
    languages: isChatterbox
      ? ["pt-BR", "pt", "en", "es", "fr", "de", "it", "ja", "ko", "zh", "ar", "da", "el", "fi", "he", "hi", "ms", "nl", "no", "pl", "ru", "sv", "sw", "tr"]
      : model.engineId === "f5-tts-pt-br"
        ? ["pt-BR"]
        : ["pt-BR", "en"],
    supportsVoiceClone:
      isChatterbox || model.engineId === "f5-tts-pt-br" || model.engineId === "qwen3-tts-06b-mlx" || model.engineId === "qwen3-tts-17b-base-mlx",
    supportsNaturalLanguageInstruction: model.engineId === "qwen3-tts-17b-mlx",
    supportsDiscreteEmotion: isChatterbox || model.engineId === "qwen3-tts-17b-mlx",
    supportsBatch: true,
    supportsStreaming: false,
    supportsSegmentTimestamps: model.engineId !== "f5-tts-pt-br",
    supportsSsmlLikeMarkup: false,
    preferredInputCase: "preserve",
    estimatedMemoryMb: model.memoryEstimateMb
  }
}

function managedModelPathFor(model: RecommendedModel, paths: AppPaths): string | undefined {
  if (model.fileName) {
    return path.join(paths.modelsDir, model.id, model.fileName)
  }
  if (model.id === "model_qwen3_tts_06b_base_mlx") {
    return path.join(paths.modelsDir, QWEN3_TTS_06B_MODEL_DIR_NAME)
  }
  if (model.id === "model_qwen3_tts_17b_customvoice_mlx") {
    return path.join(paths.modelsDir, QWEN3_TTS_17B_MODEL_DIR_NAME)
  }
  if (model.id === "model_qwen3_tts_17b_base_mlx") {
    return path.join(paths.modelsDir, QWEN3_TTS_17B_BASE_MODEL_DIR_NAME)
  }
  if (model.id === "model_chatterbox_multilingual_mlx") {
    return path.join(paths.modelsDir, CHATTERBOX_MULTILINGUAL_MODEL_DIR_NAME)
  }
  if (model.id === "model_f5_tts_ptbr_pytorch") {
    return path.join(paths.modelsDir, F5_TTS_MODEL_DIR_NAME)
  }
  return undefined
}

async function detectedModelPathFor(model: RecommendedModel, paths: AppPaths): Promise<string | undefined> {
  const managedPath = managedModelPathFor(model, paths)
  if (managedPath && (await modelPathReady(model, managedPath))) {
    return managedPath
  }

  const projectLocalPath = projectLocalModelPathFor(model, paths)
  if (projectLocalPath && (await modelPathReady(model, projectLocalPath))) {
    return projectLocalPath
  }

  return undefined
}

function projectLocalModelPathFor(model: RecommendedModel, paths: AppPaths): string | undefined {
  if (!isDevPathLayout(paths)) {
    return undefined
  }
  const modelsRoot = path.join(projectLocalRoot(paths), "models")
  if (model.fileName) {
    return path.join(modelsRoot, model.id, model.fileName)
  }
  if (model.id === "model_qwen3_tts_06b_base_mlx") {
    return path.join(modelsRoot, QWEN3_TTS_06B_MODEL_DIR_NAME)
  }
  if (model.id === "model_qwen3_tts_17b_customvoice_mlx") {
    return path.join(modelsRoot, QWEN3_TTS_17B_MODEL_DIR_NAME)
  }
  if (model.id === "model_qwen3_tts_17b_base_mlx") {
    return path.join(modelsRoot, QWEN3_TTS_17B_BASE_MODEL_DIR_NAME)
  }
  if (model.id === "model_chatterbox_multilingual_mlx") {
    return path.join(modelsRoot, CHATTERBOX_MULTILINGUAL_MODEL_DIR_NAME)
  }
  if (model.id === "model_f5_tts_ptbr_pytorch") {
    return path.join(modelsRoot, F5_TTS_MODEL_DIR_NAME)
  }
  return undefined
}

async function modelPathReady(model: RecommendedModel, modelPath: string): Promise<boolean> {
  if (!(await exists(modelPath))) {
    return false
  }
  if (model.id === "model_f5_tts_ptbr_pytorch") {
    return hasAnyModelFile(modelPath, [".safetensors"])
  }
  if (
    model.id === "model_qwen3_tts_06b_base_mlx" ||
    model.id === "model_qwen3_tts_17b_customvoice_mlx" ||
    model.id === "model_qwen3_tts_17b_base_mlx" ||
    model.id === "model_chatterbox_multilingual_mlx"
  ) {
    return (await exists(path.join(modelPath, "config.json"))) || hasAnyModelFile(modelPath, [".safetensors", ".npz"])
  }
  return true
}

async function detectedRuntimeForManifest(adapterId: string, paths: AppPaths, backend: ResolvedInstallBackend = resolveRuntimeInstallBackend("auto")): Promise<
  | {
      environmentJson: Record<string, unknown>
      executablePath: string
      healthcheckCommand?: string
    }
  | undefined
> {
  const pythonRuntime = await detectedPythonRuntime(paths)
  const sidecarScript = sidecarScriptForAdapter(adapterId, paths.sidecarsDir)
  try {
    assertSidecarBackendSupported(adapterId, backend)
  } catch {
    return undefined
  }
  if (!pythonRuntime || !sidecarScript || !(await exists(sidecarScript))) {
    return undefined
  }
  const runtimeEnv = backendRuntimeEnvironment(adapterId, backend)
  return {
    executablePath: pythonRuntime.executablePath,
    environmentJson: {
      args: [sidecarScript],
      env: {
        HF_HOME: pythonRuntime.huggingFaceDir,
        MPLCONFIGDIR: path.join(pythonRuntime.runtimeCacheDir, "matplotlib"),
        PYTHONUNBUFFERED: "1",
        ...runtimeEnv
      },
      timeoutMs: 30 * 60 * 1000
    },
    healthcheckCommand: `${pythonRuntime.executablePath} ${sidecarScript} --health`
  }
}

function sidecarScriptForAdapter(adapterId: string, sidecarsDir: string): string | undefined {
  if (adapterId === "qwen3-tts-mlx") {
    return path.join(sidecarsDir, "tts", "qwen3_tts_mlx_sidecar.py")
  }
  if (adapterId === "chatterbox-mlx") {
    return path.join(sidecarsDir, "tts", "chatterbox_mlx_sidecar.py")
  }
  if (adapterId === "f5-tts-pt-br") {
    return path.join(sidecarsDir, "tts", "f5_tts_ptbr_sidecar.py")
  }
  return undefined
}

async function hasAnyModelFile(directory: string, extensions: string[]): Promise<boolean> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) {
      return true
    }
    if (entry.isDirectory() && (await hasAnyModelFile(fullPath, extensions))) {
      return true
    }
  }
  return false
}

function localPythonExecutablePath(paths: AppPaths): string {
  return path.join(paths.pythonDir, process.platform === "win32" ? "python.exe" : path.join("bin", "python"))
}

function localPythonExecutableCandidates(paths: AppPaths): string[] {
  const pythonRoot = paths.pythonDir
  if (process.platform === "win32") {
    return [path.join(pythonRoot, "python.exe")]
  }
  return [path.join(pythonRoot, "bin", "python"), path.join(pythonRoot, "bin", "python3")]
}

type DetectedPythonRuntime = {
  executablePath: string
  huggingFaceDir: string
  runtimeCacheDir: string
}

async function detectedPythonRuntime(paths: AppPaths): Promise<DetectedPythonRuntime | undefined> {
  const managedExecutable = await firstExistingPath(localPythonExecutableCandidates(paths))
  if (managedExecutable) {
    return {
      executablePath: managedExecutable,
      huggingFaceDir: paths.huggingFaceDir,
      runtimeCacheDir: paths.runtimeCacheDir
    }
  }

  if (!isDevPathLayout(paths)) {
    return undefined
  }

  const projectLocalExecutable = await firstExistingPath(projectLocalPythonExecutableCandidates(paths))
  if (!projectLocalExecutable) {
    return undefined
  }
  const localRoot = projectLocalRoot(paths)
  return {
    executablePath: projectLocalExecutable,
    huggingFaceDir: path.join(localRoot, "huggingface"),
    runtimeCacheDir: path.join(localRoot, "cache")
  }
}

function projectLocalRoot(paths: AppPaths): string {
  return path.join(paths.appRoot, ".dreamreader-local")
}

function projectLocalPythonDir(paths: AppPaths): string {
  return path.join(projectLocalRoot(paths), "python")
}

function projectLocalPythonExecutableCandidates(paths: AppPaths): string[] {
  const pythonRoot = projectLocalPythonDir(paths)
  if (process.platform === "win32") {
    return [path.join(pythonRoot, "python.exe")]
  }
  return [path.join(pythonRoot, "bin", "python"), path.join(pythonRoot, "bin", "python3")]
}

function sidecarReady(
  models: ModelAsset[],
  manifests: Array<typeof runtimeManifests.$inferSelect>,
  adapterId: string
): boolean {
  const hasModel = models.some((model) => model.engineId && adapterIdForEngine(model.engineId) === adapterId && model.installStatus === "available")
  const hasRuntime = manifests.some((manifest) => manifest.adapterId === adapterId && Boolean(manifest.executablePath))
  return hasModel && hasRuntime
}
