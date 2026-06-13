import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { afterEach, describe, expect, it } from "vitest"
import * as schema from "../../src/main/db/schema"
import {
  CHATTERBOX_MULTILINGUAL_MODEL_DIR_NAME,
  F5_TTS_MODEL_DIR_NAME,
  QWEN3_TTS_17B_BASE_MODEL_DIR_NAME,
  QWEN3_TTS_06B_MODEL_DIR_NAME,
  QWEN_PROSODY_GGUF_FILE,
  QWEN_PROSODY_MODEL_ID,
  RuntimeService
} from "../../src/main/services/runtime-service"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { force: true, recursive: true })
  }
})

describe("RuntimeService", () => {
  it("seeds recommended models and registers a local Qwen GGUF path", async () => {
    const { client, paths, service } = await createRuntimeService()
    try {
      const models = await service.listModels()
      const qwen = models.find((model) => model.id === QWEN_PROSODY_MODEL_ID)
      const f5 = models.find((model) => model.id === "model_f5_tts_ptbr_pytorch")

      expect(qwen?.installStatus).toBe("not_configured")
      expect(qwen?.canDownload).toBe(true)
      expect(f5?.canDownload).toBe(false)

      const modelPath = path.join(paths.modelsDir, "manual", QWEN_PROSODY_GGUF_FILE)
      await mkdir(path.dirname(modelPath), { recursive: true })
      await writeFile(modelPath, "gguf")

      const installed = await service.installFromPath(modelPath)
      expect(installed.id).toBe(QWEN_PROSODY_MODEL_ID)
      expect(installed.installStatus).toBe("available")
      expect(installed.downloadProgress).toBe(1)
      expect(installed.path).toBe(modelPath)

      const refreshedModels = await service.listModels()
      expect(refreshedModels.find((model) => model.id === QWEN_PROSODY_MODEL_ID)?.sizeBytes).toBe(4)

      const diagnostics = await service.diagnostics()
      expect(diagnostics.find((item) => item.id === "qwen-prosody-gguf")?.status).toBe("available")

      const deleted = await service.deleteModel(QWEN_PROSODY_MODEL_ID)
      expect(deleted.installStatus).toBe("not_configured")
      expect(deleted.path).toBeUndefined()
      await expect(access(modelPath)).rejects.toThrow()
      const operations = await service.listOperations()
      expect(operations.find((operation) => operation.kind === "model_delete" && operation.targetId === QWEN_PROSODY_MODEL_ID)?.status).toBe("completed")

      const qwenTtsPath = path.join(paths.modelsDir, "Qwen3-TTS-12Hz-1.7B-CustomVoice")
      await mkdir(qwenTtsPath, { recursive: true })

      const ttsModel = await service.installFromPath(qwenTtsPath)
      expect(ttsModel.id).toBe("model_qwen3_tts_17b_customvoice_mlx")
      expect(ttsModel.installStatus).toBe("available")
      expect(ttsModel.path).toBe(qwenTtsPath)

      const qwenBaseTtsPath = path.join(paths.modelsDir, "Qwen3-TTS-12Hz-1.7B-Base-4bit")
      await mkdir(qwenBaseTtsPath, { recursive: true })

      const ttsBaseModel = await service.installFromPath(qwenBaseTtsPath)
      expect(ttsBaseModel.id).toBe("model_qwen3_tts_17b_base_mlx")
      expect(ttsBaseModel.installStatus).toBe("available")
      expect(ttsBaseModel.path).toBe(qwenBaseTtsPath)

      const chatterboxPath = path.join(paths.modelsDir, "chatterbox-fp16")
      await mkdir(chatterboxPath, { recursive: true })

      const chatterboxModel = await service.installFromPath(chatterboxPath)
      expect(chatterboxModel.id).toBe("model_chatterbox_multilingual_mlx")
      expect(chatterboxModel.installStatus).toBe("available")
      expect(chatterboxModel.path).toBe(chatterboxPath)
    } finally {
      await client.close()
    }
  })

  it("detects managed userData Python runtimes, TTS model folders, and packaged sidecars", async () => {
    const { client, db, paths, service } = await createRuntimeService()
    try {
      const pythonExecutable = path.join(paths.pythonDir, "bin", "python")
      const qwenModelPath = path.join(paths.modelsDir, QWEN3_TTS_06B_MODEL_DIR_NAME)
      const qwen17BaseModelPath = path.join(paths.modelsDir, QWEN3_TTS_17B_BASE_MODEL_DIR_NAME)
      const chatterboxModelPath = path.join(paths.modelsDir, CHATTERBOX_MULTILINGUAL_MODEL_DIR_NAME)
      const f5ModelPath = path.join(paths.modelsDir, F5_TTS_MODEL_DIR_NAME)
      const qwenSidecarPath = path.join(paths.sidecarsDir, "tts", "qwen3_tts_mlx_sidecar.py")
      const chatterboxSidecarPath = path.join(paths.sidecarsDir, "tts", "chatterbox_mlx_sidecar.py")
      const f5SidecarPath = path.join(paths.sidecarsDir, "tts", "f5_tts_ptbr_sidecar.py")
      await mkdir(path.dirname(pythonExecutable), { recursive: true })
      await mkdir(qwenModelPath, { recursive: true })
      await mkdir(qwen17BaseModelPath, { recursive: true })
      await mkdir(chatterboxModelPath, { recursive: true })
      await mkdir(f5ModelPath, { recursive: true })
      await mkdir(path.dirname(qwenSidecarPath), { recursive: true })
      await writeFile(pythonExecutable, "#!/usr/bin/env python3\n")
      await writeFile(path.join(qwenModelPath, "config.json"), "{}\n")
      await writeFile(path.join(qwen17BaseModelPath, "config.json"), "{}\n")
      await writeFile(path.join(chatterboxModelPath, "config.json"), "{}\n")
      await writeFile(path.join(f5ModelPath, "model_last.safetensors"), "f5\n")
      await writeFile(qwenSidecarPath, "# qwen sidecar\n")
      await writeFile(chatterboxSidecarPath, "# chatterbox sidecar\n")
      await writeFile(f5SidecarPath, "# f5 sidecar\n")

      const models = await service.listModels()
      const qwenModel = models.find((model) => model.id === "model_qwen3_tts_06b_base_mlx")
      const qwen17BaseModel = models.find((model) => model.id === "model_qwen3_tts_17b_base_mlx")
      const chatterboxModel = models.find((model) => model.id === "model_chatterbox_multilingual_mlx")
      const f5Model = models.find((model) => model.id === "model_f5_tts_ptbr_pytorch")
      expect(qwenModel?.installStatus).toBe("available")
      expect(qwenModel?.path).toBe(qwenModelPath)
      expect(qwen17BaseModel?.installStatus).toBe("available")
      expect(qwen17BaseModel?.path).toBe(qwen17BaseModelPath)
      expect(chatterboxModel?.installStatus).toBe("available")
      expect(chatterboxModel?.path).toBe(chatterboxModelPath)
      expect(f5Model?.installStatus).toBe("available")
      expect(f5Model?.path).toBe(f5ModelPath)

      const qwenEngine = await db.query.ttsEngines.findFirst({
        where: (table, { eq }) => eq(table.id, "qwen3-tts-06b-mlx")
      })
      const f5Engine = await db.query.ttsEngines.findFirst({
        where: (table, { eq }) => eq(table.id, "f5-tts-pt-br")
      })
      const chatterboxEngine = await db.query.ttsEngines.findFirst({
        where: (table, { eq }) => eq(table.id, "chatterbox-multilingual-mlx")
      })
      const qwen17BaseEngine = await db.query.ttsEngines.findFirst({
        where: (table, { eq }) => eq(table.id, "qwen3-tts-17b-base-mlx")
      })
      expect(qwenEngine?.installed).toBe(true)
      expect(qwenEngine?.installPath).toBe(qwenModelPath)
      expect(qwenEngine?.adapterId).toBe("qwen3-tts-mlx")
      expect(qwenEngine?.capabilitiesJson).toMatchObject({ supportsVoiceClone: true })
      expect(qwen17BaseEngine?.installed).toBe(true)
      expect(qwen17BaseEngine?.installPath).toBe(qwen17BaseModelPath)
      expect(qwen17BaseEngine?.adapterId).toBe("qwen3-tts-mlx")
      expect(qwen17BaseEngine?.capabilitiesJson).toMatchObject({ supportsVoiceClone: true })
      expect(chatterboxEngine?.installed).toBe(true)
      expect(chatterboxEngine?.installPath).toBe(chatterboxModelPath)
      expect(chatterboxEngine?.adapterId).toBe("chatterbox-mlx")
      expect(chatterboxEngine?.capabilitiesJson).toMatchObject({ supportsVoiceClone: true, supportsDiscreteEmotion: true })
      expect(f5Engine?.installed).toBe(true)
      expect(f5Engine?.installPath).toBe(f5ModelPath)
      expect(f5Engine?.adapterId).toBe("f5-tts-pt-br")

      const qwenManifest = await db.query.runtimeManifests.findFirst({
        where: (table, { eq }) => eq(table.adapterId, "qwen3-tts-mlx")
      })
      const f5Manifest = await db.query.runtimeManifests.findFirst({
        where: (table, { eq }) => eq(table.adapterId, "f5-tts-pt-br")
      })
      const chatterboxManifest = await db.query.runtimeManifests.findFirst({
        where: (table, { eq }) => eq(table.adapterId, "chatterbox-mlx")
      })
      expect(qwenManifest?.executablePath).toBe(pythonExecutable)
      expect(qwenManifest?.environmentJson).toMatchObject({ args: [qwenSidecarPath] })
      expect(chatterboxManifest?.executablePath).toBe(pythonExecutable)
      expect(chatterboxManifest?.environmentJson).toMatchObject({ args: [chatterboxSidecarPath] })
      expect(f5Manifest?.executablePath).toBe(pythonExecutable)
      expect(f5Manifest?.environmentJson).toMatchObject({ args: [f5SidecarPath] })

      const sidecars = await service.listSidecars()
      expect(sidecars.find((sidecar) => sidecar.id === "runtime_qwen3_tts_mlx_sidecar")?.status).toBe("available")
      expect(sidecars.find((sidecar) => sidecar.id === "runtime_chatterbox_mlx_sidecar")?.status).toBe("available")
      expect(sidecars.find((sidecar) => sidecar.id === "runtime_f5_tts_pt_br_pytorch_sidecar")?.status).toBe("available")

      const diagnostics = await service.diagnostics()
      expect(diagnostics.find((item) => item.id === "qwen3-tts-sidecar")?.status).toBe("available")
      expect(diagnostics.find((item) => item.id === "chatterbox-tts-sidecar")?.status).toBe("available")
      expect(diagnostics.find((item) => item.id === "f5-tts-sidecar")?.status).toBe("available")
    } finally {
      await client.close()
    }
  })

  it("keeps project-local .dreamreader-local Python and TTS model paths in dev layouts", async () => {
    const { client, db, paths, service } = await createRuntimeService()
    try {
      const localRoot = path.join(paths.appRoot, ".dreamreader-local")
      const pythonExecutable = path.join(localRoot, "python", "bin", "python")
      const qwenModelPath = path.join(localRoot, "models", QWEN3_TTS_06B_MODEL_DIR_NAME)
      const qwenSidecarPath = path.join(paths.sidecarsDir, "tts", "qwen3_tts_mlx_sidecar.py")
      await mkdir(path.dirname(pythonExecutable), { recursive: true })
      await mkdir(qwenModelPath, { recursive: true })
      await mkdir(path.dirname(qwenSidecarPath), { recursive: true })
      await writeFile(pythonExecutable, "#!/usr/bin/env python3\n")
      await writeFile(path.join(qwenModelPath, "config.json"), "{}\n")
      await writeFile(qwenSidecarPath, "# qwen sidecar\n")

      const models = await service.listModels()
      const qwenModel = models.find((model) => model.id === "model_qwen3_tts_06b_base_mlx")
      expect(qwenModel?.installStatus).toBe("available")
      expect(qwenModel?.path).toBe(qwenModelPath)

      const qwenEngine = await db.query.ttsEngines.findFirst({
        where: (table, { eq }) => eq(table.id, "qwen3-tts-06b-mlx")
      })
      expect(qwenEngine?.installed).toBe(true)
      expect(qwenEngine?.installPath).toBe(qwenModelPath)

      const qwenManifest = await db.query.runtimeManifests.findFirst({
        where: (table, { eq }) => eq(table.adapterId, "qwen3-tts-mlx")
      })
      expect(qwenManifest?.executablePath).toBe(pythonExecutable)
      expect(qwenManifest?.environmentJson).toMatchObject({
        args: [qwenSidecarPath],
        env: {
          HF_HOME: path.join(localRoot, "huggingface"),
          MPLCONFIGDIR: path.join(localRoot, "cache", "matplotlib")
        }
      })

      const sidecars = await service.listSidecars()
      const qwenSidecar = sidecars.find((sidecar) => sidecar.id === "runtime_qwen3_tts_mlx_sidecar")
      expect(qwenSidecar?.status).toBe("available")
      expect(qwenSidecar?.executablePath).toBe(pythonExecutable)
    } finally {
      await client.close()
    }
  })

  it("invalidates legacy .dreamreader-local model and sidecar paths from persisted catalogs", async () => {
    const { client, db, paths, service } = await createRuntimeService()
    try {
      paths.resourcesDir = path.join(paths.appRoot, "DreamReader.app", "Contents", "Resources")
      paths.sidecarsDir = path.join(paths.resourcesDir, "sidecars")
      const legacyRoot = path.join(paths.appRoot, ".dreamreader-local")
      const legacyModelPath = path.join(legacyRoot, "models", QWEN3_TTS_06B_MODEL_DIR_NAME)
      const legacyPythonPath = path.join(legacyRoot, "python", "bin", "python")
      await mkdir(path.dirname(legacyPythonPath), { recursive: true })
      await mkdir(legacyModelPath, { recursive: true })
      await writeFile(legacyPythonPath, "#!/usr/bin/env python3\n")
      await writeFile(path.join(legacyModelPath, "config.json"), "{}\n")
      await db.insert(schema.modelAssets).values({
        id: "model_qwen3_tts_06b_base_mlx",
        kind: "tts",
        name: "Qwen3-TTS 12Hz 0.6B Base",
        provider: "Qwen",
        version: "12Hz-0.6B-Base",
        path: legacyModelPath,
        sizeBytes: 1234,
        license: "apache-2.0",
        runtime: "mlx-sidecar",
        format: "mlx",
        acceleratorPreference: "mlx",
        installStatus: "available",
        downloadProgress: 1,
        metadataJson: {
          engineId: "qwen3-tts-06b-mlx"
        },
        installedAt: new Date()
      })
      await db.insert(schema.ttsEngines).values({
        id: "qwen3-tts-06b-mlx",
        displayName: "Qwen3-TTS 12Hz 0.6B Base",
        version: "12Hz-0.6B-Base",
        adapterId: "qwen3-tts-mlx",
        runtime: "mlx",
        modelFormat: "mlx",
        accelerator: "apple_metal",
        capabilitiesJson: {},
        performanceProfileJson: {},
        installed: true,
        installPath: legacyModelPath
      })
      await db.insert(schema.runtimeManifests).values({
        id: "runtime_qwen3_tts_mlx_sidecar",
        adapterId: "qwen3-tts-mlx",
        runtime: "mlx",
        version: "sidecar-v1",
        capabilitiesJson: {
          engines: ["qwen3-tts-06b-mlx"]
        },
        executablePath: legacyPythonPath,
        environmentJson: {
          args: [path.join(legacyRoot, "sidecars", "tts", "qwen3_tts_mlx_sidecar.py")]
        },
        healthcheckCommand: `${legacyPythonPath} --health`
      })

      const models = await service.listModels()
      const qwenModel = models.find((model) => model.id === "model_qwen3_tts_06b_base_mlx")
      expect(qwenModel?.installStatus).toBe("not_configured")
      expect(qwenModel?.path).toBeUndefined()
      expect(qwenModel?.sizeBytes).toBeUndefined()

      const qwenEngine = await db.query.ttsEngines.findFirst({
        where: (table, { eq }) => eq(table.id, "qwen3-tts-06b-mlx")
      })
      expect(qwenEngine?.installed).toBe(false)
      expect(qwenEngine?.installPath).toBeNull()

      const sidecars = await service.listSidecars()
      const qwenSidecar = sidecars.find((sidecar) => sidecar.id === "runtime_qwen3_tts_mlx_sidecar")
      expect(qwenSidecar?.status).toBe("not_configured")
      expect(qwenSidecar?.executablePath).toBeUndefined()
    } finally {
      await client.close()
    }
  })

  it("removes deprecated DreamReader local model and sidecar catalog entries", async () => {
    const { client, db, paths, service } = await createRuntimeService()
    try {
      await db.insert(schema.modelAssets).values({
        id: "model_dreamreader_local_tts",
        kind: "tts",
        name: "DreamReader Local TTS",
        provider: "DreamReader",
        version: "0.1.0",
        license: "internal",
        runtime: "local",
        format: "wav",
        acceleratorPreference: "cpu",
        installStatus: "available",
        downloadProgress: 1,
        metadataJson: {
          engineId: "dreamreader-local-tts",
          adapterId: "dreamreader-local-wav"
        }
      })
      await db.insert(schema.modelAssets).values({
        id: "model_generic_models_dreamreader",
        kind: "runtime",
        name: "models - dreamreader",
        provider: "local",
        version: "local",
        path: path.join(paths.userData, "models - dreamreader"),
        license: "unknown",
        runtime: "external",
        format: "unknown",
        acceleratorPreference: "cpu",
        installStatus: "available",
        downloadProgress: 1,
        metadataJson: {
          role: "runtime",
          registeredFrom: "local-path"
        }
      })
      await db.insert(schema.runtimeManifests).values({
        id: "runtime_dreamreader_local_tts",
        adapterId: "dreamreader-local-wav",
        runtime: "local",
        version: "0.1.0",
        capabilitiesJson: {
          engines: ["dreamreader-local-tts"]
        }
      })

      const models = await service.listModels()
      expect(models.map((model) => model.id)).not.toContain("model_dreamreader_local_tts")
      expect(models.map((model) => model.id)).not.toContain("model_generic_models_dreamreader")
      expect(models.some((model) => model.provider === "DreamReader")).toBe(false)
      expect(models.some((model) => model.name === "models - dreamreader")).toBe(false)

      const legacyModel = await db.query.modelAssets.findFirst({
        where: (table, { eq }) => eq(table.id, "model_dreamreader_local_tts")
      })
      const legacyGenericModel = await db.query.modelAssets.findFirst({
        where: (table, { eq }) => eq(table.id, "model_generic_models_dreamreader")
      })
      const legacyRuntime = await db.query.runtimeManifests.findFirst({
        where: (table, { eq }) => eq(table.id, "runtime_dreamreader_local_tts")
      })
      expect(legacyModel).toBeUndefined()
      expect(legacyGenericModel).toBeUndefined()
      expect(legacyRuntime).toBeUndefined()

      const diagnostics = await service.diagnostics()
      expect(diagnostics.map((diagnostic) => diagnostic.id)).not.toContain("local-tts-adapter")
    } finally {
      await client.close()
    }
  })

  it("rejects unknown folders instead of registering generic runtime models", async () => {
    const { client, paths, service } = await createRuntimeService()
    try {
      const unknownPath = path.join(paths.userData, "models - dreamreader")
      await mkdir(unknownPath, { recursive: true })

      await expect(service.installFromPath(unknownPath)).rejects.toThrow("The selected path does not match a supported DreamReader model")
    } finally {
      await client.close()
    }
  })
})

