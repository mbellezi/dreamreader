import { execFile } from "node:child_process"
import { access, readFile } from "node:fs/promises"
import { promisify } from "node:util"
import ffmpegStaticPath from "ffmpeg-static"
import { parseFile } from "music-metadata"

const execFileAsync = promisify(execFile)

export const TARGET_SAMPLE_RATE = 22050

export type AudioProbe = {
  durationMs?: number
  sampleRate?: number
  channels?: number
}

/**
 * Probe audio metadata in-process, falling back to a minimal WAV header parse.
 * Never throws.
 */
export async function probeAudio(filePath: string): Promise<AudioProbe> {
  try {
    const metadata = await parseFile(filePath, { duration: true })
    const durationSec = metadata.format.duration
    return {
      durationMs: durationSec && Number.isFinite(durationSec) ? Math.round(durationSec * 1000) : undefined,
      sampleRate: metadata.format.sampleRate,
      channels: metadata.format.numberOfChannels
    }
  } catch {
    return probeWavHeader(filePath)
  }
}

/**
 * Resample an audio file to the target sample rate using the bundled FFmpeg
 * binary. Returns false when the binary is unavailable or conversion fails.
 */
export async function resampleAudio(srcPath: string, destPath: string, sampleRate = TARGET_SAMPLE_RATE): Promise<boolean> {
  const ffmpegPath = await bundledFfmpegPath()
  if (!ffmpegPath) {
    return false
  }

  try {
    await execFileAsync(ffmpegPath, ["-y", "-i", srcPath, "-ar", String(sampleRate), destPath])
    return true
  } catch {
    return false
  }
}

async function bundledFfmpegPath(): Promise<string | undefined> {
  if (!ffmpegStaticPath) {
    return undefined
  }

  const candidate = ffmpegStaticPath
  if (await fileExists(candidate)) {
    return candidate
  }

  const unpackedCandidate = candidate.replace(`${pathSeparator()}app.asar${pathSeparator()}`, `${pathSeparator()}app.asar.unpacked${pathSeparator()}`)
  return (await fileExists(unpackedCandidate)) ? unpackedCandidate : undefined
}

function pathSeparator(): string {
  return process.platform === "win32" ? "\\" : "/"
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
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
