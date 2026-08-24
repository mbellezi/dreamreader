import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ffmpegStaticPath from "ffmpeg-static"
import {
  detectInstallPlatform,
  modelFolderName,
  parseInstallBackend,
  pipInstallPlanForBackend,
  pythonExecutableCandidates,
  pythonExecutablePath,
  resolveInstallBackend
} from "./install-platform.mjs"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, "..")
const localRoot = path.join(projectRoot, ".dreamreader-local")
const pythonDir = path.join(localRoot, "python")
const args = process.argv.slice(2)
const installPlatform = detectInstallPlatform()
const installBackend = resolveInstallBackend(parseInstallBackend(args), installPlatform)
const installSidecars = args.includes("--install-sidecars")
const pythonExecutable = pythonExecutablePath(localRoot, installPlatform)
const modelsRoot = path.join(localRoot, "models")
const downloadsRoot = path.join(localRoot, "downloads")
const qwen06bModelDir = path.join(modelsRoot, modelFolderName("qwen3-tts-06b-mlx", installBackend))
const qwen17bModelDir = path.join(modelsRoot, modelFolderName("qwen3-tts-17b-mlx", installBackend))
const qwen17bBaseModelDir = path.join(modelsRoot, modelFolderName("qwen3-tts-17b-base-mlx", installBackend))
const chatterboxModelDir = path.join(modelsRoot, modelFolderName("chatterbox-multilingual-mlx", installBackend))
const mossTtsModelDir = installBackend === "mlx" ? path.join(modelsRoot, "moss-tts-v15-mlx") : undefined
const f5ModelDir = path.join(modelsRoot, "f5-tts-pt-br")
const vocosModelDir = path.join(modelsRoot, "vocos-mel-24khz")

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.stdio ?? "pipe"
  })

  if (result.status !== 0) {
    const stderr = result.stderr?.trim()
    const message = stderr ? `${command} ${args.join(" ")} failed: ${stderr}` : `${command} ${args.join(" ")} failed`
    throw new Error(message)
  }

  return result.stdout?.trim() ?? ""
}

mkdirSync(localRoot, { recursive: true })
mkdirSync(modelsRoot, { recursive: true })
mkdirSync(downloadsRoot, { recursive: true })
mkdirSync(qwen06bModelDir, { recursive: true })
mkdirSync(qwen17bModelDir, { recursive: true })
mkdirSync(qwen17bBaseModelDir, { recursive: true })
mkdirSync(chatterboxModelDir, { recursive: true })
if (mossTtsModelDir) mkdirSync(mossTtsModelDir, { recursive: true })
mkdirSync(f5ModelDir, { recursive: true })
mkdirSync(vocosModelDir, { recursive: true })

console.log(`DreamReader install target: ${installPlatform.label} (${installPlatform.arch})`)
console.log(`TTS backend: ${installBackend}`)

installStandalonePython()
ensureFfmpegStatic()

const version = run(pythonExecutable, ["--version"])
console.log(version)

writeModelReadme(
  qwen06bModelDir,
  [
    `Qwen3-TTS 0.6B ${installBackend.toUpperCase()} local model folder.`,
    "",
    "Put the downloaded model files here, or select another local Qwen3-TTS 0.6B folder in the app.",
    installBackend === "mlx"
      ? "Suggested source: mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit or another mlx-audio compatible Qwen3-TTS conversion."
      : "Suggested source: Qwen/Qwen3-TTS-12Hz-0.6B-Base or another PyTorch-compatible Qwen3-TTS conversion for this backend."
  ]
)
writeModelReadme(
  qwen17bModelDir,
  [
    `Qwen3-TTS 1.7B VoiceDesign ${installBackend.toUpperCase()} local model folder.`,
    "",
    "Put the downloaded model files here, or select another local Qwen3-TTS 1.7B VoiceDesign folder in the app.",
    installBackend === "mlx"
      ? "Suggested source: mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit or another mlx-audio compatible Qwen3-TTS conversion."
      : "Suggested source: Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign or another PyTorch-compatible Qwen3-TTS conversion for this backend."
  ]
)
writeModelReadme(
  qwen17bBaseModelDir,
  [
    `Qwen3-TTS 1.7B Base ${installBackend.toUpperCase()} local model folder.`,
    "",
    "Put the downloaded model files here, or select another local Qwen3-TTS 1.7B Base folder in the app.",
    installBackend === "mlx"
      ? "Suggested source: mlx-community/Qwen3-TTS-12Hz-1.7B-Base-4bit for voice cloning with reference audio and transcript."
      : "Suggested source: Qwen/Qwen3-TTS-12Hz-1.7B-Base or another PyTorch-compatible Qwen3-TTS conversion for this backend."
  ]
)
writeModelReadme(
  chatterboxModelDir,
  [
    `Chatterbox Multilingual ${installBackend.toUpperCase()} local model folder.`,
    "",
    installBackend === "mlx"
      ? "Put mlx-community/chatterbox-fp16 files here, or select another mlx-audio compatible Chatterbox folder in the app."
      : "Put ResembleAI/chatterbox files here, or select another PyTorch-compatible Chatterbox folder in the app.",
    "This model supports Portuguese via lang_code=pt and exposes emotion exaggeration/CFG controls."
  ]
)
if (mossTtsModelDir) {
  writeModelReadme(
    mossTtsModelDir,
    [
      "MOSS-TTS-v1.5 MLX local model folder.",
      "",
      "Put OpenMOSS-Team/MOSS-TTS-v1.5 files here for inference through mlx-audio on Apple Silicon.",
      "The model supports Portuguese language tags, zero-shot voice cloning, and explicit [pause X.Ys] markers."
    ]
  )
}
writeModelReadme(
  f5ModelDir,
  [
    "F5-TTS PT-BR local model folder.",
    "",
    "Put firstpixel/F5-TTS-pt-br files here, including model_last.safetensors or another .safetensors checkpoint.",
    "For synthesis without a cloned voice binding, also place reference.wav and reference.txt in this folder."
  ]
)
writeModelReadme(
  vocosModelDir,
  [
    "Vocos 24kHz vocoder folder used by F5-TTS.",
    "",
    "Put charactr/vocos-mel-24khz files here, including config.yaml and pytorch_model.bin."
  ]
)

