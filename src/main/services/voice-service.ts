import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { and, asc, eq, inArray } from "drizzle-orm"
import {
  VoiceEngineBindingSchema,
  VoiceProfileSchema,
  VoiceSampleSchema,
  type VoiceCloneInput,
  type VoiceDesignPromptInput,
  type VoiceEngineBinding,
  type VoiceFilter,
  type VoiceProfile,
  type VoiceSample
} from "@shared/contracts/ai"
import type { AppDatabase } from "@main/db/client"
import { assets, ttsEngines, voiceEngineBindings, voiceProfiles, voiceSamples } from "@main/db/schema"
import { AppError } from "@main/lib/errors"
import { hashBuffer } from "@main/lib/hash"
import { createId } from "@main/lib/ids"
import type { AppPaths } from "@main/lib/paths"
import {
  builtInBindingIdFor,
  builtInBindingKindFor,
  builtInCompatibilityFor,
  builtInSettingsFor,
  builtInVoicePresets,
  DEFAULT_VOICE_PROFILE_ID
} from "@main/services/default-voices"
import { LocalTtsAdapter } from "@main/services/local-tts-adapter"
import { buildPreviewPlan } from "@main/services/voice-preview"
import { probeAudio, resampleAudio, TARGET_SAMPLE_RATE } from "@main/lib/audio-transcode"

const QWEN_VOICE_DESIGN_ENGINE_ID = "qwen3-tts-17b-mlx"

export class VoiceService {
  private readonly previewAdapter = new LocalTtsAdapter()
  private readyPromise: Promise<void> | undefined

  constructor(
    private readonly db: AppDatabase,
    private readonly paths: AppPaths
  ) {}

  async list(filter: Partial<VoiceFilter> = {}): Promise<VoiceProfile[]> {
    await this.ensureReady()
    const rows = await this.db.query.voiceProfiles.findMany({
      orderBy: [asc(voiceProfiles.createdAt)]
    })
    const bindings = await this.db.query.voiceEngineBindings.findMany()
    return rows
      .filter((voice) => {
        if (filter.language && voice.language !== filter.language) return false
        if (filter.kind && voice.kind !== filter.kind) return false
        if (filter.engineId || filter.adapterId || !filter.includeUnavailable) {
          return bindings.some((binding) => {
            if (binding.voiceProfileId !== voice.id) return false
            if (!filter.includeUnavailable && binding.status !== "ready") return false
            if (filter.engineId && binding.engineId !== filter.engineId) return false
            if (filter.adapterId && binding.adapterId !== filter.adapterId) return false
            return true
          })
        }
        return true
      })
      .map((voice) => toVoiceProfile(voice, bindings.filter((binding) => binding.voiceProfileId === voice.id)))
  }

  async listCompatible(engineId?: string): Promise<VoiceProfile[]> {
    return this.list(engineId ? { engineId } : {})
  }

  async createFromReference(input: VoiceCloneInput): Promise<VoiceProfile> {
    await this.ensureReady()
    // A reference voice is shared across every installed engine that supports
    // cloning (Qwen 0.6B Base, Qwen 1.7B Base and F5 use the same sample).
    const engines = await this.db.query.ttsEngines.findMany()
    const cloneEngines = engines.filter(
      (engine) => engine.installed && jsonObject(engine.capabilitiesJson).supportsVoiceClone === true
    )
    if (!cloneEngines.length) {
      throw new AppError("voice_clone_no_engine", "No installed engine supports voice cloning")
    }
    if (!input.transcript?.trim()) {
      throw new AppError("voice_transcript_required", "Voice cloning requires a transcript that matches the reference audio")
    }

    const now = new Date()
    const profileId = createId("voice")
    const sample = await this.copyReferenceSample(profileId, input, now)
    const [voice] = await this.db
      .insert(voiceProfiles)
      .values({
        id: profileId,
        name: input.name,
        description: "",
        language: input.language,
        kind: "cloned",
        source: JSON.stringify({
          type: "reference_audio",
          originalFileName: path.basename(input.referenceAudioPath),
          sampleAssetId: sample.assetId,
          sampleRate: sample.sampleRate
        }),
        tags: [input.language, "clonada"],
        settingsJson: {
          compatibleAdapterIds: unique(cloneEngines.map((engine) => engine.adapterId)),
          compatibleEngineIds: cloneEngines.map((engine) => engine.id)
        },
        consentConfirmedAt: now,
        consentNote: input.consentNote,
        createdFromEngineId: input.engineId ?? cloneEngines[0].id,
        updatedAt: now
      })
      .returning()

    await this.db.insert(voiceSamples).values({
      id: sample.id,
      voiceProfileId: profileId,
      assetId: sample.assetId,
      transcript: input.transcript,
      language: input.language,
      durationMs: sample.durationMs,
      qualityJson: sample.quality,
      consentConfirmedAt: now
    })

    for (const engine of cloneEngines) {
      await this.db.insert(voiceEngineBindings).values({
        id: createId("voice_binding"),
        voiceProfileId: profileId,
        engineId: engine.id,
        adapterId: engine.adapterId,
        status: "ready",
        bindingKind: "reference_audio",
        bindingAssetId: sample.assetId,
        settingsJson: {
          transcript: input.transcript ?? "",
          source: "local-reference"
        },
        compatibilityJson: {
          language: input.language,
          engineVersion: engine.version
        },
        updatedAt: now
      })
    }

    return toVoiceProfile(voice, await this.bindingsForVoice(profileId))
  }

