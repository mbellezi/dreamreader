import { execFile } from "node:child_process"
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import ffmpegStaticPath from "ffmpeg-static"
import { parseFile } from "music-metadata"
import { hashFile } from "@main/lib/hash"

const execFileAsync = promisify(execFile)

export const TARGET_SAMPLE_RATE = 22050

export type AudioProbe = {
  durationMs?: number
  sampleRate?: number
  channels?: number
}

export type M4bChapterInput = {
  filePath: string
  mimeType?: string
  title: string
  startMs: number
  endMs: number
}

export type M4bMetadataInput = {
  title: string
  authors?: string[]
  language?: string
}

export type AacTranscodeResult = {
  audioPath: string
  contentHash: string
  durationMs: number
  encoder: "aac" | "aac_at"
  mimeType: "audio/mp4"
  sizeBytes: number
}

export type M4bBuildResult = {
  audioMode: "copy" | "encode"
  encoder: "aac" | "aac_at" | "copy"
}

let preferredAacEncoderPromise: Promise<"aac" | "aac_at"> | undefined

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

export async function transcodeAudioToAac(input: {
  srcPath: string
  destPath: string
  bitrate?: string
  durationMs?: number
}): Promise<AacTranscodeResult> {
  const ffmpegPath = await bundledFfmpegPath()
  if (!ffmpegPath) {
    throw new Error("Bundled FFmpeg binary is unavailable")
  }

  await mkdir(path.dirname(input.destPath), { recursive: true })
  const encoder = await execWithAacFallback(ffmpegPath, (candidate) => [
    "-y",
    "-i",
    input.srcPath,
    "-vn",
    "-map",
    "0:a:0",
    "-c:a",
    candidate,
    "-b:a",
    input.bitrate ?? "96k",
    "-movflags",
    "+faststart",
    input.destPath
  ], input.destPath)

  const probe = await probeAudio(input.destPath)
  return {
    audioPath: input.destPath,
    contentHash: await hashFile(input.destPath),
    durationMs: probe.durationMs ?? input.durationMs ?? 0,
    encoder,
    mimeType: "audio/mp4",
    sizeBytes: (await stat(input.destPath)).size
  }
}

