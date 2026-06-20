import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { and, asc, eq, inArray } from "drizzle-orm"
import JSZip from "jszip"
import { z } from "zod"
import {
  VoiceEngineBindingSchema,
  VoiceProfileSchema,
  VoiceSampleSchema,
  type NarrationPlan,
  type VoiceCloneInput,
  type VoiceDesignPromptInput,
  type VoiceEngineBinding,
  type VoiceFilter,
  type VoiceProfile,
  type VoiceSample
} from "@shared/contracts/ai"
import type { AppDatabase } from "@main/db/client"
import { assets, runtimeManifests, ttsEngines, voiceEngineBindings, voiceProfiles, voiceSamples } from "@main/db/schema"
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
import { importSidecarAudio, SidecarTtsAdapter } from "@main/services/sidecar-tts-adapter"
import { neutralProsodyFor } from "@main/services/tts-pipeline"
import { buildPreviewPlan } from "@main/services/voice-preview"
import { probeAudio, resampleAudio, TARGET_SAMPLE_RATE } from "@main/lib/audio-transcode"

const QWEN_VOICE_DESIGN_ENGINE_ID = "qwen3-tts-17b-mlx"
const LOCAL_TTS_ENGINE_ID = "dreamreader-local-tts"
const VOICE_PACKAGE_SCHEMA_VERSION = "dreamreader-voice/v1"
const VOICE_PACKAGE_MANIFEST_PATH = "voice.json"

const VoicePackageManifestSchema = z.object({
  schemaVersion: z.literal(VOICE_PACKAGE_SCHEMA_VERSION),
  exportedAt: z.string().trim().optional(),
  voice: z.object({
    name: z.string().trim().min(1),
    description: z.string().trim().optional(),
    language: z.string().trim().min(1).default("pt-BR"),
    kind: z.string().trim().min(1).optional(),
    source: z.record(z.string(), z.unknown()).default({}),
    settings: z.record(z.string(), z.unknown()).default({}),
    tags: z.array(z.string().trim().min(1)).default([]),
    consentNote: z.string().trim().optional(),
    createdFromEngineId: z.string().trim().optional()
  }),
  reference: z
    .object({
      file: z.string().trim().min(1),
      fileName: z.string().trim().min(1).optional(),
      mimeType: z.string().trim().min(1).default("audio/wav"),
      transcript: z.string().trim().optional(),
      language: z.string().trim().optional(),
      durationMs: z.number().int().positive().optional(),
      contentHash: z.string().trim().optional(),
      sizeBytes: z.number().int().nonnegative().optional()
    })
    .optional(),
  designPrompt: z.string().trim().optional(),
  bindings: z
    .array(
      z.object({
        engineId: z.string().trim().min(1),
        adapterId: z.string().trim().min(1),
        bindingKind: z.string().trim().min(1),
        settings: z.record(z.string(), z.unknown()).default({}),
        compatibility: z.record(z.string(), z.unknown()).default({})
      })
    )
    .default([])
})

type VoicePackageManifest = z.infer<typeof VoicePackageManifestSchema>
type RuntimeManifestRow = typeof runtimeManifests.$inferSelect
type TtsEngineRow = typeof ttsEngines.$inferSelect

