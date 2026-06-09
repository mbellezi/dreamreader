import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const localRoot = path.join(projectRoot, ".dreamreader-local")
const pythonExecutable = path.join(localRoot, "python", "bin", "python")
const smokeRoot = path.join(localRoot, "smoke-tests")
const timeoutMs = Number(process.env.DREAMREADER_TTS_SMOKE_TIMEOUT_MS ?? 30 * 60 * 1000)

const modelDefinitions = {
  "qwen3-tts-06b-mlx": {
    adapterId: "qwen3-tts-mlx",
    engineId: "qwen3-tts-06b-mlx",
    modelPath: path.join(localRoot, "models", "qwen3-tts-06b-mlx"),
    sidecarScript: path.join(projectRoot, "sidecars", "tts", "qwen3_tts_mlx_sidecar.py")
  },
  "qwen3-tts-17b-mlx": {
    adapterId: "qwen3-tts-mlx",
    engineId: "qwen3-tts-17b-mlx",
    modelPath: path.join(localRoot, "models", "qwen3-tts-17b-mlx"),
    sidecarScript: path.join(projectRoot, "sidecars", "tts", "qwen3_tts_mlx_sidecar.py")
  },
  "qwen3-tts-17b-base-mlx": {
    adapterId: "qwen3-tts-mlx",
    engineId: "qwen3-tts-17b-base-mlx",
    modelPath: path.join(localRoot, "models", "qwen3-tts-17b-base-mlx"),
    sidecarScript: path.join(projectRoot, "sidecars", "tts", "qwen3_tts_mlx_sidecar.py")
  },
  "f5-tts-pt-br": {
    adapterId: "f5-tts-pt-br",
    engineId: "f5-tts-pt-br",
    modelPath: path.join(localRoot, "models", "f5-tts-pt-br"),
    sidecarScript: path.join(projectRoot, "sidecars", "tts", "f5_tts_ptbr_sidecar.py")
  }
}

const requestedModels = parseRequestedModels(process.argv.slice(2))

if (!existsSync(pythonExecutable)) {
  fail(`Local Python not found at ${relative(pythonExecutable)}. Run npm run setup:python-tts first.`)
}

mkdirSync(smokeRoot, { recursive: true })

for (const modelId of requestedModels) {
  await runSmokeTest(modelId)
}

