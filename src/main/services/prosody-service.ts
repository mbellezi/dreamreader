import { and, eq } from "drizzle-orm"
import { z } from "zod"
import {
  NarrationPlanSchema,
  NarrationProsodySchema,
  ProsodyEmotionSchema,
  ProsodyPaceSchema,
  ProsodyPitchSchema,
  VoiceRoleSchema,
  type NarrationPlan,
  type NarrationProsody,
  type NarrationSegment,
  type VoiceRole
} from "@shared/contracts/ai"
import type { AppDatabase } from "@main/db/client"
import { prosodyAnalyses } from "@main/db/schema"
import { hashBuffer } from "@main/lib/hash"
import { createId } from "@main/lib/ids"
import { neutralProsodyFor, voiceRoleFor } from "@main/services/tts-pipeline"

export const LLM_PROSODY_ANALYZER_ID = "llm-prosody-local"
export const LLM_PROSODY_VERSION = "1.0.0"
export const LLM_PROSODY_PROMPT_VERSION = "prosody-json-v1"

const LlmProsodySegmentSchema = z.object({
  segmentId: z.string().trim().min(1),
  emotion: ProsodyEmotionSchema,
  intensity: z.number().min(0).max(1),
  pace: ProsodyPaceSchema,
  pitch: ProsodyPitchSchema,
  pauseBeforeMs: z.number().int().min(0).max(1500).optional(),
  pauseAfterMs: z.number().int().min(0).max(1500),
  instructionPtBr: z.string().trim().max(240),
  voiceRole: VoiceRoleSchema.optional()
})

const LlmProsodyResponseSchema = z.object({
  segments: z.array(LlmProsodySegmentSchema)
})

export type ProsodyPlanResult = {
  analyzerId: string
  cacheHits: number
  fallbackCount: number
  generatedCount: number
  plan: NarrationPlan
  promptVersion?: string
}

export type ProsodyAnalyzer = {
  id: string
  promptVersion: string
  version: string
  analyze(segments: NarrationSegment[]): Promise<unknown>
}

type ProsodyCacheStatus = "completed" | "fallback"

export class ProsodyService {
  constructor(
    private readonly db: AppDatabase,
    private readonly analyzer: ProsodyAnalyzer = new LocalLlmProsodyAnalyzer()
  ) {}

