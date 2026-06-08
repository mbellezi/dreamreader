import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { afterEach, describe, expect, it } from "vitest"
import * as schema from "../../src/main/db/schema"
import {
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
    } finally {
      await client.close()
    }
  })

  it("detects the ignored project-local Python runtimes and TTS model folders", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "dreamreader-project-root-"))
    tempDirs.push(projectRoot)
    const previousRoot = process.env.DREAMREADER_PROJECT_ROOT
    process.env.DREAMREADER_PROJECT_ROOT = projectRoot
    try {
      const pythonExecutable = path.join(projectRoot, ".dreamreader-local", "python", "bin", "python")
      const qwenModelPath = path.join(projectRoot, ".dreamreader-local", "models", QWEN3_TTS_06B_MODEL_DIR_NAME)
      const qwen17BaseModelPath = path.join(projectRoot, ".dreamreader-local", "models", QWEN3_TTS_17B_BASE_MODEL_DIR_NAME)
      const f5ModelPath = path.join(projectRoot, ".dreamreader-local", "models", F5_TTS_MODEL_DIR_NAME)
      const qwenSidecarPath = path.join(projectRoot, "sidecars", "tts", "qwen3_tts_mlx_sidecar.py")
      const f5SidecarPath = path.join(projectRoot, "sidecars", "tts", "f5_tts_ptbr_sidecar.py")
      await mkdir(path.dirname(pythonExecutable), { recursive: true })
      await mkdir(qwenModelPath, { recursive: true })
      await mkdir(qwen17BaseModelPath, { recursive: true })
      await mkdir(f5ModelPath, { recursive: true })
      await mkdir(path.dirname(qwenSidecarPath), { recursive: true })
      await writeFile(pythonExecutable, "#!/usr/bin/env python3\n")
      await writeFile(path.join(qwenModelPath, "config.json"), "{}\n")
      await writeFile(path.join(qwen17BaseModelPath, "config.json"), "{}\n")
      await writeFile(path.join(f5ModelPath, "model_last.safetensors"), "f5\n")
      await writeFile(qwenSidecarPath, "# qwen sidecar\n")
      await writeFile(f5SidecarPath, "# f5 sidecar\n")

      const { client, db, service } = await createRuntimeService()
      try {
        const models = await service.listModels()
        const qwenModel = models.find((model) => model.id === "model_qwen3_tts_06b_base_mlx")
        const qwen17BaseModel = models.find((model) => model.id === "model_qwen3_tts_17b_base_mlx")
        const f5Model = models.find((model) => model.id === "model_f5_tts_ptbr_pytorch")
        expect(qwenModel?.installStatus).toBe("available")
        expect(qwenModel?.path).toBe(qwenModelPath)
        expect(qwen17BaseModel?.installStatus).toBe("available")
        expect(qwen17BaseModel?.path).toBe(qwen17BaseModelPath)
        expect(f5Model?.installStatus).toBe("available")
        expect(f5Model?.path).toBe(f5ModelPath)

        const qwenEngine = await db.query.ttsEngines.findFirst({
          where: (table, { eq }) => eq(table.id, "qwen3-tts-06b-mlx")
        })
        const f5Engine = await db.query.ttsEngines.findFirst({
          where: (table, { eq }) => eq(table.id, "f5-tts-pt-br")
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
        expect(f5Engine?.installed).toBe(true)
        expect(f5Engine?.installPath).toBe(f5ModelPath)
        expect(f5Engine?.adapterId).toBe("f5-tts-pt-br")

        const qwenManifest = await db.query.runtimeManifests.findFirst({
          where: (table, { eq }) => eq(table.adapterId, "qwen3-tts-mlx")
        })
        const f5Manifest = await db.query.runtimeManifests.findFirst({
          where: (table, { eq }) => eq(table.adapterId, "f5-tts-pt-br")
        })
        expect(qwenManifest?.executablePath).toBe(pythonExecutable)
        expect(qwenManifest?.environmentJson).toMatchObject({ args: [qwenSidecarPath] })
        expect(f5Manifest?.executablePath).toBe(pythonExecutable)
        expect(f5Manifest?.environmentJson).toMatchObject({ args: [f5SidecarPath] })

        const sidecars = await service.listSidecars()
        expect(sidecars.find((sidecar) => sidecar.id === "runtime_qwen3_tts_mlx_sidecar")?.status).toBe("available")
        expect(sidecars.find((sidecar) => sidecar.id === "runtime_f5_tts_pt_br_pytorch_sidecar")?.status).toBe("available")

        const diagnostics = await service.diagnostics()
        expect(diagnostics.find((item) => item.id === "qwen3-tts-sidecar")?.status).toBe("available")
        expect(diagnostics.find((item) => item.id === "f5-tts-sidecar")?.status).toBe("available")
      } finally {
        await client.close()
      }
    } finally {
      if (previousRoot === undefined) {
        delete process.env.DREAMREADER_PROJECT_ROOT
      } else {
        process.env.DREAMREADER_PROJECT_ROOT = previousRoot
      }
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
    userData: tempDir,
    dbDir: path.join(tempDir, "db"),
    booksDir: path.join(tempDir, "library", "books"),
    coversDir: path.join(tempDir, "library", "covers"),
    extractedDir: path.join(tempDir, "library", "extracted"),
    audioCacheDir: path.join(tempDir, "audio-cache"),
    audiobooksDir: path.join(tempDir, "audiobooks"),
    voicesDir: path.join(tempDir, "voices"),
    modelsDir: path.join(tempDir, "models"),
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
