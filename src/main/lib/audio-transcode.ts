import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export const TARGET_SAMPLE_RATE = 22050

export type AudioProbe = {
  durationMs?: number
  sampleRate?: number
  channels?: number
}

/**
 * Probe an audio file with ffprobe, falling back to a minimal WAV header parse
 * when ffprobe is not available. Never throws.
 */
export async function probeAudio(filePath: string): Promise<AudioProbe> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=sample_rate,channels:format=duration",
      "-of",
      "json",
      filePath
    ])
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{ sample_rate?: string; channels?: number }>
      format?: { duration?: string }
    }
    const stream = parsed.streams?.[0]
    const durationSec = parsed.format?.duration ? Number(parsed.format.duration) : undefined
    return {
      durationMs: durationSec && Number.isFinite(durationSec) ? Math.round(durationSec * 1000) : undefined,
      sampleRate: stream?.sample_rate ? Number(stream.sample_rate) : undefined,
      channels: typeof stream?.channels === "number" ? stream.channels : undefined
    }
  } catch {
    return probeWavHeader(filePath)
  }
}

/**
 * Resample an audio file to the target sample rate using ffmpeg. Returns false
 * when ffmpeg is unavailable or the conversion fails (caller keeps the original).
 */
export async function resampleAudio(srcPath: string, destPath: string, sampleRate = TARGET_SAMPLE_RATE): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", ["-y", "-i", srcPath, "-ar", String(sampleRate), destPath])
    return true
  } catch {
    return false
  }
}

async function probeWavHeader(filePath: string): Promise<AudioProbe> {
  try {
    const buffer = await readFile(filePath)
    if (buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WAVE") {
      const sampleRate = buffer.readUInt32LE(24)
      const byteRate = buffer.readUInt32LE(28)
      const dataOffset = buffer.indexOf("data")
      const durationMs =
        byteRate > 0 && dataOffset >= 0 && dataOffset + 8 <= buffer.byteLength
          ? Math.round((buffer.readUInt32LE(dataOffset + 4) / byteRate) * 1000)
          : undefined
      return { durationMs, sampleRate: sampleRate || undefined }
    }
  } catch {
    // ignore and fall through
  }
  return {}
}
