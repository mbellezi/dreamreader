import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { detectInstallPlatform, parseInstallBackend, pythonExecutablePath, resolveInstallBackend } from "./install-platform.mjs"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, "..")
const localRoot = path.join(projectRoot, ".dreamreader-local")
const installPlatform = detectInstallPlatform()
const installBackend = resolveInstallBackend(parseInstallBackend(process.argv.slice(2)), installPlatform)
const python = pythonExecutablePath(localRoot, installPlatform)
const downloader = path.join(projectRoot, "scripts", "download-local-tts-models.py")

if (!existsSync(python)) {
  throw new Error("Local Python runtime not found. Run npm run setup:python-tts first.")
}

const result = spawnSync(python, [downloader, `--backend=${installBackend}`, ...stripBackendArgs(process.argv.slice(2))], {
  cwd: projectRoot,
  env: {
    ...process.env,
    DREAMREADER_TTS_BACKEND: installBackend,
    HF_HOME: path.join(projectRoot, ".dreamreader-local", "huggingface")
  },
  stdio: "inherit"
})

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

function stripBackendArgs(args) {
  const stripped = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--backend") {
      index += 1
      continue
    }
    if (arg.startsWith("--backend=")) {
      continue
    }
    stripped.push(arg)
  }
  return stripped
}