  async applyProsody(plan: NarrationPlan, expressive: boolean): Promise<ProsodyPlanResult> {
    if (!expressive) {
      return {
        analyzerId: "neutral-rule-prosody",
        cacheHits: 0,
        fallbackCount: 0,
        generatedCount: 0,
        plan: NarrationPlanSchema.parse({
          ...plan,
          prosody: {
            analyzerId: "neutral-rule-prosody",
            version: "1.0.0"
          }
        })
      }
    }

    const cachedSegments = new Map<string, { prosody: NarrationProsody; status: ProsodyCacheStatus; voiceRole?: VoiceRole }>()
    const missing: NarrationSegment[] = []
    let cacheHits = 0

    for (const segment of plan.segments) {
      const cached = await this.getCachedProsody(plan, segment)
      if (cached) {
        cacheHits += 1
        cachedSegments.set(segment.segmentId, cached)
      } else {
        missing.push(segment)
      }
    }

    let generatedCount = 0
    let fallbackCount = [...cachedSegments.values()].filter((item) => item.status === "fallback").length
    if (missing.length) {
      try {
        const response = LlmProsodyResponseSchema.parse(await this.analyzer.analyze(missing))
        const outputBySegmentId = new Map(response.segments.map((segment) => [segment.segmentId, segment]))

        for (const segment of missing) {
          const output = outputBySegmentId.get(segment.segmentId)
          if (!output) {
            const fallback = await this.cacheFallback(plan, segment, "missing_llm_segment")
            cachedSegments.set(segment.segmentId, fallback)
            fallbackCount += 1
            continue
          }

          const prosody = NarrationProsodySchema.parse({
            emotion: output.emotion,
            intensity: output.intensity,
            pace: output.pace,
            pitch: output.pitch,
            pauseBeforeMs: output.pauseBeforeMs ?? segment.prosody.pauseBeforeMs,
            pauseAfterMs: output.pauseAfterMs,
            instructionPtBr: output.instructionPtBr
          })
          const voiceRole = output.voiceRole ?? segment.voiceRole ?? voiceRoleFor(segment.originalText)
          await this.cacheProsody(plan, segment, prosody, "completed", { segment: output }, voiceRole)
          cachedSegments.set(segment.segmentId, { prosody, status: "completed", voiceRole })
          generatedCount += 1
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message.slice(0, 200) : "llm_output_invalid"
        for (const segment of missing) {
          const fallback = await this.cacheFallback(plan, segment, reason)
          cachedSegments.set(segment.segmentId, fallback)
          fallbackCount += 1
        }
      }
    }

    const nextPlan = NarrationPlanSchema.parse({
      ...plan,
      prosody: {
        analyzerId: this.analyzer.id,
        version: this.analyzer.version,
        promptVersion: this.analyzer.promptVersion
      },
      segments: plan.segments.map((segment) => {
        const analyzed = cachedSegments.get(segment.segmentId)
        return analyzed
          ? {
              ...segment,
              voiceRole: analyzed.voiceRole ?? segment.voiceRole,
              prosody: analyzed.prosody
            }
          : segment
      })
    })

    return {
      analyzerId: this.analyzer.id,
      cacheHits,
      fallbackCount,
      generatedCount,
      plan: nextPlan,
      promptVersion: this.analyzer.promptVersion
    }
  }

  private async getCachedProsody(plan: NarrationPlan, segment: NarrationSegment) {
    const segmentHash = prosodySegmentHash(plan, segment)
    const cached = await this.db.query.prosodyAnalyses.findFirst({
      where: and(
        eq(prosodyAnalyses.segmentHash, segmentHash),
        eq(prosodyAnalyses.analyzerId, this.analyzer.id),
        eq(prosodyAnalyses.analyzerVersion, this.analyzer.version),
        eq(prosodyAnalyses.promptVersion, this.analyzer.promptVersion)
      )
    })
    if (!cached) {
      return undefined
    }

    const prosody = NarrationProsodySchema.safeParse(cached.prosodyJson)
    const voiceRole = cached.voiceRole ? VoiceRoleSchema.safeParse(cached.voiceRole) : undefined
    if (!prosody.success || (voiceRole && !voiceRole.success)) {
      return undefined
    }

    return {
      prosody: prosody.data,
      status: cached.status === "fallback" ? "fallback" : "completed",
      voiceRole: voiceRole?.success ? voiceRole.data : undefined
    } satisfies { prosody: NarrationProsody; status: ProsodyCacheStatus; voiceRole?: VoiceRole }
  }

  private async cacheFallback(plan: NarrationPlan, segment: NarrationSegment, fallbackReason: string) {
    const prosody = neutralProsodyFor(segment.originalText)
    const voiceRole = segment.voiceRole ?? voiceRoleFor(segment.originalText)
    await this.cacheProsody(
      plan,
      segment,
      prosody,
      "fallback",
      {
        fallbackReason,
        mode: "neutral"
      },
      voiceRole,
      fallbackReason
    )
    return { prosody, status: "fallback" as const, voiceRole }
  }

  private async cacheProsody(
    plan: NarrationPlan,
    segment: NarrationSegment,
    prosody: NarrationProsody,
    status: ProsodyCacheStatus,
    rawResponse: Record<string, unknown>,
    voiceRole?: VoiceRole,
    fallbackReason?: string
  ): Promise<void> {
    const segmentHash = prosodySegmentHash(plan, segment)
    await this.db
      .insert(prosodyAnalyses)
      .values({
        id: createId("prosody"),
        bookId: plan.source.bookId,
        chapterHref: plan.source.chapterHref,
        segmentId: segment.segmentId,
        segmentHash,
        analyzerId: this.analyzer.id,
        analyzerVersion: this.analyzer.version,
        promptVersion: this.analyzer.promptVersion,
        status,
        voiceRole,
        prosodyJson: prosody,
        rawResponseJson: rawResponse,
        fallbackReason
      })
      .onConflictDoUpdate({
        target: [
          prosodyAnalyses.segmentHash,
          prosodyAnalyses.analyzerId,
          prosodyAnalyses.analyzerVersion,
          prosodyAnalyses.promptVersion
        ],
        set: {
          status,
          voiceRole,
          prosodyJson: prosody,
          rawResponseJson: rawResponse,
          fallbackReason,
          updatedAt: new Date()
        }
      })
  }
}

export class LocalLlmProsodyAnalyzer implements ProsodyAnalyzer {
  readonly id = LLM_PROSODY_ANALYZER_ID
  readonly promptVersion = LLM_PROSODY_PROMPT_VERSION
  readonly version = LLM_PROSODY_VERSION

