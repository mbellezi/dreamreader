import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { eq } from "drizzle-orm"
import { afterEach, describe, expect, it } from "vitest"
import * as schema from "../../src/main/db/schema"
import { ttsEngines, voiceEngineBindings } from "../../src/main/db/schema"
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
      await db
        .update(ttsEngines)
        .set({
          installed: true,
          installPath: path.join(paths.modelsDir, "qwen3-tts-17b")
        })
        .where(eq(ttsEngines.id, "qwen3-tts-17b-mlx"))
      await db
        .update(ttsEngines)
        .set({
          installed: true,
          installPath: path.join(paths.modelsDir, "qwen3-tts-17b-base")
        })
        .where(eq(ttsEngines.id, "qwen3-tts-17b-base-mlx"))

      const service = new VoiceService(db, paths)
      const builtIn = await service.listCompatible("dreamreader-local-tts")
      expect(builtIn.map((voice) => voice.id)).toContain("voice_builtin_ptbr_neutral")

      expect(await service.listCompatible("qwen3-tts-06b-mlx")).toEqual([])
      const qwenVoiceDesignIds = (await service.listCompatible("qwen3-tts-17b-mlx")).map((voice) => voice.id)
      expect(qwenVoiceDesignIds).toEqual(
        expect.arrayContaining(["voice_qwen3_design_ptbr_neutral", "voice_qwen3_design_ptbr_male", "voice_qwen3_design_ptbr_female"])
      )
      expect((await service.listCompatible("qwen3-tts-17b-base-mlx")).map((voice) => voice.id)).toEqual([])
      const qwenVoiceDesignBinding = await db.query.voiceEngineBindings.findFirst({
        where: eq(voiceEngineBindings.id, "voice_binding_voice_qwen3_design_ptbr_neutral_qwen3-tts-17b-mlx")
      })
      expect(qwenVoiceDesignBinding).toMatchObject({
        bindingKind: "voice_design_prompt",
        settingsJson: expect.objectContaining({
          voiceDesignPrompt: expect.any(String)
        })
      })

      const designed = await service.createFromDesignPrompt({
        engineId: "qwen3-tts-17b-mlx",
        language: "pt-BR",
        name: "Voz prompt teste",
        prompt: "A warm Brazilian Portuguese audiobook narrator with stable identity."
      })
      expect(designed.kind).toBe("generated")
      expect(designed.settings).toMatchObject({
        compatibleEngineIds: expect.arrayContaining(["qwen3-tts-17b-mlx"]),
        voiceDesignPrompt: expect.any(String)
      })
      expect((await service.listCompatible("qwen3-tts-17b-mlx")).map((voice) => voice.id)).toContain(designed.id)
      expect(await db.query.voiceEngineBindings.findFirst({ where: eq(voiceEngineBindings.voiceProfileId, designed.id) })).toMatchObject({
        engineId: "qwen3-tts-17b-mlx",
        bindingKind: "voice_design_prompt",
        status: "ready"
      })

      const samplePath = path.join(paths.voicesDir, "reference.wav")
      await mkdir(path.dirname(samplePath), { recursive: true })
      await writeFile(samplePath, Buffer.from("reference-audio"))

      await expect(
        service.createFromReference({
          consentConfirmed: true,
          consentNote: "Autorizado para teste local.",
          engineId: "qwen3-tts-17b-base-mlx",
          language: "pt-BR",
          name: "Qwen 1.7B sem transcricao",
          referenceAudioPath: samplePath
        })
      ).rejects.toMatchObject({ code: "voice_transcript_required" })

      const qwenClone = await service.createFromReference({
        consentConfirmed: true,
        consentNote: "Autorizado para teste local.",
        engineId: "qwen3-tts-17b-base-mlx",
        language: "pt-BR",
        name: "Qwen 1.7B clone",
        referenceAudioPath: samplePath,
        transcript: "Amostra curta."
      })
      // Reference voices are shared across every installed clone-capable engine.
      expect(qwenClone.settings).toMatchObject({
        compatibleEngineIds: expect.arrayContaining(["qwen3-tts-17b-base-mlx", "f5-tts-pt-br"])
      })
      expect((await service.listCompatible("qwen3-tts-17b-base-mlx")).map((voice) => voice.id)).toContain(qwenClone.id)
      expect((await service.listCompatible("f5-tts-pt-br")).map((voice) => voice.id)).toContain(qwenClone.id)

      await writeFile(samplePath, createSilentWav(61_000))
      const qwenLongReferenceClone = await service.createFromReference({
        consentConfirmed: true,
        consentNote: "Autorizado para teste local.",
        engineId: "qwen3-tts-17b-base-mlx",
        language: "pt-BR",
        name: "Qwen 1.7B clone longo",
        referenceAudioPath: samplePath,
        transcript: "Esta transcrição representa uma referência longa para o Qwen Base."
      })
      // Audio length is no longer limited: a >12s reference is accepted (the UI
      // only warns) and is down-sampled to 22 kHz when needed.
      expect(qwenLongReferenceClone.settings).toMatchObject({
        compatibleEngineIds: expect.arrayContaining(["qwen3-tts-17b-base-mlx", "f5-tts-pt-br"])
      })

      const f5BuiltIns = await service.listCompatible("f5-tts-pt-br")
      expect(f5BuiltIns.map((voice) => voice.id)).not.toContain("voice_builtin_ptbr_neutral")

      await expect(
        service.createFromReference({
          consentConfirmed: true,
          consentNote: "Autorizado para teste local.",
          engineId: "f5-tts-pt-br",
          language: "pt-BR",
          name: "Voz sem transcricao",
          referenceAudioPath: samplePath
        })
      ).rejects.toMatchObject({ code: "voice_transcript_required" })

      await writeFile(samplePath, createSilentWav(8_000))
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

      // The 24 kHz reference is down-sampled to 22.05 kHz on registration.
      const clonedSample = await db.query.voiceSamples.findFirst({ where: eq(schema.voiceSamples.voiceProfileId, cloned.id) })
      expect((clonedSample?.qualityJson as { sampleRate?: number; converted?: boolean }).sampleRate).toBe(22_050)
      expect((clonedSample?.qualityJson as { converted?: boolean }).converted).toBe(true)
      // A reference voice binds to every installed clone-capable engine.
      expect(await db.query.voiceEngineBindings.findMany({ where: eq(voiceEngineBindings.voiceProfileId, cloned.id) })).toHaveLength(2)

      const compatible = await service.listCompatible("f5-tts-pt-br")
      expect(compatible.map((voice) => voice.id)).toContain(cloned.id)
      expect(await db.query.voiceSamples.findMany()).toHaveLength(3)
      expect(await db.query.voiceEngineBindings.findMany()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            voiceProfileId: qwenClone.id,
            engineId: "qwen3-tts-17b-base-mlx",
            status: "ready"
          }),
          expect.objectContaining({
            voiceProfileId: qwenLongReferenceClone.id,
            engineId: "qwen3-tts-17b-base-mlx",
            status: "ready"
          }),
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

function createSilentWav(durationMs: number): Buffer {
  const sampleRate = 24_000
  const channelCount = 1
  const bytesPerSample = 2
  const frameCount = Math.max(1, Math.round((durationMs / 1000) * sampleRate))
  const dataSize = frameCount * channelCount * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write("RIFF", 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write("WAVE", 8)
  buffer.write("fmt ", 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channelCount, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28)
  buffer.writeUInt16LE(channelCount * bytesPerSample, 32)
  buffer.writeUInt16LE(bytesPerSample * 8, 34)
  buffer.write("data", 36)
  buffer.writeUInt32LE(dataSize, 40)
  return buffer
}