  async createFromDesignPrompt(input: VoiceDesignPromptInput): Promise<VoiceProfile> {
    await this.ensureReady()
    const engine = await this.db.query.ttsEngines.findFirst({ where: eq(ttsEngines.id, input.engineId) })
    if (!engine) {
      throw new AppError("tts_engine_not_found", "TTS engine not found")
    }
    if (!engine.installed) {
      throw new AppError("tts_engine_not_configured", "TTS engine model is not installed")
    }
    if (engine.id !== QWEN_VOICE_DESIGN_ENGINE_ID || engine.adapterId !== "qwen3-tts-mlx") {
      throw new AppError("voice_design_unsupported", "Selected engine does not support voice design prompts")
    }

    const now = new Date()
    const profileId = createId("voice")
    const [voice] = await this.db
      .insert(voiceProfiles)
      .values({
        id: profileId,
        name: input.name,
        description: "",
        language: input.language,
        kind: "generated",
        source: JSON.stringify({
          type: "voice_design_prompt",
          provider: "qwen3-tts"
        }),
        tags: [input.language, "voice-design"],
        settingsJson: {
          voiceDesignPrompt: input.prompt
        },
        createdFromEngineId: input.engineId,
        updatedAt: now
      })
      .returning()

    await this.db.insert(voiceEngineBindings).values({
      id: createId("voice_binding"),
      voiceProfileId: profileId,
      engineId: input.engineId,
      adapterId: engine.adapterId,
      status: "ready",
      bindingKind: "voice_design_prompt",
      settingsJson: {
        voiceDesignPrompt: input.prompt,
        source: "local-voice-design"
      },
      compatibilityJson: {
        language: input.language,
        engineVersion: engine.version
      },
      updatedAt: now
    })

    return toVoiceProfile(voice, await this.bindingsForVoice(profileId))
  }

  async preview(input: { voiceProfileId: string; engineId: string }) {
    await this.ensureReady()
    const voice = await this.getProfile(input.voiceProfileId)
    const binding = await this.readyBinding(input.voiceProfileId, input.engineId)
    const previewPath = path.join(this.paths.voicesDir, input.voiceProfileId, `preview-${sanitizePathPart(input.engineId)}.wav`)
    await mkdir(path.dirname(previewPath), { recursive: true })
    await this.previewAdapter.warmup()
    const audio = this.previewAdapter.synthesizeChapter(buildPreviewPlan(input.voiceProfileId, input.engineId, voice.language))
    await writeFile(previewPath, audio.buffer)
    this.previewAdapter.scheduleDispose()
    const [asset] = await this.db
      .insert(assets)
      .values({
        id: createId("asset"),
        kind: "voice_preview",
        path: previewPath,
        mimeType: audio.mimeType,
        contentHash: audio.contentHash,
        sizeBytes: audio.buffer.byteLength
      })
      .returning()
    await this.db
      .update(voiceProfiles)
      .set({
        previewAssetId: asset.id,
        updatedAt: new Date()
      })
      .where(eq(voiceProfiles.id, input.voiceProfileId))
    await this.db
      .update(voiceEngineBindings)
      .set({
        settingsJson: {
          ...jsonObject(binding.settingsJson),
          previewAssetId: asset.id
        },
        updatedAt: new Date()
      })
      .where(eq(voiceEngineBindings.id, binding.id))
    return { audioAssetId: asset.id }
  }

