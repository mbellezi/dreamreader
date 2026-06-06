import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import {
  NarrationPlanSchema,
  VoiceEngineBindingSchema,
  VoiceProfileSchema,
  VoiceSampleSchema,
  type NarrationPlan,
  type VoiceEngineBinding,
  type VoiceProfile,
  type VoiceSample
} from "@shared/contracts/ai"
import { AppError } from "@main/lib/errors"
import { hashBuffer } from "@main/lib/hash"

const SidecarSegmentResultSchema = z.object({
  segmentId: z.string().trim().min(1),
  segmentIndex: z.number().int().min(0).optional(),
  audioPath: z.string().trim().min(1),
  mimeType: z.string().trim().min(1).default("audio/wav"),
  durationMs: z.number().int().positive(),
  contentHash: z.string().trim().optional()
})

const SidecarChapterResultSchema = z.object({
  audioPath: z.string().trim().min(1),
  mimeType: z.string().trim().min(1).default("audio/wav"),
  durationMs: z.number().int().positive(),
  contentHash: z.string().trim().optional()
})

const SidecarSynthesisResultSchema = z.object({
  schemaVersion: z.literal("dreamreader-tts-sidecar-result/v1").default("dreamreader-tts-sidecar-result/v1"),
  segments: z.array(SidecarSegmentResultSchema).default([]),
  chapter: SidecarChapterResultSchema,
  logs: z
    .array(
      z.object({
        level: z.enum(["debug", "info", "warn", "error"]).default("info"),
        code: z.string().trim().min(1),
        details: z.record(z.string(), z.unknown()).default({})
      })
    )
    .default([]),
  unsupportedProsodyFields: z.array(z.string().trim().min(1)).default([])
})

export type SidecarSynthesisResult = z.infer<typeof SidecarSynthesisResultSchema>

export type SidecarRuntimeManifest = {
  adapterId: string
  capabilitiesJson: Record<string, unknown>
  environmentJson: Record<string, unknown>
  executablePath: string | null
  healthcheckCommand: string | null
  id: string
  runtime: string
  version: string
}

export type SidecarSynthesisInput = {
  adapterId: string
  engineId: string
  jobId: string
  modelPath: string
  outputDirectory: string
  plan: NarrationPlan
  quality: "draft" | "standard" | "high"
  runtimeManifest: SidecarRuntimeManifest
  voiceBinding?: VoiceEngineBinding
  voiceProfile?: VoiceProfile
  voiceSamples: VoiceSample[]
}

export type ImportedSidecarAudio = {
  audioPath: string
  contentHash: string
  durationMs: number
  mimeType: string
  sizeBytes: number
}

export class SidecarTtsAdapter {
  async synthesize(input: SidecarSynthesisInput): Promise<SidecarSynthesisResult> {
    const executablePath = input.runtimeManifest.executablePath
    if (!executablePath) {
      throw new AppError("tts_sidecar_not_configured", "TTS engine sidecar runtime is not configured")
    }

    const request = {
      schemaVersion: "dreamreader-tts-sidecar/v1",
      adapterId: input.adapterId,
      engineId: input.engineId,
      jobId: input.jobId,
      modelPath: input.modelPath,
      outputDirectory: input.outputDirectory,
      plan: NarrationPlanSchema.parse(input.plan),
      quality: input.quality,
      voiceProfile: input.voiceProfile ? VoiceProfileSchema.parse(input.voiceProfile) : undefined,
      voiceBinding: input.voiceBinding ? VoiceEngineBindingSchema.parse(input.voiceBinding) : undefined,
      voiceSamples: input.voiceSamples.map((sample) => VoiceSampleSchema.parse(sample))
    }

    const raw = await runSidecarProcess({
      environment: input.runtimeManifest.environmentJson,
      executablePath,
      request,
      timeoutMs: timeoutMsFor(input.runtimeManifest.environmentJson)
    })
    const parsed = SidecarSynthesisResultSchema.parse(raw)
    assertOutputPath(input.outputDirectory, parsed.chapter.audioPath)
    parsed.segments.forEach((segment) => assertOutputPath(input.outputDirectory, segment.audioPath))
    return parsed
  }
}

export async function importSidecarAudio(item: {
  audioPath: string
  contentHash?: string
  durationMs: number
  mimeType: string
}): Promise<ImportedSidecarAudio> {
  const buffer = await readFile(item.audioPath)
  return {
    audioPath: item.audioPath,
    contentHash: item.contentHash || hashBuffer(buffer),
    durationMs: item.durationMs,
    mimeType: item.mimeType,
    sizeBytes: buffer.byteLength
  }
}

function runSidecarProcess(input: {
  environment: Record<string, unknown>
  executablePath: string
  request: Record<string, unknown>
  timeoutMs: number
}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const args = getStringArray(input.environment.args)
    const env = {
      ...process.env,
      ...stringRecord(input.environment.env)
    }
    const child = spawn(input.executablePath, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"]
    })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGTERM")
      reject(new AppError("tts_sidecar_timeout", "TTS sidecar timed out"))
    }, input.timeoutMs)
    timer.unref?.()

    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new AppError("tts_sidecar_failed", stderr.trim() || `TTS sidecar exited with code ${code}`))
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch {
        reject(new AppError("tts_sidecar_invalid_response", "TTS sidecar returned invalid JSON"))
      }
    })
    child.stdin.end(`${JSON.stringify(input.request)}\n`)
  })
}

function assertOutputPath(outputDirectory: string, candidatePath: string): void {
  const root = path.resolve(outputDirectory)
  const candidate = path.resolve(candidatePath)
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new AppError("tts_sidecar_unsafe_output", "TTS sidecar returned an output path outside the job directory")
  }
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  )
}

function timeoutMsFor(environment: Record<string, unknown>): number {
  const timeout = Number(environment.timeoutMs ?? 30 * 60 * 1000)
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 30 * 60 * 1000
}