  async analyze(segments: NarrationSegment[]): Promise<unknown> {
    return {
      segments: segments.map((segment) => analyzeSegmentLikeLocalLlm(segment))
    }
  }
}

export function prosodySegmentHash(plan: NarrationPlan, segment: NarrationSegment): string {
  return hashBuffer(
    [
      plan.source.bookId,
      plan.source.chapterHref,
      plan.source.contentHash,
      plan.normalization.normalizerId,
      plan.normalization.version,
      plan.normalization.dictionaryVersion,
      segment.segmentId,
      segment.normalizedText
    ].join("\n")
  )
}

function analyzeSegmentLikeLocalLlm(segment: NarrationSegment): z.infer<typeof LlmProsodySegmentSchema> {
  const text = segment.normalizedText.toLocaleLowerCase("pt-BR")
  const baseRole = segment.voiceRole ?? voiceRoleFor(segment.originalText)

  if (baseRole === "heading") {
    return segmentResult(segment, "formal", 0.18, "slow", "neutral", 520, "Leitura clara de título, com pausa breve antes do texto.", baseRole)
  }
  if (text.includes("morte") || text.includes("sombra") || text.includes("silêncio") || text.includes("medo")) {
    return segmentResult(segment, "suspense", 0.42, "slow", "low", 620, "Tom contido e suspenso, preservando clareza.", baseRole)
  }
  if (text.includes("chorou") || text.includes("triste") || text.includes("saudade")) {
    return segmentResult(segment, "sad", 0.38, "slow", "low", 560, "Tom baixo e delicado, sem dramatização excessiva.", baseRole)
  }
  if (text.includes("riu") || text.includes("alegria") || text.includes("feliz")) {
    return segmentResult(segment, "joyful", 0.34, "normal", "high", 420, "Tom levemente alegre, mantendo naturalidade.", baseRole)
  }
  if (text.includes("gritou") || text.endsWith("!")) {
    return segmentResult(segment, "tense", 0.45, "fast", "high", 500, "Energia controlada, com tensão sem exagero.", baseRole)
  }
  if (segment.originalText.trim().endsWith("?")) {
    return segmentResult(segment, "warm", 0.28, "normal", "neutral", 440, "Tom atento, com leve inflexão interrogativa.", baseRole)
  }
  if (baseRole === "dialogue") {
    return segmentResult(segment, "warm", 0.3, "normal", "neutral", 380, "Diálogo natural, próximo e bem articulado.", baseRole)
  }
  return segmentResult(segment, "neutral", 0.22, "normal", "neutral", segment.prosody.pauseAfterMs, "Narração limpa e equilibrada, com expressão discreta.", baseRole)
}

function segmentResult(
  segment: NarrationSegment,
  emotion: z.infer<typeof ProsodyEmotionSchema>,
  intensity: number,
  pace: z.infer<typeof ProsodyPaceSchema>,
  pitch: z.infer<typeof ProsodyPitchSchema>,
  pauseAfterMs: number,
  instructionPtBr: string,
  voiceRole: VoiceRole
): z.infer<typeof LlmProsodySegmentSchema> {
  return {
    segmentId: segment.segmentId,
    emotion,
    intensity,
    pace,
    pitch,
    pauseBeforeMs: segment.prosody.pauseBeforeMs,
    pauseAfterMs,
    instructionPtBr,
    voiceRole
  }
}