  async update(input: { voiceProfileId: string; name?: string; description?: string | null; tags?: string[] }) {
    await this.ensureReady()
    await this.getProfile(input.voiceProfileId)
    const [updated] = await this.db
      .update(voiceProfiles)
      .set({
        name: input.name,
        description: input.description === undefined ? undefined : input.description ?? "",
        tags: input.tags,
        updatedAt: new Date()
      })
      .where(eq(voiceProfiles.id, input.voiceProfileId))
      .returning()
    return toVoiceProfile(updated, await this.bindingsForVoice(input.voiceProfileId))
  }

  async delete(input: { voiceProfileId: string }) {
    await this.ensureReady()
    const voice = await this.getProfile(input.voiceProfileId)
    if (voice.kind === "built_in") {
      throw new AppError("voice_readonly", "Built-in voices cannot be deleted")
    }

    const assetIds = new Set<string>()
    const samples = await this.db.query.voiceSamples.findMany({ where: eq(voiceSamples.voiceProfileId, input.voiceProfileId) })
    samples.forEach((sample) => assetIds.add(sample.assetId))
    const bindings = await this.bindingsForVoice(input.voiceProfileId)
    bindings.forEach((binding) => {
      if (binding.bindingAssetId) assetIds.add(binding.bindingAssetId)
    })
    if (voice.previewAssetId) {
      assetIds.add(voice.previewAssetId)
    }

    const assetRows = assetIds.size
      ? await this.db.query.assets.findMany({
          where: inArray(assets.id, [...assetIds])
        })
      : []
    await this.db.delete(voiceProfiles).where(eq(voiceProfiles.id, input.voiceProfileId))
    if (assetIds.size) {
      await this.db.delete(assets).where(inArray(assets.id, [...assetIds]))
    }
    await Promise.all(assetRows.map((asset) => unlink(asset.path).catch(() => undefined)))
    return { deleted: true as const }
  }

  async getVoiceForSynthesis(input: {
    engineId: string
    voiceBindingId?: string
    voiceProfileId?: string
  }): Promise<{ binding?: VoiceEngineBinding; profile?: VoiceProfile; samples: VoiceSample[] }> {
    await this.ensureReady()
    const profileId = input.voiceProfileId ?? DEFAULT_VOICE_PROFILE_ID
    const profileRow = await this.getProfile(profileId)
    const binding = input.voiceBindingId
      ? await this.bindingById(input.voiceBindingId)
      : await this.readyBinding(profileId, input.engineId)
    const sampleRows = await this.db.query.voiceSamples.findMany({ where: eq(voiceSamples.voiceProfileId, profileId) })
    return {
      binding: toVoiceBinding(binding),
      profile: toVoiceProfile(profileRow, await this.bindingsForVoice(profileId)),
      samples: sampleRows.map(toVoiceSample)
    }
  }