export class VoiceService {
  private readonly previewAdapter = new LocalTtsAdapter()
  private readonly sidecarAdapter = new SidecarTtsAdapter()
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
    // cloning (Qwen Base, Chatterbox and F5 use the same managed sample).
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
    if (!engine.installPath) {
      throw new AppError("tts_engine_not_configured", "TTS engine model is not installed")
    }
    const runtimeManifest = await this.db.query.runtimeManifests.findFirst({
      where: and(eq(runtimeManifests.adapterId, engine.adapterId), eq(runtimeManifests.runtime, engine.runtime))
    })
    if (!runtimeManifest?.executablePath) {
      throw new AppError("tts_sidecar_not_configured", "TTS engine sidecar runtime is not configured")
    }
    const engineCapabilities = jsonObject(engine.capabilitiesJson)
    if (input.referenceVoiceProfileId && engineCapabilities.supportsVoiceClone !== true) {
      throw new AppError("voice_design_reference_unsupported", "Selected voice design engine cannot use a reference voice")
    }
    const reference = input.referenceVoiceProfileId
      ? await this.referenceForDesignGeneration(input.referenceVoiceProfileId)
      : undefined
    const engines = await this.db.query.ttsEngines.findMany()
    const targetEngines = engines.filter((item) => {
      if (item.id === QWEN_VOICE_DESIGN_ENGINE_ID || !item.installed) {
        return false
      }
      return jsonObject(item.capabilitiesJson).supportsVoiceClone === true
    })
    if (!targetEngines.length) {
      throw new AppError("voice_design_no_target_engine", "No installed engine can use generated voice references")
    }

