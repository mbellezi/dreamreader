import { describe, expect, it } from "vitest"
import { intensityPercent, prosodyEngineSupport, summarizeProsody } from "../../src/renderer/lib/prosody"
import type { SegmentProsody, TtsSegment } from "../../src/renderer/types"

function prosody(overrides: Partial<SegmentProsody> = {}): SegmentProsody {
  return {
    emotion: "neutral",
    intensity: 0.2,
    pace: "normal",
    pitch: "neutral",
    pauseBeforeMs: 0,
    pauseAfterMs: 350,
    instructionPtBr: "",
    ...overrides
  }
}

function segment(overrides: Partial<TtsSegment> = {}): TtsSegment {
  return {
    id: "seg-1",
    jobId: "job-1",
    segmentIndex: 0,
    status: "completed",
    text: "texto",
    textPreview: "texto",
    ...overrides
  }
}

describe("prosodyEngineSupport", () => {
  it("treats Qwen VoiceDesign as reference-driven because it is generation-only", () => {
    expect(prosodyEngineSupport("qwen3-tts-17b-mlx")).toBe("reference")
  })

  it("classifies F5 and Qwen base variants as reference-driven", () => {
    expect(prosodyEngineSupport("f5-tts-pt-br")).toBe("reference")
    expect(prosodyEngineSupport("qwen3-tts-06b-mlx")).toBe("reference")
    expect(prosodyEngineSupport("qwen3-tts-17b-base-mlx")).toBe("reference")
  })

  it("classifies Chatterbox as parameter-control driven", () => {
    expect(prosodyEngineSupport("chatterbox-multilingual-mlx")).toBe("controls")
  })

  it("treats unknown/undefined engines as reference-driven", () => {
    expect(prosodyEngineSupport(undefined)).toBe("reference")
    expect(prosodyEngineSupport("something-else")).toBe("reference")
  })
})

describe("intensityPercent", () => {
  it("converts the 0..1 range to a clamped percentage", () => {
    expect(intensityPercent(0.42)).toBe(42)
    expect(intensityPercent(-1)).toBe(0)
    expect(intensityPercent(5)).toBe(100)
    expect(intensityPercent(Number.NaN)).toBe(0)
  })
})

describe("summarizeProsody", () => {
  it("counts segments, emotional segments and segments with instruction", () => {
    const segments = [
      segment({ id: "a", prosody: prosody({ emotion: "suspense", instructionPtBr: "Tom contido." }) }),
      segment({ id: "b", prosody: prosody({ emotion: "neutral", instructionPtBr: "" }) }),
      segment({ id: "c", prosody: prosody({ emotion: "joyful", instructionPtBr: "Alegre." }) }),
      segment({ id: "d" })
    ]
    expect(summarizeProsody(segments)).toEqual({ segments: 4, withInstruction: 2, emotionalSegments: 2 })
  })
})