console.log("Python TTS setup complete.")
console.log(`Platform: ${installPlatform.id}`)
console.log(`Backend: ${installBackend}`)
console.log(`Python executable: ${path.relative(projectRoot, pythonExecutable)}`)
console.log(`Qwen3-TTS 0.6B folder: ${path.relative(projectRoot, qwen06bModelDir)}`)
console.log(`Qwen3-TTS 1.7B VoiceDesign folder: ${path.relative(projectRoot, qwen17bModelDir)}`)
console.log(`Qwen3-TTS 1.7B Base folder: ${path.relative(projectRoot, qwen17bBaseModelDir)}`)
console.log(`Chatterbox Multilingual folder: ${path.relative(projectRoot, chatterboxModelDir)}`)
if (mossTtsModelDir) console.log(`MOSS-TTS-v1.5 folder: ${path.relative(projectRoot, mossTtsModelDir)}`)
console.log(`F5-TTS PT-BR folder: ${path.relative(projectRoot, f5ModelDir)}`)
console.log(`F5-TTS Vocos folder: ${path.relative(projectRoot, vocosModelDir)}`)
if (installSidecars) {
  installPythonDependencies()
} else {
  console.log("Install Python sidecar dependencies explicitly when you are ready:")
  console.log(`  npm run setup:python-tts -- --backend=${installBackend} --install-sidecars`)
}

function writeModelReadme(directory, lines) {
  writeFileSync(path.join(directory, "README.txt"), [...lines, "", "This folder is intentionally ignored by git."].join("\n"))
}

function installStandalonePython() {
  if (existsSync(pythonExecutable) && run(pythonExecutable, ["--version"]).startsWith("Python 3.12.")) {
    console.log(`Standalone Python 3.12 already exists at ${path.relative(projectRoot, pythonDir)}`)
    return
  }

  const target = installPlatform.pythonTarget
  console.log(`Finding CPython 3.12 standalone build for ${target}`)
  const asset = findStandalonePythonAsset(target)
  const archivePath = path.join(downloadsRoot, asset.name)
  const extractDir = path.join(downloadsRoot, "python-extract")
  rmSync(extractDir, { force: true, recursive: true })
  mkdirSync(extractDir, { recursive: true })

  if (!existsSync(archivePath)) {
    console.log(`Downloading ${asset.name}`)
    run("curl", ["-L", "--globoff", "--fail", "--silent", "--show-error", "-o", archivePath, asset.browser_download_url], { stdio: "inherit" })
  } else {
    console.log(`Using cached ${path.relative(projectRoot, archivePath)}`)
  }

  if (existsSync(pythonDir)) {
    const backupPath = path.join(localRoot, `python-backup-${Date.now()}`)
    console.log(`Moving existing Python runtime to ${path.relative(projectRoot, backupPath)}`)
    renameSync(pythonDir, backupPath)
  }

  run("tar", ["-xzf", archivePath, "-C", extractDir], { stdio: "inherit" })
  const extractedPythonDir = path.join(extractDir, "python")
  if (!existsSync(extractedPythonDir)) {
    throw new Error("Standalone Python archive did not contain a python/ directory")
  }
  renameSync(extractedPythonDir, pythonDir)
  ensurePythonExecutable()
  rmSync(extractDir, { force: true, recursive: true })
}

function findStandalonePythonAsset(target) {
  const releasesJson = run("curl", [
    "-L",
    "--globoff",
    "--fail",
    "--silent",
    "--show-error",
    "https://api.github.com/repos/astral-sh/python-build-standalone/releases?per_page=1"
  ])
  const releases = JSON.parse(releasesJson)
  const assets = releases.flatMap((release) => release.assets ?? [])
  const asset = assets.find((item) => {
    const name = String(item.name ?? "")
    return (
      name.startsWith("cpython-3.12.") &&
      name.includes(target) &&
      name.endsWith("install_only_stripped.tar.gz") &&
      !name.includes("freethreaded") &&
      !name.includes("debug")
    )
  })
  if (!asset?.browser_download_url) {
    throw new Error(`Could not find a CPython 3.12 standalone asset for ${target}`)
  }
  return asset
}

function ensurePythonExecutable() {
  if (existsSync(pythonExecutable)) {
    return
  }
  const python3Executable = pythonExecutableCandidates(localRoot, installPlatform).find((candidate) => existsSync(candidate))
  if (!python3Executable) {
    throw new Error("Standalone Python did not provide bin/python or bin/python3")
  }
  if (process.platform === "win32") {
    throw new Error("Standalone Python did not provide python.exe")
  }
  symlinkSync(path.basename(python3Executable), pythonExecutable)
}

function ensureFfmpegStatic() {
  if (!ffmpegStaticPath || !existsSync(ffmpegStaticPath)) {
    console.log("FFmpeg static binary was not found. Run npm install before audio conversion tests.")
    return
  }
  console.log(`FFmpeg static binary: ${path.relative(projectRoot, ffmpegStaticPath)}`)
}

function installPythonDependencies() {
  for (const step of pipInstallPlanForBackend(installBackend, projectRoot)) {
    console.log(`Installing ${step.label}`)
    run(pythonExecutable, step.args, { stdio: "inherit" })
  }
}
