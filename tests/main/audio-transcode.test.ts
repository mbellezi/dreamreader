import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { probeAudio, resampleAudio, TARGET_SAMPLE_RATE } from "../../src/main/lib/audio-transcode"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { force: true, recursive: true })
  }
})

describe("audio-transcode", () => {
  it("probes audio metadata without ffprobe and resamples with the bundled ffmpeg binary", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dreamreader-audio-transcode-"))
    tempDirs.push(tempDir)
    const inputPath = path.join(tempDir, "reference.wav")
    const outputPath = path.join(tempDir, "reference-22050.wav")
    await writeFile(inputPath, createSilentWav(1_000, 24_000))

    const inputProbe = await probeAudio(inputPath)
    expect(inputProbe).toMatchObject({
      channels: 1,
      sampleRate: 24_000
    })
    expect(inputProbe.durationMs).toBeGreaterThanOrEqual(950)
    expect(inputProbe.durationMs).toBeLessThanOrEqual(1_050)

    await expect(resampleAudio(inputPath, outputPath, TARGET_SAMPLE_RATE)).resolves.toBe(true)
    expect((await readFile(outputPath)).subarray(0, 4).toString()).toBe("RIFF")
    expect(await probeAudio(outputPath)).toMatchObject({
      channels: 1,
      sampleRate: TARGET_SAMPLE_RATE
    })
  })
})

function createSilentWav(durationMs: number, sampleRate: number): Buffer {
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