  private async copyReferenceSample(profileId: string, input: VoiceCloneInput, now: Date) {
    const info = await stat(input.referenceAudioPath)
    if (!info.isFile()) {
      throw new AppError("voice_sample_invalid", "Voice reference must be a file")
    }
    const probe = await probeAudio(input.referenceAudioPath)
    const targetDir = path.join(this.paths.voicesDir, profileId)
    await mkdir(targetDir, { recursive: true })

    // Audio length is not limited; we only down-sample to 22.05 kHz when the
    // source rate is higher (Qwen Base / F5 expect <= 22 kHz references).
    let sourcePath = input.referenceAudioPath
    let extension = path.extname(input.referenceAudioPath).toLowerCase() || ".wav"
    let sampleRate = probe.sampleRate
    let converted = false
    if (probe.sampleRate && probe.sampleRate > TARGET_SAMPLE_RATE) {
      const tempPath = path.join(targetDir, "reference-converting.wav")
      if (await resampleAudio(input.referenceAudioPath, tempPath, TARGET_SAMPLE_RATE)) {
        sourcePath = tempPath
        extension = ".wav"
        sampleRate = TARGET_SAMPLE_RATE
        converted = true
      }
    }

    const buffer = await readFile(sourcePath)
    const contentHash = hashBuffer(buffer)
    const targetPath = path.join(targetDir, `reference-${contentHash.slice(0, 16)}${extension}`)
    if (converted) {
      await rename(sourcePath, targetPath)
    } else {
      await copyFile(sourcePath, targetPath)
    }
    const durationMs = probe.durationMs ?? estimateDurationMs(buffer)
    const [asset] = await this.db
      .insert(assets)
      .values({
        id: createId("asset"),
        kind: "voice_sample",
        path: targetPath,
        mimeType: mimeTypeFor(extension),
        contentHash,
        sizeBytes: buffer.byteLength,
        createdAt: now
      })
      .returning()
    return {
      id: createId("voice_sample"),
      assetId: asset.id,
      durationMs,
      sampleRate,
      quality: {
        sourceBytes: buffer.byteLength,
        sampleRate: sampleRate ?? null,
        converted,
        durationEstimate: probe.durationMs ? "metadata" : "container-header-or-fallback"
      }
    }
  }

  private async ensureReady(): Promise<void> {
    this.readyPromise ??= this.ensureDefaults()
    await this.readyPromise
  }

  private async ensureDefaults(): Promise<void> {
    await mkdir(this.paths.voicesDir, { recursive: true })
    const now = new Date()
    const engines = await this.db.query.ttsEngines.findMany()

    for (const preset of builtInVoicePresets) {
      await this.db
        .insert(voiceProfiles)
        .values({
          id: preset.id,
          name: preset.name,
          description: preset.description,
          language: preset.language,
          kind: "built_in",
          source: JSON.stringify(preset.source),
          tags: preset.tags,
          settingsJson: {
            ...preset.settings,
            compatibleEngineIds: preset.engineIds,
            compatibleAdapterIds: unique(
              engines.filter((engine) => preset.engineIds.includes(engine.id)).map((engine) => engine.adapterId)
            )
          },
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: voiceProfiles.id,
          set: {
            name: preset.name,
            description: preset.description,
            language: preset.language,
            source: JSON.stringify(preset.source),
            tags: preset.tags,
            settingsJson: {
              ...preset.settings,
              compatibleEngineIds: preset.engineIds,
              compatibleAdapterIds: unique(
                engines.filter((engine) => preset.engineIds.includes(engine.id)).map((engine) => engine.adapterId)
              )
            },
            updatedAt: now
          }
        })

      for (const engine of engines.filter((item) => preset.engineIds.includes(item.id))) {
        await this.db
          .insert(voiceEngineBindings)
          .values({
            id: builtInBindingIdFor(preset.id, engine.id),
            voiceProfileId: preset.id,
            engineId: engine.id,
            adapterId: engine.adapterId,
            status: "ready",
            bindingKind: builtInBindingKindFor(preset, engine.id),
            settingsJson: builtInSettingsFor(preset, engine.id),
            compatibilityJson: builtInCompatibilityFor(preset, engine.id),
            updatedAt: now
          })
          .onConflictDoUpdate({
            target: [voiceEngineBindings.voiceProfileId, voiceEngineBindings.engineId],
            set: {
              adapterId: engine.adapterId,
              status: "ready",
              bindingKind: builtInBindingKindFor(preset, engine.id),
              settingsJson: builtInSettingsFor(preset, engine.id),
              compatibilityJson: builtInCompatibilityFor(preset, engine.id),
              updatedAt: now
            }
          })
      }
    }

    await disableStaleBuiltInBindings(this.db, now)
  }

  private async getProfile(id: string) {
    const voice = await this.db.query.voiceProfiles.findFirst({ where: eq(voiceProfiles.id, id) })
    if (!voice) {
      throw new AppError("voice_not_found", "Voice profile not found")
    }
    return voice
  }

  private async bindingsForVoice(voiceProfileId: string) {
    return this.db.query.voiceEngineBindings.findMany({
      where: eq(voiceEngineBindings.voiceProfileId, voiceProfileId)
    })
  }

