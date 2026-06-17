import { execFile } from "node:child_process"
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
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

export type M4bChapterInput = {
  filePath: string
  title: string
  startMs: number
  endMs: number
}

export type M4bMetadataInput = {
  title: string
  authors?: string[]
  language?: string
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

export async function buildM4bAudiobook(input: {
  chapters: M4bChapterInput[]
  coverPath?: string
  metadata: M4bMetadataInput
  outputPath: string
  bitrate?: string
}): Promise<void> {
  if (!input.chapters.length) {
    throw new Error("At least one chapter audio file is required")
  }

  const ffmpegPath = await bundledFfmpegPath()
  if (!ffmpegPath) {
    throw new Error("Bundled FFmpeg binary is unavailable")
  }

  await mkdir(path.dirname(input.outputPath), { recursive: true })
  const workDir = await mkdtemp(path.join(path.dirname(input.outputPath), ".m4b-build-"))
  const metadataPath = path.join(workDir, "metadata.ffmetadata")

  try {
    await writeFile(metadataPath, ffmetadataFor(input.metadata, input.chapters))

    const metadataInputIndex = input.chapters.length + (input.coverPath ? 1 : 0)
    const filterInputs = input.chapters.map((_, index) => `[${index}:a:0]`).join("")
    const args = ["-y"]
    for (const chapter of input.chapters) {
      args.push("-i", chapter.filePath)
    }
    const coverInputIndex = input.coverPath ? input.chapters.length : undefined
    if (input.coverPath) {
      args.push("-i", input.coverPath)
    }
    args.push(
      "-i",
      metadataPath,
      "-filter_complex",
      `${filterInputs}concat=n=${input.chapters.length}:v=0:a=1[aout]`,
      "-map",
      "[aout]",
      "-map_metadata",
      String(metadataInputIndex),
      "-map_chapters",
      String(metadataInputIndex)
    )
    if (coverInputIndex !== undefined) {
      args.push(
        "-map",
        `${coverInputIndex}:v:0`,
        "-c:v",
        "mjpeg",
        "-disposition:v:0",
        "attached_pic"
      )
    }
    args.push(
      "-c:a",
      "aac",
      "-b:a",
      input.bitrate ?? "96k",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      input.outputPath
    )

    await execFileAsync(ffmpegPath, args, { maxBuffer: 8 * 1024 * 1024 })
  } finally {
    await rm(workDir, { force: true, recursive: true })
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

function ffmetadataFor(metadata: M4bMetadataInput, chapters: M4bChapterInput[]): string {
  const lines = [
    ";FFMETADATA1",
    `title=${escapeFfmetadataValue(metadata.title)}`,
    metadata.authors?.length ? `artist=${escapeFfmetadataValue(metadata.authors.join(", "))}` : undefined,
    metadata.language ? `language=${escapeFfmetadataValue(metadata.language)}` : undefined
  ].filter((line): line is string => Boolean(line))

  for (const chapter of chapters) {
    lines.push(
      "[CHAPTER]",
      "TIMEBASE=1/1000",
      `START=${Math.max(0, Math.round(chapter.startMs))}`,
      `END=${Math.max(Math.round(chapter.startMs) + 1, Math.round(chapter.endMs))}`,
      `title=${escapeFfmetadataValue(chapter.title)}`
    )
  }

  return `${lines.join("\n")}\n`
}

function escapeFfmetadataValue(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/([=;#\\])/g, "\\$1")
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
