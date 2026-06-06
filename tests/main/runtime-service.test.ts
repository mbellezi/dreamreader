import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { afterEach, describe, expect, it } from "vitest"
import * as schema from "../../src/main/db/schema"
import {
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

      const diagnostics = await service.diagnostics()
      expect(diagnostics.find((item) => item.id === "qwen-prosody-gguf")?.status).toBe("available")
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
    paths,
    service: new RuntimeService(db, paths)
  }
}
