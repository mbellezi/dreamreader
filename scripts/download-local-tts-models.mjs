import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, "..")
const python = path.join(projectRoot, ".dreamreader-local", "python", "bin", "python")
const downloader = path.join(projectRoot, "scripts", "download-local-tts-models.py")

if (!existsSync(python)) {
  throw new Error("Local Python runtime not found. Run npm run setup:python-tts first.")
}

const result = spawnSync(python, [downloader, ...process.argv.slice(2)], {
  cwd: projectRoot,
  env: {
    ...process.env,
    HF_HOME: path.join(projectRoot, ".dreamreader-local", "huggingface")
  },
  stdio: "inherit"
})

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