async function createRuntimeService() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dreamreader-runtime-"))
  tempDirs.push(tempDir)
  const client = new PGlite(path.join(tempDir, "db"))
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: path.resolve("drizzle") })
  const paths = {
    appRoot: tempDir,
    resourcesDir: tempDir,
    userData: tempDir,
    dbDir: path.join(tempDir, "db"),
    booksDir: path.join(tempDir, "library", "books"),
    coversDir: path.join(tempDir, "library", "covers"),
    extractedDir: path.join(tempDir, "library", "extracted"),
    audioCacheDir: path.join(tempDir, "audio-cache"),
    audiobooksDir: path.join(tempDir, "audiobooks"),
    voicesDir: path.join(tempDir, "voices"),
    modelsDir: path.join(tempDir, "models"),
    runtimeDir: path.join(tempDir, "runtimes"),
    pythonDir: path.join(tempDir, "runtimes", "python"),
    runtimeDownloadsDir: path.join(tempDir, "runtimes", "downloads"),
    runtimeCacheDir: path.join(tempDir, "runtime-cache"),
    huggingFaceDir: path.join(tempDir, "huggingface"),
    sidecarsDir: path.join(tempDir, "sidecars"),
    logsDir: path.join(tempDir, "logs"),
    backupsDir: path.join(tempDir, "backups")
  }

  return {
    client,
    db,
    paths,
    service: new RuntimeService(db, paths)
  }
}
