import type { ProsodyEmotion, SegmentProsody, TtsSegment } from "@renderer/types"

// How a TTS engine consumes the canonical NarrationProsody:
// - "instruction": turns emotion + instructionPtBr into a natural-language steer
//   (Qwen3-TTS instruct/voice-design). Expressive narration lands fully.
// - "controls": maps emotion/intensity/pace into exposed synthesis controls
//   (Chatterbox exaggeration/CFG). Free-form instructions are not sent through.
// - "reference": ignores emotion/instruction; tone comes from the reference voice
//   (F5-TTS, and the Qwen "base" variants). Expressive only affects pauses.
export type ProsodyEngineSupport = "instruction" | "controls" | "reference"

// Only the instruct/voice-design Qwen model feeds `instruct` to the synthesizer.
// The 0.6B and 1.7B-base Qwen variants and F5 run reference-driven.
const INSTRUCTION_ENGINE_IDS = new Set<string>(["qwen3-tts-17b-mlx"])
const CONTROL_ENGINE_IDS = new Set<string>(["chatterbox-multilingual-mlx"])

export function prosodyEngineSupport(engineId: string | undefined): ProsodyEngineSupport {
  if (engineId && INSTRUCTION_ENGINE_IDS.has(engineId)) {
    return "instruction"
  }
  if (engineId && CONTROL_ENGINE_IDS.has(engineId)) {
    return "controls"
  }
  return "reference"
}

export const PROSODY_EMOTIONS: ProsodyEmotion[] = [
  "neutral",
  "warm",
  "tense",
  "sad",
  "joyful",
  "angry",
  "suspense",
  "formal"
]

// Tailwind classes per emotion chip, so the monitor isn't dominated by one color.
const EMOTION_CHIP_CLASSES: Record<ProsodyEmotion, string> = {
  neutral: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  warm: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  tense: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  sad: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  joyful: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  angry: "bg-red-500/15 text-red-700 dark:text-red-300",
  suspense: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  formal: "bg-teal-500/15 text-teal-700 dark:text-teal-300"
}

export function emotionChipClass(emotion: ProsodyEmotion): string {
  return EMOTION_CHIP_CLASSES[emotion] ?? EMOTION_CHIP_CLASSES.neutral
}

export function intensityPercent(intensity: number): number {
  if (!Number.isFinite(intensity)) {
    return 0
  }
  return Math.round(Math.min(Math.max(intensity, 0), 1) * 100)
}

export type ProsodySummaryCounts = {
  segments: number
  withInstruction: number
  emotionalSegments: number
}

// Pure rollup over a job's segments for the monitor header.
export function summarizeProsody(segments: TtsSegment[]): ProsodySummaryCounts {
  let withInstruction = 0
  let emotionalSegments = 0
  for (const segment of segments) {
    const prosody = segment.prosody
    if (!prosody) {
      continue
    }
    if (prosody.instructionPtBr.trim().length > 0) {
      withInstruction += 1
    }
    if (prosody.emotion !== "neutral") {
      emotionalSegments += 1
    }
  }
  return { segments: segments.length, withInstruction, emotionalSegments }
}

export function hasProsody(segment: TtsSegment): segment is TtsSegment & { prosody: SegmentProsody } {
  return Boolean(segment.prosody)
}