    const now = new Date()
    const profileId = createId("voice")
    const compatibleEngineIds = targetEngines.map((item) => item.id)
    const compatibleAdapterIds = unique(targetEngines.map((item) => item.adapterId))
    const designProfile = VoiceProfileSchema.parse({
      id: profileId,
      name: input.name,
      description: "",
      language: input.language,
      kind: "generated",
      source: {
        type: "voice_design_generated_reference",
        provider: "qwen3-tts",
        engineId: input.engineId
      },
      tags: [input.language, "voice-design", "gerada"],
      settings: {
        compatibleAdapterIds,
        compatibleEngineIds,
        generatedSampleText: input.sampleText,
        ...(input.referenceVoiceProfileId ? { referenceVoiceProfileId: input.referenceVoiceProfileId } : {}),
        voiceDesignPrompt: input.prompt
      },
      createdFromEngineId: input.engineId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
    const designBinding = VoiceEngineBindingSchema.parse({
      id: createId("voice_binding"),
      voiceProfileId: profileId,
      engineId: input.engineId,
      adapterId: engine.adapterId,
      status: "ready",
      bindingKind: "voice_design_prompt",
      settings: {
        source: "local-voice-design-generator",
        voiceDesignPrompt: input.prompt
      },
      compatibility: {
        engineVersion: engine.version,
        language: input.language
      },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
    const sample = await this.generateReferenceFromDesignPrompt({
      binding: designBinding,
      engine,
      now,
      profile: designProfile,
      reference,
      request: input,
      runtimeManifest
    })

    const [voice] = await this.db
      .insert(voiceProfiles)
      .values({
        id: profileId,
        name: input.name,
        description: "",
        language: input.language,
        kind: "generated",
        source: JSON.stringify({
          type: "voice_design_generated_reference",
          provider: "qwen3-tts",
          generatedSampleAssetId: sample.assetId
        }),
        tags: [input.language, "voice-design"],
        settingsJson: {
          compatibleAdapterIds,
          compatibleEngineIds,
          generatedSampleText: input.sampleText,
          ...(input.referenceVoiceProfileId ? { referenceVoiceProfileId: input.referenceVoiceProfileId } : {}),
          voiceDesignPrompt: input.prompt
        },
        createdFromEngineId: input.engineId,
        updatedAt: now
      })
      .returning()

    await this.db.insert(voiceSamples).values({
      id: sample.id,
      voiceProfileId: profileId,
      assetId: sample.assetId,
      transcript: input.sampleText,
      language: input.language,
      durationMs: sample.durationMs,
      qualityJson: sample.quality
    })

    for (const targetEngine of targetEngines) {
      await this.db.insert(voiceEngineBindings).values({
        id: createId("voice_binding"),
        voiceProfileId: profileId,
        engineId: targetEngine.id,
        adapterId: targetEngine.adapterId,
        status: "ready",
        bindingKind: "reference_audio",
        bindingAssetId: sample.assetId,
        settingsJson: {
          generatedByEngineId: input.engineId,
          ...(input.referenceVoiceProfileId ? { referenceVoiceProfileId: input.referenceVoiceProfileId } : {}),
          source: "voice-design-generated-reference",
          transcript: input.sampleText,
          voiceDesignPrompt: input.prompt
        },
        compatibilityJson: {
          generatedReference: true,
          language: input.language,
          engineVersion: targetEngine.version,
          sampleRate: TARGET_SAMPLE_RATE
        },
        updatedAt: now
      })
    }

    return toVoiceProfile(voice, await this.bindingsForVoice(profileId))
  }

  private async generateReferenceFromDesignPrompt(input: {
    binding: VoiceEngineBinding
    engine: TtsEngineRow
    now: Date
    profile: VoiceProfile
    reference?: { audioPath: string; text: string }
    request: VoiceDesignPromptInput
    runtimeManifest: RuntimeManifestRow
  }) {
    if (!input.engine.installPath || !input.runtimeManifest.executablePath) {
      throw new AppError("tts_sidecar_not_configured", "TTS engine sidecar runtime is not configured")
    }
    const outputDir = path.join(this.paths.voicesDir, input.profile.id, "voice-design-generation")
    await mkdir(outputDir, { recursive: true })
    const plan = buildVoiceDesignSamplePlan({
      engineId: input.engine.id,
      language: input.request.language,
      profileId: input.profile.id,
      sampleText: input.request.sampleText
    })
    const result = await this.sidecarAdapter.synthesize({
      adapterId: input.engine.adapterId,
      engineId: input.engine.id,
      jobId: `voice-design-${input.profile.id}`,
      modelPath: input.engine.installPath,
      outputDirectory: outputDir,
      generationLanguage: input.request.language,
      modelSettings: {},
      plan,
      quality: "standard",
      referenceAudioPath: input.reference?.audioPath,
      referenceText: input.reference?.text,
      runtimeManifest: {
        adapterId: input.runtimeManifest.adapterId,
        capabilitiesJson: input.runtimeManifest.capabilitiesJson,
        environmentJson: input.runtimeManifest.environmentJson,
        executablePath: input.runtimeManifest.executablePath,
        healthcheckCommand: input.runtimeManifest.healthcheckCommand,
        id: input.runtimeManifest.id,
        runtime: input.runtimeManifest.runtime,
        version: input.runtimeManifest.version
      },
      voiceBinding: input.binding,
      voiceProfile: input.profile,
      voiceSamples: []
    })
    const audio = await importSidecarAudio(result.chapter)
    return this.storeGeneratedReferenceSample({
      audioPath: audio.audioPath,
      durationMs: audio.durationMs,
      language: input.request.language,
      now: input.now,
      profileId: input.profile.id,
      prompt: input.request.prompt,
      referenceVoiceProfileId: input.request.referenceVoiceProfileId,
      sampleText: input.request.sampleText
    })
  }

  private async storeGeneratedReferenceSample(input: {
    audioPath: string
    durationMs: number
    language: string
    now: Date
    profileId: string
    prompt: string
    referenceVoiceProfileId?: string
    sampleText: string
  }) {
    const targetDir = path.join(this.paths.voicesDir, input.profileId)
    await mkdir(targetDir, { recursive: true })
    const sourceProbe = await probeAudio(input.audioPath)
    const convertedPath = path.join(targetDir, "generated-reference-22050.wav")
    const sourceIsTargetWav =
      sourceProbe.sampleRate === TARGET_SAMPLE_RATE && path.extname(input.audioPath).toLowerCase() === ".wav"
    if (sourceIsTargetWav) {
      await copyFile(input.audioPath, convertedPath)
    } else if (!(await resampleAudio(input.audioPath, convertedPath, TARGET_SAMPLE_RATE))) {
      throw new AppError("voice_design_resample_failed", "Generated voice sample could not be converted to 22 kHz")
    }

    const finalProbe = await probeAudio(convertedPath)
    if (finalProbe.sampleRate !== TARGET_SAMPLE_RATE) {
      throw new AppError("voice_design_resample_failed", "Generated voice sample was not converted to 22 kHz")
    }
    const buffer = await readFile(convertedPath)
    const contentHash = hashBuffer(buffer)
    const targetPath = path.join(targetDir, `reference-${contentHash.slice(0, 16)}.wav`)
    await rename(convertedPath, targetPath)
    const [asset] = await this.db
      .insert(assets)
      .values({
        id: createId("asset"),
        kind: "voice_sample",
        path: targetPath,
        mimeType: "audio/wav",
        contentHash,
        sizeBytes: buffer.byteLength,
        createdAt: input.now
      })
      .returning()
    return {
      id: createId("voice_sample"),
      assetId: asset.id,
      durationMs: finalProbe.durationMs ?? input.durationMs,
      quality: {
        converted: !sourceIsTargetWav,
        generatedBy: "qwen3-tts-voice-design",
        prompt: input.prompt,
        referenceVoiceProfileId: input.referenceVoiceProfileId ?? null,
        sampleRate: TARGET_SAMPLE_RATE,
        sampleTextBytes: Buffer.byteLength(input.sampleText, "utf8"),
        sourceSampleRate: sourceProbe.sampleRate ?? null
      }
    }
  }

  async preview(input: { voiceProfileId: string; engineId: string }) {
    await this.ensureReady()
    const voice = await this.getProfile(input.voiceProfileId)
    const binding = await this.readyBinding(input.voiceProfileId, input.engineId)
    const plan = buildPreviewPlan(input.voiceProfileId, input.engineId, voice.language)
    const previewDir = path.join(this.paths.voicesDir, input.voiceProfileId, `preview-${sanitizePathPart(input.engineId)}`)
    await mkdir(previewDir, { recursive: true })

    const asset =
      input.engineId === LOCAL_TTS_ENGINE_ID
        ? await this.previewWithLocalAdapter(plan, previewDir)
        : await this.previewWithSidecar(input.voiceProfileId, input.engineId, plan, previewDir, binding)

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

  private async previewWithLocalAdapter(plan: NarrationPlan, previewDir: string): Promise<typeof assets.$inferSelect> {
    const previewPath = path.join(previewDir, "preview.wav")
    await this.previewAdapter.warmup()
    const audio = this.previewAdapter.synthesizeChapter(plan)
    await writeFile(previewPath, audio.buffer)
    this.previewAdapter.scheduleDispose()
    return this.createVoicePreviewAsset({
      contentHash: audio.contentHash,
      mimeType: audio.mimeType,
      path: previewPath,
      sizeBytes: audio.buffer.byteLength
    })
  }

  private async previewWithSidecar(
    voiceProfileId: string,
    engineId: string,
    plan: NarrationPlan,
    previewDir: string,
    bindingRow: typeof voiceEngineBindings.$inferSelect
  ): Promise<typeof assets.$inferSelect> {
    const engine = await this.db.query.ttsEngines.findFirst({ where: eq(ttsEngines.id, engineId) })
    if (!engine?.installed || !engine.installPath) {
      throw new AppError("tts_engine_not_configured", "TTS engine model is not installed")
    }
    const runtimeManifest = await this.db.query.runtimeManifests.findFirst({
      where: and(eq(runtimeManifests.adapterId, engine.adapterId), eq(runtimeManifests.runtime, engine.runtime))
    })
    if (!runtimeManifest?.executablePath) {
      throw new AppError("tts_sidecar_not_configured", "TTS engine sidecar runtime is not configured")
    }

    const binding = toVoiceBinding(bindingRow)
    const profile = toVoiceProfile(await this.getProfile(voiceProfileId), await this.bindingsForVoice(voiceProfileId))
    const sampleRows = await this.db.query.voiceSamples.findMany({ where: eq(voiceSamples.voiceProfileId, voiceProfileId) })
    const reference = binding.bindingAssetId ? await this.referenceForBinding(binding.bindingAssetId, binding.settings) : undefined
    const result = await this.sidecarAdapter.synthesize({
      adapterId: engine.adapterId,
      engineId,
      jobId: `voice-preview-${voiceProfileId}-${engineId}`,
      modelPath: engine.installPath,
      outputDirectory: previewDir,
      modelSettings: {},
      plan,
      quality: "draft",
      referenceAudioPath: reference?.audioPath,
      referenceText: reference?.text,
      runtimeManifest: {
        adapterId: runtimeManifest.adapterId,
        capabilitiesJson: runtimeManifest.capabilitiesJson,
        environmentJson: runtimeManifest.environmentJson,
        executablePath: runtimeManifest.executablePath,
        healthcheckCommand: runtimeManifest.healthcheckCommand,
        id: runtimeManifest.id,
        runtime: runtimeManifest.runtime,
        version: runtimeManifest.version
      },
      voiceBinding: binding,
      voiceProfile: profile,
      voiceSamples: sampleRows.map(toVoiceSample)
    })
    const audio = await importSidecarAudio(result.chapter)
    return this.createVoicePreviewAsset({
      contentHash: audio.contentHash,
      mimeType: audio.mimeType,
      path: audio.audioPath,
      sizeBytes: audio.sizeBytes
    })
  }

  private async createVoicePreviewAsset(input: {
    contentHash: string
    mimeType: string
    path: string
    sizeBytes: number
  }): Promise<typeof assets.$inferSelect> {
    const [asset] = await this.db
      .insert(assets)
      .values({
        id: createId("asset"),
        kind: "voice_preview",
        path: input.path,
        mimeType: input.mimeType,
        contentHash: input.contentHash,
        sizeBytes: input.sizeBytes
      })
      .returning()
    return asset
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

  async exportFileName(voiceProfileId: string): Promise<string> {
    await this.ensureReady()
    const voice = await this.getProfile(voiceProfileId)
    if (voice.kind === "built_in") {
      throw new AppError("voice_export_readonly", "Built-in voices cannot be exported")
    }
    return `${sanitizePathPart(voice.name)}.zip`
  }

  async exportVoice(input: { voiceProfileId: string; targetPath: string }) {
    await this.ensureReady()
    const voice = await this.getProfile(input.voiceProfileId)
    if (voice.kind === "built_in") {
      throw new AppError("voice_export_readonly", "Built-in voices cannot be exported")
    }

    const bindings = await this.bindingsForVoice(input.voiceProfileId)
    const sampleRows = await this.db.query.voiceSamples.findMany({ where: eq(voiceSamples.voiceProfileId, input.voiceProfileId) })
    const sample = sampleRows[0]
    const sampleAsset = sample?.assetId
      ? await this.db.query.assets.findFirst({ where: eq(assets.id, sample.assetId) })
      : undefined
    const zip = new JSZip()
    const manifest: VoicePackageManifest = {
      schemaVersion: VOICE_PACKAGE_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      voice: {
        name: voice.name,
        description: voice.description || undefined,
        language: voice.language,
        kind: voice.kind,
        source: parseJsonObject(voice.source),
        settings: jsonObject(voice.settingsJson),
        tags: voice.tags,
        consentNote: voice.consentNote || undefined,
        createdFromEngineId: voice.createdFromEngineId ?? undefined
      },
      designPrompt: designPromptFor(voice, bindings),
      bindings: bindings.map((binding) => ({
        engineId: binding.engineId,
        adapterId: binding.adapterId,
        bindingKind: binding.bindingKind,
        settings: jsonObject(binding.settingsJson),
        compatibility: jsonObject(binding.compatibilityJson)
      }))
    }

    if (sample && sampleAsset) {
      const buffer = await readFile(sampleAsset.path)
      const fileName = safeFileName(path.basename(sampleAsset.path)) || `reference${extensionForMime(sampleAsset.mimeType)}`
      const zipPath = `reference/${fileName}`
      zip.file(zipPath, buffer)
      manifest.reference = {
        file: zipPath,
        fileName,
        mimeType: sampleAsset.mimeType,
        transcript: sample.transcript ?? undefined,
        language: sample.language ?? voice.language,
        durationMs: sample.durationMs,
        contentHash: sampleAsset.contentHash,
        sizeBytes: sampleAsset.sizeBytes
      }
    }

    zip.file(VOICE_PACKAGE_MANIFEST_PATH, JSON.stringify(manifest, null, 2))
    await mkdir(path.dirname(input.targetPath), { recursive: true })
    await writeFile(input.targetPath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }))
    return { exported: true as const, path: input.targetPath }
  }

  async importVoices(input: { archivePaths: string[] }): Promise<VoiceProfile[]> {
    await this.ensureReady()
    const imported: VoiceProfile[] = []
    for (const archivePath of input.archivePaths) {
      imported.push(await this.importVoiceArchive(archivePath))
    }
    return imported
  }

  private async importVoiceArchive(archivePath: string): Promise<VoiceProfile> {
    const zip = await JSZip.loadAsync(await readFile(archivePath))
    const manifestFile = zip.file(VOICE_PACKAGE_MANIFEST_PATH)
    if (!manifestFile) {
      throw new AppError("voice_import_invalid", "Voice package is missing voice.json")
    }
    const manifest = VoicePackageManifestSchema.parse(JSON.parse(await manifestFile.async("string")))
    const now = new Date()
    const profileId = createId("voice")
    const engines = await this.db.query.ttsEngines.findMany()
    const cloneEngines = manifest.reference
      ? engines.filter((engine) => engine.installed && jsonObject(engine.capabilitiesJson).supportsVoiceClone === true)
      : []
    const designEngine = manifest.designPrompt
      ? engines.find((engine) => engine.id === QWEN_VOICE_DESIGN_ENGINE_ID && engine.installed)
      : undefined
    const compatibleEngineIds = unique([
      ...cloneEngines.map((engine) => engine.id),
      ...(designEngine ? [designEngine.id] : [])
    ])
    const compatibleAdapterIds = unique([
      ...cloneEngines.map((engine) => engine.adapterId),
      ...(designEngine ? [designEngine.adapterId] : [])
    ])
    let importedReference:
      | {
          buffer: Buffer
          contentHash: string
          extension: string
          transcript: string
        }
      | undefined
    if (manifest.reference) {
      const transcript = manifest.reference.transcript?.trim()
      if (!transcript) {
        throw new AppError("voice_import_transcript_required", "Imported reference voices require reference text")
      }
      const referenceBuffer = await readZipFile(zip, manifest.reference.file)
      const contentHash = hashBuffer(referenceBuffer)
      if (manifest.reference.contentHash && manifest.reference.contentHash !== contentHash) {
        throw new AppError("voice_import_hash_mismatch", "Imported voice reference audio does not match the package manifest")
      }
      importedReference = {
        buffer: referenceBuffer,
        contentHash,
        extension: extensionForReference(manifest.reference),
        transcript
      }
    }

    const [voice] = await this.db
      .insert(voiceProfiles)
      .values({
        id: profileId,
        name: manifest.voice.name,
        description: manifest.voice.description ?? "",
        language: manifest.voice.language,
        kind: "imported",
        source: JSON.stringify({
          type: "imported_voice_package",
          importedAt: now.toISOString(),
          originalKind: manifest.voice.kind ?? "imported",
          originalSource: manifest.voice.source
        }),
        tags: unique([...manifest.voice.tags, manifest.voice.language, "importada"]),
        settingsJson: {
          ...manifest.voice.settings,
          ...(manifest.designPrompt ? { voiceDesignPrompt: manifest.designPrompt } : {}),
          compatibleAdapterIds,
          compatibleEngineIds,
          importedFromPackage: true
        },
        consentConfirmedAt: manifest.reference ? now : undefined,
        consentNote: manifest.voice.consentNote ?? "",
        createdFromEngineId: designEngine?.id,
        updatedAt: now
      })
      .returning()

    let sampleAssetId: string | undefined
    if (manifest.reference && importedReference) {
      const targetDir = path.join(this.paths.voicesDir, profileId)
      await mkdir(targetDir, { recursive: true })
      const targetPath = path.join(targetDir, `reference-${importedReference.contentHash.slice(0, 16)}${importedReference.extension}`)
      await writeFile(targetPath, importedReference.buffer)
      const probe = await probeAudio(targetPath).catch(() => undefined)
      const durationMs = manifest.reference.durationMs ?? probe?.durationMs ?? estimateDurationMs(importedReference.buffer)
      const [asset] = await this.db
        .insert(assets)
        .values({
          id: createId("asset"),
          kind: "voice_sample",
          path: targetPath,
          mimeType: manifest.reference.mimeType,
          contentHash: importedReference.contentHash,
          sizeBytes: importedReference.buffer.byteLength,
          createdAt: now
        })
        .returning()
      sampleAssetId = asset.id
      await this.db.insert(voiceSamples).values({
        id: createId("voice_sample"),
        voiceProfileId: profileId,
        assetId: asset.id,
        transcript: importedReference.transcript,
        language: manifest.reference.language ?? manifest.voice.language,
        durationMs,
        qualityJson: {
          importedFromPackage: true,
          originalFileName: manifest.reference.fileName ?? path.basename(manifest.reference.file),
          sampleRate: probe?.sampleRate ?? null
        },
        consentConfirmedAt: now
      })
    }

    if (sampleAssetId && manifest.reference) {
      for (const engine of cloneEngines) {
        await this.db.insert(voiceEngineBindings).values({
          id: createId("voice_binding"),
          voiceProfileId: profileId,
          engineId: engine.id,
          adapterId: engine.adapterId,
          status: "ready",
          bindingKind: "reference_audio",
          bindingAssetId: sampleAssetId,
          settingsJson: {
            transcript: manifest.reference.transcript ?? "",
            source: "imported-voice-package"
          },
          compatibilityJson: {
            language: manifest.voice.language,
            engineVersion: engine.version,
            importedFromPackage: true
          },
          updatedAt: now
        })
      }
    }

    if (designEngine && manifest.designPrompt) {
      await this.db.insert(voiceEngineBindings).values({
        id: createId("voice_binding"),
        voiceProfileId: profileId,
        engineId: designEngine.id,
        adapterId: designEngine.adapterId,
        status: "ready",
        bindingKind: "voice_design_prompt",
        settingsJson: {
          voiceDesignPrompt: manifest.designPrompt,
          source: "imported-voice-package"
        },
        compatibilityJson: {
          language: manifest.voice.language,
          engineVersion: designEngine.version,
          importedFromPackage: true
        },
        updatedAt: now
      })
    }

    return toVoiceProfile(voice, await this.bindingsForVoice(profileId))
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

  private async referenceForBinding(bindingAssetId: string, settings: Record<string, unknown>) {
    const asset = await this.db.query.assets.findFirst({ where: eq(assets.id, bindingAssetId) })
    if (!asset) {
      throw new AppError("voice_reference_missing", "Voice reference audio asset was not found")
    }
    return {
      audioPath: asset.path,
      text: typeof settings.transcript === "string" ? settings.transcript : undefined
    }
  }

  private async referenceForDesignGeneration(voiceProfileId: string) {
    const sample = await this.db.query.voiceSamples.findFirst({ where: eq(voiceSamples.voiceProfileId, voiceProfileId) })
    if (!sample) {
      throw new AppError("voice_reference_missing", "Selected reference voice has no sample audio")
    }
    const transcript = sample.transcript?.trim()
    if (!transcript) {
      throw new AppError("voice_transcript_required", "Selected reference voice requires a transcript")
    }
    const asset = await this.db.query.assets.findFirst({ where: eq(assets.id, sample.assetId) })
    if (!asset) {
      throw new AppError("voice_reference_missing", "Selected reference voice sample asset was not found")
    }
    return {
      audioPath: asset.path,
      text: transcript
    }
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

function buildVoiceDesignSamplePlan(input: {
  engineId: string
  language: string
  profileId: string
  sampleText: string
}): NarrationPlan {
  const contentHash = hashBuffer(`${input.profileId}:${input.engineId}:${input.language}:${input.sampleText}`)
  return {
    schemaVersion: "narration-plan/v1",
    source: {
      bookId: "voice-design",
      chapterHref: input.profileId,
      contentHash,
      language: input.language
    },
    normalization: {
      normalizerId: "voice-design-sample",
      version: "1.0.0",
      dictionaryVersion: "voice-design"
    },
    prosody: {
      analyzerId: "voice-design-sample",
      version: "1.0.0"
    },
    segments: [
      {
        segmentId: `voice-design:${contentHash.slice(0, 12)}`,
        locator: {
          href: "voice-design",
          locations: {
            progression: 0,
            segmentIndex: 0
          }
        },
        originalText: input.sampleText,
        normalizedText: input.sampleText,
        voiceRole: "narrator",
        prosody: {
          ...neutralProsodyFor(input.sampleText),
          instructionPtBr: ""
        }
      }
    ]
  }
}

function designPromptFor(
  voice: typeof voiceProfiles.$inferSelect,
  bindings: Array<typeof voiceEngineBindings.$inferSelect>
): string | undefined {
  const profilePrompt = jsonObject(voice.settingsJson).voiceDesignPrompt
  if (typeof profilePrompt === "string" && profilePrompt.trim()) {
    return profilePrompt.trim()
  }
  for (const binding of bindings) {
    const bindingPrompt = jsonObject(binding.settingsJson).voiceDesignPrompt
    if (typeof bindingPrompt === "string" && bindingPrompt.trim()) {
      return bindingPrompt.trim()
    }
  }
  return undefined
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 96) || "voice"
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9._ -]+/gi, "_").replace(/^\.+/, "").slice(0, 120)
}

async function readZipFile(zip: JSZip, filePath: string): Promise<Buffer> {
  if (!isSafeZipPath(filePath)) {
    throw new AppError("voice_import_invalid_path", "Voice package contains an unsafe reference path")
  }
  const file = zip.file(filePath)
  if (!file) {
    throw new AppError("voice_import_missing_audio", "Voice package is missing reference audio")
  }
  return file.async("nodebuffer")
}

function isSafeZipPath(filePath: string): boolean {
  if (!filePath || path.isAbsolute(filePath) || filePath.includes("\0")) {
    return false
  }
  return !filePath.split(/[\\/]/).some((part) => part === ".." || part === "")
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

function extensionForReference(reference: NonNullable<VoicePackageManifest["reference"]>): string {
  const fromName = path.extname(reference.fileName ?? reference.file).toLowerCase()
  return sanitizeExtension(fromName || extensionForMime(reference.mimeType))
}

function extensionForMime(mimeType: string): string {
  if (mimeType === "audio/mpeg") return ".mp3"
  if (mimeType === "audio/mp4") return ".m4a"
  if (mimeType === "audio/ogg") return ".ogg"
  if (mimeType === "audio/flac") return ".flac"
  return ".wav"
}

function sanitizeExtension(extension: string): string {
  return /^\.[a-z0-9]{1,8}$/i.test(extension) ? extension : ".wav"
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