  private async readyBinding(voiceProfileId: string, engineId: string) {
    const binding = await this.db.query.voiceEngineBindings.findFirst({
      where: and(
        eq(voiceEngineBindings.voiceProfileId, voiceProfileId),
        eq(voiceEngineBindings.engineId, engineId),
        eq(voiceEngineBindings.status, "ready")
      )
    })
    if (!binding) {
      throw new AppError("voice_engine_incompatible", "Voice is not compatible with this engine")
    }
    return binding
  }

  private async bindingById(id: string) {
    const binding = await this.db.query.voiceEngineBindings.findFirst({
      where: eq(voiceEngineBindings.id, id)
    })
    if (!binding) {
      throw new AppError("voice_binding_not_found", "Voice binding not found")
    }
    return binding
  }
}

function toVoiceProfile(row: typeof voiceProfiles.$inferSelect, bindings: Array<typeof voiceEngineBindings.$inferSelect>): VoiceProfile {
  return VoiceProfileSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    language: row.language,
    kind: row.kind,
    source: parseJsonObject(row.source),
    tags: row.tags,
    settings: {
      ...jsonObject(row.settingsJson),
      compatibleAdapterIds: unique(bindings.filter((binding) => binding.status === "ready").map((binding) => binding.adapterId)),
      compatibleEngineIds: unique(bindings.filter((binding) => binding.status === "ready").map((binding) => binding.engineId))
    },
    consentConfirmedAt: optionalDate(row.consentConfirmedAt),
    consentNote: row.consentNote || undefined,
    previewAssetId: row.previewAssetId || undefined,
    createdFromEngineId: row.createdFromEngineId || undefined,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  })
}

function toVoiceBinding(row: typeof voiceEngineBindings.$inferSelect): VoiceEngineBinding {
  return VoiceEngineBindingSchema.parse({
    id: row.id,
    voiceProfileId: row.voiceProfileId,
    engineId: row.engineId,
    adapterId: row.adapterId,
    status: row.status,
    bindingKind: row.bindingKind,
    bindingAssetId: row.bindingAssetId ?? undefined,
    settings: row.settingsJson,
    compatibility: row.compatibilityJson,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  })
}

function toVoiceSample(row: typeof voiceSamples.$inferSelect): VoiceSample {
  return VoiceSampleSchema.parse({
    id: row.id,
    voiceProfileId: row.voiceProfileId,
    assetId: row.assetId,
    transcript: row.transcript ?? undefined,
    language: row.language ?? undefined,
    durationMs: row.durationMs,
    quality: row.qualityJson,
    consentConfirmedAt: optionalDate(row.consentConfirmedAt),
    createdAt: toIso(row.createdAt)
  })
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    return jsonObject(parsed)
  } catch {
    return value ? { value } : {}
  }
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 96) || "voice"
}

async function disableStaleBuiltInBindings(db: AppDatabase, now: Date): Promise<void> {
  const allowed = new Set(
    builtInVoicePresets.flatMap((preset) => preset.engineIds.map((engineId) => `${preset.id}:${engineId}`))
  )
  const bindings = await db.query.voiceEngineBindings.findMany()
  for (const binding of bindings) {
    const compatibility = jsonObject(binding.compatibilityJson)
    if (compatibility.builtIn === true && !allowed.has(`${binding.voiceProfileId}:${binding.engineId}`)) {
      await db
        .update(voiceEngineBindings)
        .set({
          status: "disabled",
          updatedAt: now
        })
        .where(eq(voiceEngineBindings.id, binding.id))
    }
  }
}

function mimeTypeFor(extension: string): string {
  if (extension === ".mp3") return "audio/mpeg"
  if (extension === ".m4a") return "audio/mp4"
  if (extension === ".ogg") return "audio/ogg"
  if (extension === ".flac") return "audio/flac"
  return "audio/wav"
}

function estimateDurationMs(buffer: Buffer): number {
  if (buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WAVE") {
    const byteRate = buffer.readUInt32LE(28)
    const dataOffset = buffer.indexOf("data")
    if (byteRate > 0 && dataOffset >= 0 && dataOffset + 8 <= buffer.byteLength) {
      const dataSize = buffer.readUInt32LE(dataOffset + 4)
      return Math.max(1, Math.round((dataSize / byteRate) * 1000))
    }
  }
  return 1000
}

function optionalDate(value: Date | string | null | undefined): string | undefined {
  return value ? toIso(value) : undefined
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}