export async function buildM4bAudiobook(input: {
  chapters: M4bChapterInput[]
  chapterGapMs?: number
  coverPath?: string
  metadata: M4bMetadataInput
  outputPath: string
  bitrate?: string
}): Promise<M4bBuildResult> {
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
  const chapterGapMs = Math.max(0, Math.round(input.chapterGapMs ?? 0))

  try {
    await writeFile(metadataPath, ffmetadataFor(input.metadata, input.chapters))
    if ((chapterGapMs === 0 || input.chapters.length <= 1) && input.chapters.every(isCopyCompatibleAacChapter)) {
      const concatListPath = path.join(workDir, "chapters.txt")
      await writeFile(
        concatListPath,
        `${input.chapters.map((chapter) => `file '${escapeConcatFilePath(chapter.filePath)}'`).join("\n")}\n`
      )
      try {
        await execFileAsync(ffmpegPath, m4bCopyArgs(input, concatListPath, metadataPath), {
          maxBuffer: 8 * 1024 * 1024
        })
        return { audioMode: "copy", encoder: "copy" }
      } catch {
        await rm(input.outputPath, { force: true })
      }
    }

    const encoder = await execWithAacFallback(
      ffmpegPath,
      (candidate) => m4bEncodeArgs(input, metadataPath, candidate, chapterGapMs),
      input.outputPath
    )
    return { audioMode: "encode", encoder }
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

async function preferredAacEncoder(ffmpegPath: string): Promise<"aac" | "aac_at"> {
  preferredAacEncoderPromise ??= detectPreferredAacEncoder(ffmpegPath)
  return preferredAacEncoderPromise
}

async function detectPreferredAacEncoder(ffmpegPath: string): Promise<"aac" | "aac_at"> {
  if (process.platform !== "darwin") {
    return "aac"
  }
  try {
    const encoders = await execFileAsync(ffmpegPath, ["-hide_banner", "-encoders"], {
      maxBuffer: 1024 * 1024
    })
    return /\baac_at\b/.test(encoders.stdout) ? "aac_at" : "aac"
  } catch {
    return "aac"
  }
}

async function execWithAacFallback(
  ffmpegPath: string,
  argsFor: (encoder: "aac" | "aac_at") => string[],
  outputPath: string
): Promise<"aac" | "aac_at"> {
  const encoder = await preferredAacEncoder(ffmpegPath)
  try {
    await execFileAsync(ffmpegPath, argsFor(encoder), { maxBuffer: 8 * 1024 * 1024 })
    return encoder
  } catch (error) {
    if (encoder !== "aac_at") {
      throw error
    }
    preferredAacEncoderPromise = Promise.resolve("aac")
    await rm(outputPath, { force: true }).catch(() => undefined)
    await execFileAsync(ffmpegPath, argsFor("aac"), { maxBuffer: 8 * 1024 * 1024 })
    return "aac"
  }
}

function m4bCopyArgs(input: {
  chapters: M4bChapterInput[]
  coverPath?: string
  metadata: M4bMetadataInput
  outputPath: string
}, concatListPath: string, metadataPath: string): string[] {
  const args = ["-y", "-f", "concat", "-safe", "0", "-i", concatListPath]
  const coverInputIndex = input.coverPath ? 1 : undefined
  if (input.coverPath) {
    args.push("-i", input.coverPath)
  }
  const metadataInputIndex = input.coverPath ? 2 : 1
  args.push(
    "-i",
    metadataPath,
    "-map",
    "0:a:0",
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
  args.push("-c:a", "copy", "-movflags", "+faststart", "-f", "mp4", input.outputPath)
  return args
}

function m4bEncodeArgs(input: {
  chapters: M4bChapterInput[]
  coverPath?: string
  metadata: M4bMetadataInput
  outputPath: string
  bitrate?: string
}, metadataPath: string, encoder: "aac" | "aac_at", chapterGapMs: number): string[] {
  const metadataInputIndex = input.chapters.length + (input.coverPath ? 1 : 0)
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
    m4bConcatFilter(input.chapters.length, chapterGapMs),
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
    encoder,
    "-b:a",
    input.bitrate ?? "96k",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    input.outputPath
  )
  return args
}

function m4bConcatFilter(chapterCount: number, chapterGapMs: number): string {
  if (chapterGapMs <= 0 || chapterCount <= 1) {
    const filterInputs = Array.from({ length: chapterCount }, (_, index) => `[${index}:a:0]`).join("")
    return `${filterInputs}concat=n=${chapterCount}:v=0:a=1[aout]`
  }

  const gapSeconds = trimDecimal(chapterGapMs / 1000)
  const chains: string[] = []
  const concatInputs: string[] = []
  for (let index = 0; index < chapterCount; index += 1) {
    chains.push(
      `[${index}:a:0]aresample=${TARGET_SAMPLE_RATE},aformat=sample_fmts=fltp:sample_rates=${TARGET_SAMPLE_RATE}:channel_layouts=stereo[a${index}]`
    )
    concatInputs.push(`[a${index}]`)
    if (index < chapterCount - 1) {
      chains.push(`anullsrc=channel_layout=stereo:sample_rate=${TARGET_SAMPLE_RATE}:duration=${gapSeconds}[s${index}]`)
      concatInputs.push(`[s${index}]`)
    }
  }
  chains.push(`${concatInputs.join("")}concat=n=${concatInputs.length}:v=0:a=1[aout]`)
  return chains.join(";")
}

function isCopyCompatibleAacChapter(chapter: M4bChapterInput): boolean {
  const extension = path.extname(chapter.filePath).toLowerCase()
  return chapter.mimeType === "audio/mp4" && [".m4a", ".mp4", ".m4b"].includes(extension)
}

function trimDecimal(value: number): string {
  return value.toFixed(3).replace(/0+$/g, "").replace(/\.$/g, "")
}

function escapeConcatFilePath(filePath: string): string {
  return filePath.replace(/'/g, "'\\''")
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