function parseRequestedModels(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: npm run test:tts-models -- [model-id ...]

Default model:
  qwen3-tts-06b-mlx

Available model ids:
  ${Object.keys(modelDefinitions).join("\n  ")}

F5-TTS needs a reference voice:
  DREAMREADER_F5_REFERENCE_AUDIO=/path/ref.wav
  DREAMREADER_F5_REFERENCE_TEXT="transcript of the reference audio"

Qwen3-TTS 1.7B Base clone smoke needs a reference voice:
  DREAMREADER_QWEN_REFERENCE_AUDIO=/path/ref.wav
  DREAMREADER_QWEN_REFERENCE_TEXT="transcript of the reference audio"
`)
    process.exit(0)
  }

  const models = args.filter((arg) => !arg.startsWith("-"))
  if (args.includes("--all")) {
    return Object.keys(modelDefinitions)
  }
  if (models.length === 0) {
    return ["qwen3-tts-06b-mlx"]
  }

  const unknown = models.filter((model) => !modelDefinitions[model])
  if (unknown.length > 0) {
    fail(`Unknown TTS smoke model id(s): ${unknown.join(", ")}`)
  }
  return models
}

async function runSmokeTest(modelId) {
  const definition = modelDefinitions[modelId]
  assertExists(definition.modelPath, `Model folder not found for ${modelId}`)
  assertExists(definition.sidecarScript, `Sidecar script not found for ${modelId}`)

  const outputDirectory = path.join(smokeRoot, `${modelId}-${Date.now()}`)
  mkdirSync(outputDirectory, { recursive: true })

  console.log(`Testing ${modelId}`)
  console.log(`  model: ${relative(definition.modelPath)}`)
  console.log(`  output: ${relative(outputDirectory)}`)

  try {
    const result = await runSidecar(definition, outputDirectory)
    assertResult(result)

    const artifacts = [
      { kind: "chapter", item: result.chapter },
      ...result.segments.map((item) => ({ kind: `segment ${item.segmentIndex ?? item.segmentId}`, item }))
    ]

    const summaries = artifacts.map(({ kind, item }) => {
      assertPathInside(outputDirectory, item.audioPath)
      const summary = inspectWav(item.audioPath)
      if (summary.durationMs < 500) {
        throw new Error(`${kind} WAV is too short: ${summary.durationMs}ms`)
      }
      if (Math.abs(summary.durationMs - item.durationMs) > 350) {
        throw new Error(`${kind} duration mismatch: sidecar=${item.durationMs}ms wav=${summary.durationMs}ms`)
      }
      if (summary.nonZeroSamples < 128 || summary.maxAbs < minPeak()) {
        throw new Error(`${kind} WAV looks silent: peak=${summary.maxAbs}, nonZeroSamples=${summary.nonZeroSamples}`)
      }
      return { kind, ...summary, audioPath: relative(item.audioPath) }
    })

    for (const summary of summaries) {
      console.log(
        `  ok ${summary.kind}: ${summary.durationMs}ms, ${summary.sampleRate}Hz, ${summary.channels}ch, peak ${summary.maxAbs}, ${summary.sizeBytes} bytes`
      )
    }
  } finally {
    rmSync(outputDirectory, { force: true, recursive: true })
  }
}

function runSidecar(definition, outputDirectory) {
  return new Promise((resolve, reject) => {
    const reference = referenceFor(definition.engineId)
    const voiceBinding = voiceBindingFor(definition)
    const request = {
      schemaVersion: "dreamreader-tts-sidecar/v1",
      adapterId: definition.adapterId,
      engineId: definition.engineId,
      jobId: `tts_smoke_${Date.now()}`,
      modelPath: definition.modelPath,
      outputDirectory,
      quality: "standard",
      referenceAudioPath: reference?.audioPath,
      referenceText: reference?.text,
      voiceBinding,
      voiceSamples: [],
      plan: {
        version: "dreamreader-narration-plan/v1",
        source: {
          language: "pt-BR"
        },
        segments: [
          {
            segmentId: "tts-smoke-ptbr-1",
            segmentIndex: 0,
            originalText: "Este e um teste rapido de voz local do DreamReader.",
            normalizedText: "Este e um teste rapido de voz local do DreamReader.",
            prosody: {
              emotion: "neutral",
              intensity: 0.35,
              pace: 1,
              pauseAfterMs: 120,
              instructionPtBr: "Narrar em portugues brasileiro, com voz natural e neutra."
            }
          }
        ]
      }
    }

    const child = spawn(pythonExecutable, [definition.sidecarScript], {
      env: {
        ...process.env,
        HF_HOME: path.join(localRoot, "huggingface"),
        MPLCONFIGDIR: path.join(localRoot, "cache", "matplotlib"),
        PYTHONUNBUFFERED: "1"
      },
      stdio: ["pipe", "pipe", "pipe"]
    })

    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGTERM")
      reject(new Error(`TTS sidecar timed out after ${timeoutMs}ms`))
    }, timeoutMs)

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
        reject(new Error(stderr.trim() || `TTS sidecar exited with code ${code}`))
        return
      }
      try {
        resolve(parseJson(stdout))
      } catch (error) {
        reject(new Error(`TTS sidecar returned invalid JSON: ${error.message}\n${stdout.slice(0, 500)}`))
      }
    })

    child.stdin.end(`${JSON.stringify(request)}\n`)
  })
}

function voiceBindingFor(definition) {
  if (definition.adapterId !== "qwen3-tts-mlx") {
    return undefined
  }
  const speaker = process.env.DREAMREADER_QWEN_SMOKE_SPEAKER || "Ryan"
  const voiceDescription =
    process.env.DREAMREADER_QWEN_SMOKE_VOICE_DESCRIPTION ||
    "A clear natural audiobook narrator speaking Brazilian Portuguese with a natural Brazilian accent, not European Portuguese. Keep the same speaker identity across every segment."
  const isVoiceDesign = definition.engineId === "qwen3-tts-17b-mlx"
  const isReferenceClone = definition.engineId === "qwen3-tts-17b-base-mlx"
  return {
    id: `smoke-binding-${definition.engineId}`,
    voiceProfileId: isVoiceDesign ? "voice_qwen3_design_ptbr_neutral" : isReferenceClone ? "voice_qwen3_reference_smoke" : "voice_qwen3_speaker_ryan",
    engineId: definition.engineId,
    adapterId: definition.adapterId,
    status: "ready",
    bindingKind: isVoiceDesign ? "voice_design_prompt" : isReferenceClone ? "reference_audio" : "preset",
    settings: {
      preset: speaker,
      speaker,
      voiceDescription,
      voiceDesignPrompt: voiceDescription
    },
    compatibility: {
      builtIn: true
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
}

function referenceFor(engineId) {
  if (engineId === "qwen3-tts-17b-base-mlx") {
    const audioPath = process.env.DREAMREADER_QWEN_REFERENCE_AUDIO
    const text = process.env.DREAMREADER_QWEN_REFERENCE_TEXT
    if (!audioPath || !text) {
      fail("Qwen3-TTS 1.7B Base smoke test requires DREAMREADER_QWEN_REFERENCE_AUDIO and DREAMREADER_QWEN_REFERENCE_TEXT.")
    }
    assertExists(audioPath, "Qwen3-TTS reference audio not found")
    return { audioPath: path.resolve(audioPath), text }
  }
  if (engineId !== "f5-tts-pt-br") {
    return undefined
  }
  const audioPath = process.env.DREAMREADER_F5_REFERENCE_AUDIO
  const text = process.env.DREAMREADER_F5_REFERENCE_TEXT
  if (!audioPath || !text) {
    fail("F5-TTS smoke test requires DREAMREADER_F5_REFERENCE_AUDIO and DREAMREADER_F5_REFERENCE_TEXT.")
  }
  assertExists(audioPath, "F5-TTS reference audio not found")
  return { audioPath: path.resolve(audioPath), text }
}

function assertResult(result) {
  if (!result || typeof result !== "object") {
    throw new Error("Sidecar result is not an object")
  }
  if (result.schemaVersion !== "dreamreader-tts-sidecar-result/v1") {
    throw new Error(`Unexpected sidecar schemaVersion: ${result.schemaVersion}`)
  }
  if (!result.chapter || typeof result.chapter.audioPath !== "string") {
    throw new Error("Sidecar result is missing chapter audioPath")
  }
  if (!Array.isArray(result.segments) || result.segments.length === 0) {
    throw new Error("Sidecar result did not include generated segments")
  }
}

function parseJson(stdout) {
  const trimmed = stdout.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf("{")
    const end = trimmed.lastIndexOf("}")
    if (start < 0 || end <= start) {
      throw new Error("stdout did not include a JSON object")
    }
    return JSON.parse(trimmed.slice(start, end + 1))
  }
}

function inspectWav(audioPath) {
  const buffer = readFileSync(audioPath)
  if (buffer.length < 44) {
    throw new Error(`WAV is too small: ${relative(audioPath)}`)
  }
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`File is not a RIFF/WAVE file: ${relative(audioPath)}`)
  }

  const chunks = readWavChunks(buffer)
  const fmt = chunks.find((chunk) => chunk.id === "fmt ")
  const data = chunks.find((chunk) => chunk.id === "data")
  if (!fmt || !data) {
    throw new Error(`WAV is missing fmt/data chunks: ${relative(audioPath)}`)
  }

  const audioFormat = buffer.readUInt16LE(fmt.offset)
  const channels = buffer.readUInt16LE(fmt.offset + 2)
  const sampleRate = buffer.readUInt32LE(fmt.offset + 4)
  const byteRate = buffer.readUInt32LE(fmt.offset + 8)
  const blockAlign = buffer.readUInt16LE(fmt.offset + 12)
  const bitsPerSample = buffer.readUInt16LE(fmt.offset + 14)

  if (channels < 1 || sampleRate < 8000 || blockAlign < 1 || bitsPerSample < 8 || byteRate < 1) {
    throw new Error(`WAV has invalid format values: ${relative(audioPath)}`)
  }
  if (![1, 3, 65534].includes(audioFormat)) {
    throw new Error(`Unsupported WAV format ${audioFormat}: ${relative(audioPath)}`)
  }

  const dataSize = data.size
  const frameCount = Math.floor(dataSize / blockAlign)
  if (frameCount < 1) {
    throw new Error(`WAV data chunk has no frames: ${relative(audioPath)}`)
  }

  const amplitude = scanAmplitude(buffer, data.offset, data.offset + dataSize, audioFormat, bitsPerSample)
  return {
    audioFormat,
    bitsPerSample,
    channels,
    durationMs: Math.round((frameCount / sampleRate) * 1000),
    frameCount,
    maxAbs: amplitude.maxAbs,
    nonZeroSamples: amplitude.nonZeroSamples,
    sampleRate,
    sizeBytes: statSync(audioPath).size
  }
}

function readWavChunks(buffer) {
  const chunks = []
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const dataOffset = offset + 8
    if (dataOffset + size > buffer.length) {
      throw new Error(`WAV chunk ${id} exceeds file size`)
    }
    chunks.push({ id, offset: dataOffset, size })
    offset = dataOffset + size + (size % 2)
  }
  return chunks
}

function scanAmplitude(buffer, start, end, audioFormat, bitsPerSample) {
  let maxAbs = 0
  let nonZeroSamples = 0
  const sampleBytes = bitsPerSample / 8
  if (!Number.isInteger(sampleBytes) || sampleBytes < 1) {
    throw new Error(`Unsupported bitsPerSample ${bitsPerSample}`)
  }

  for (let offset = start; offset + sampleBytes <= end; offset += sampleBytes) {
    const value = readSample(buffer, offset, audioFormat, bitsPerSample)
    const abs = Math.abs(value)
    if (abs > maxAbs) {
      maxAbs = abs
    }
    if (abs > 0) {
      nonZeroSamples += 1
    }
  }

  return { maxAbs, nonZeroSamples }
}

function readSample(buffer, offset, audioFormat, bitsPerSample) {
  if (audioFormat === 3 && bitsPerSample === 32) {
    return Math.round(Math.abs(buffer.readFloatLE(offset)) * 32768)
  }
  if (bitsPerSample === 8) {
    return buffer.readUInt8(offset) - 128
  }
  if (bitsPerSample === 16) {
    return buffer.readInt16LE(offset)
  }
  if (bitsPerSample === 24) {
    return buffer.readIntLE(offset, 3)
  }
  if (bitsPerSample === 32) {
    return Math.round(buffer.readInt32LE(offset) / 65536)
  }
  throw new Error(`Unsupported bitsPerSample ${bitsPerSample}`)
}

function assertPathInside(root, candidate) {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Sidecar returned output outside smoke directory: ${candidate}`)
  }
}

function assertExists(targetPath, message) {
  if (!existsSync(targetPath)) {
    fail(`${message}: ${targetPath}`)
  }
}

function minPeak() {
  return Number(process.env.DREAMREADER_TTS_SMOKE_MIN_PEAK ?? 32)
}

function relative(targetPath) {
  const resolved = path.resolve(targetPath)
  const rel = path.relative(projectRoot, resolved)
  if (!rel.startsWith("..") && rel !== "") {
    return rel
  }
  return path.relative(os.homedir(), resolved)
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
