import type { NarrationPlan, NarrationProsody, NarrationSegment } from "@shared/contracts/ai"
import { hashBuffer } from "@main/lib/hash"

const sampleRate = 22_050
const bytesPerSample = 2
const channelCount = 1
const idleTimeoutMs = 45_000

export type LocalTtsAudio = {
  buffer: Buffer
  contentHash: string
  durationMs: number
  mimeType: "audio/wav"
}

export class LocalTtsAdapter {
  readonly id = "dreamreader-local-wav"
  private disposeTimer: NodeJS.Timeout | undefined
  private warmed = false

  async warmup(): Promise<void> {
    if (this.disposeTimer) {
      clearTimeout(this.disposeTimer)
      this.disposeTimer = undefined
    }
    this.warmed = true
  }

  synthesizeSegment(segment: NarrationSegment, seed?: number): LocalTtsAudio {
    this.assertWarm()
    const durationMs = durationForText(segment.normalizedText, segment.prosody)
    const frequency = frequencyFor(seedKey(seed, segment.segmentId), segment.prosody)
    const buffer = createToneWav(durationMs, frequency, amplitudeFor(segment.prosody))
    return {
      buffer,
      contentHash: hashBuffer(buffer),
      durationMs,
      mimeType: "audio/wav"
    }
  }

  synthesizeChapter(plan: NarrationPlan, seed?: number): LocalTtsAudio {
    this.assertWarm()
    const durationMs = plan.segments.reduce(
      (total, segment) => total + durationForText(segment.normalizedText, segment.prosody),
      0
    )
    const averageProsody = averageProsodyFor(plan.segments)
    const frequency = frequencyFor(
      seedKey(seed, `${plan.source.bookId}:${plan.source.chapterHref}:${plan.prosody.analyzerId}`),
      averageProsody
    )
    const buffer = createToneWav(Math.max(durationMs, 750), frequency, amplitudeFor(averageProsody))
    return {
      buffer,
      contentHash: hashBuffer(buffer),
      durationMs: Math.max(durationMs, 750),
      mimeType: "audio/wav"
    }
  }

  scheduleDispose(): void {
    if (this.disposeTimer) {
      clearTimeout(this.disposeTimer)
    }
    this.disposeTimer = setTimeout(() => {
      this.warmed = false
      this.disposeTimer = undefined
    }, idleTimeoutMs)
    this.disposeTimer.unref?.()
  }

  private assertWarm(): void {
    if (!this.warmed) {
      throw new Error("Local TTS adapter must be warmed before synthesis")
    }
  }
}

export function durationForText(text: string, prosodyOrPause: NarrationProsody | number = 350): number {
  const prosody = typeof prosodyOrPause === "number" ? undefined : prosodyOrPause
  const pauseAfterMs = typeof prosodyOrPause === "number" ? prosodyOrPause : prosodyOrPause.pauseAfterMs
  const words = text.split(/\s+/).filter(Boolean).length
  const paceFactor = prosody?.pace === "slow" ? 1.16 : prosody?.pace === "fast" ? 0.88 : 1
  const estimatedSpeechMs = Math.max(500, words * 310 * paceFactor)
  return Math.min(12_000, estimatedSpeechMs + pauseAfterMs)
}

function frequencyFor(seed: string, prosody?: NarrationProsody): number {
  const digest = hashBuffer(seed)
  const offset = Number.parseInt(digest.slice(0, 2), 16) % 90
  const pitchOffset = prosody?.pitch === "low" ? -34 : prosody?.pitch === "high" ? 42 : 0
  const emotionOffset = prosody?.emotion === "suspense" || prosody?.emotion === "sad" ? -18 : prosody?.emotion === "joyful" ? 24 : 0
  return Math.max(120, 180 + offset + pitchOffset + emotionOffset)
}

function seedKey(seed: number | undefined, fallback: string): string {
  return typeof seed === "number" ? String(seed) : fallback
}

function amplitudeFor(prosody?: NarrationProsody): number {
  return 2200 + Math.round((prosody?.intensity ?? 0.2) * 1400)
}

function averageProsodyFor(segments: NarrationSegment[]): NarrationProsody {
  const first = segments[0]?.prosody
  if (!first) {
    return {
      emotion: "neutral",
      intensity: 0.2,
      pace: "normal",
      pitch: "neutral",
      pauseBeforeMs: 0,
      pauseAfterMs: 350,
      instructionPtBr: ""
    }
  }
  const intensity = segments.reduce((total, segment) => total + segment.prosody.intensity, 0) / Math.max(segments.length, 1)
  const slowCount = segments.filter((segment) => segment.prosody.pace === "slow").length
  const fastCount = segments.filter((segment) => segment.prosody.pace === "fast").length
  const highCount = segments.filter((segment) => segment.prosody.pitch === "high").length
  const lowCount = segments.filter((segment) => segment.prosody.pitch === "low").length
  return {
    ...first,
    intensity,
    pace: slowCount > fastCount ? "slow" : fastCount > slowCount ? "fast" : "normal",
    pitch: lowCount > highCount ? "low" : highCount > lowCount ? "high" : "neutral"
  }
}

function createToneWav(durationMs: number, frequency: number, amplitude: number): Buffer {
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
  buffer.writeUInt16LE(16, 34)
  buffer.write("data", 36)
  buffer.writeUInt32LE(dataSize, 40)

  const attackFrames = Math.round(sampleRate * 0.025)
  const releaseFrames = Math.round(sampleRate * 0.05)
  for (let frame = 0; frame < frameCount; frame += 1) {
    const t = frame / sampleRate
    const envelope = Math.min(1, frame / Math.max(attackFrames, 1), (frameCount - frame) / Math.max(releaseFrames, 1))
    const carrier = Math.sin(2 * Math.PI * frequency * t)
    const tremolo = 0.68 + Math.sin(2 * Math.PI * 4.5 * t) * 0.12
    const sample = Math.round(carrier * tremolo * envelope * amplitude)
    buffer.writeInt16LE(sample, 44 + frame * bytesPerSample)
  }

  return buffer
}
