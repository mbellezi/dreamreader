import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { eq } from "drizzle-orm"
import { afterEach, describe, expect, it } from "vitest"
import * as schema from "../../src/main/db/schema"
import { ttsEngines } from "../../src/main/db/schema"
import { AudiobookService } from "../../src/main/services/audiobook-service"
import { TtsService } from "../../src/main/services/tts-service"
import { VoiceService } from "../../src/main/services/voice-service"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { force: true, recursive: true })
  }
})

describe("VoiceService", () => {
  it("persists compatible voice profiles, samples, and engine bindings", async () => {
    const { client, db, paths } = await createTestServices()
    try {
      const tts = new TtsService(db, paths, new AudiobookService(db, paths))
      await tts.listJobs()
      await db
        .update(ttsEngines)
        .set({
          installed: true,
          installPath: path.join(paths.modelsDir, "f5")
        })
        .where(eq(ttsEngines.id, "f5-tts-pt-br"))

      const service = new VoiceService(db, paths)
      const builtIn = await service.listCompatible("dreamreader-local-tts")
      expect(builtIn.map((voice) => voice.id)).toContain("voice_builtin_ptbr_neutral")

      const samplePath = path.join(paths.voicesDir, "reference.wav")
      await mkdir(path.dirname(samplePath), { recursive: true })
      await writeFile(samplePath, Buffer.from("reference-audio"))

      const cloned = await service.createFromReference({
        consentConfirmed: true,
        consentNote: "Autorizado para teste local.",
        engineId: "f5-tts-pt-br",
        language: "pt-BR",
        name: "Voz de teste",
        referenceAudioPath: samplePath,
        transcript: "Amostra curta."
      })

      expect(cloned.kind).toBe("cloned")
      expect(cloned.consentConfirmedAt).toBeTruthy()

      const compatible = await service.listCompatible("f5-tts-pt-br")
      expect(compatible.map((voice) => voice.id)).toContain(cloned.id)
      expect(await db.query.voiceSamples.findMany()).toHaveLength(1)
      expect(await db.query.voiceEngineBindings.findMany()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            voiceProfileId: cloned.id,
            engineId: "f5-tts-pt-br",
            status: "ready"
          })
        ])
      )
    } finally {
      await client.close()
    }
  })
})

async function createTestServices() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dreamreader-voices-"))
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
  return { client, db, paths }
}
