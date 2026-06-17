#!/usr/bin/env node
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import { chmod, copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import https from "node:https"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import JSZip from "jszip"

const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const vendorDir = path.join(repoRoot, "vendor", "readium")
const downloadDir = path.join(vendorDir, ".downloads")
const releaseVersion = "v0.8.0"
const releaseBaseUrl = `https://github.com/readium/cli/releases/download/${releaseVersion}`

const targets = {
  "darwin-arm64": {
    asset: "readium_darwin_arm64.tar.gz",
    sha256: "640174ce14c81c66ae3122cd72fcf6ffcdd8aa2d97bc86a4643a5e8ad6b3ff0c",
    executable: "readium"
  },
  "darwin-x86_64": {
    asset: "readium_darwin_x86_64.tar.gz",
    sha256: "7e935981b4a6ec8253eb4dcdf3e18eb8f748760184e2f1e3254c0ce8b59bab6d",
    executable: "readium"
  },
  "linux-arm64": {
    asset: "readium_linux_arm64.tar.gz",
    sha256: "d4e96bc40185dd25f41233ecbb15f1a90844b9bbb4ae41e6738267b8a6cc2eca",
    executable: "readium"
  },
  "linux-armv7": {
    asset: "readium_linux_armv7.tar.gz",
    sha256: "bab56d1ae4cb3596c72f633fdb4d3912d69b0f0621a4851ba977cde9a00b49ce",
    executable: "readium"
  },
  "linux-i386": {
    asset: "readium_linux_i386.tar.gz",
    sha256: "6f7d4b6323bc2081acee1fd21bbaab1dd3e2934d89e5a5782d83007a6741a410",
    executable: "readium"
  },
  "linux-x86_64": {
    asset: "readium_linux_x86_64.tar.gz",
    sha256: "564933174cfc37f8237be9b5112daef2cbe8a43c79d7d7a88d5027d04b361299",
    executable: "readium"
  },
  "win32-arm64": {
    asset: "readium_windows_arm64.zip",
    sha256: "8893d762b4917548ec697c6edf234ca668a2c5d64a96bff808d9cc5ca563f6b0",
    executable: "readium.exe"
  },
  "win32-i386": {
    asset: "readium_windows_i386.zip",
    sha256: "7ee6d6a6c71dcb34a7da53fae382e3ff031c36c77b703a33fa5f7472366c899f",
    executable: "readium.exe"
  },
  "win32-x86_64": {
    asset: "readium_windows_x86_64.zip",
    sha256: "4b7d0f3938bf78b349a415288df83bed6278fcb1b1493888f8379dc39c1c8fa3",
    executable: "readium.exe"
  }
}

const targetKeys = process.argv.includes("--all") ? Object.keys(targets) : [currentTargetKey()]

await mkdir(downloadDir, { recursive: true })
for (const targetKey of targetKeys) {
  const target = targets[targetKey]
  if (!target) {
    throw new Error(`Unsupported platform target: ${targetKey}`)
  }
  await installTarget(targetKey, target)
}

async function installTarget(targetKey, target) {
  const archivePath = path.join(downloadDir, target.asset)
  const targetDir = path.join(vendorDir, targetKey)
  const outputPath = path.join(targetDir, target.executable)
  const url = `${releaseBaseUrl}/${target.asset}`

  console.log(`Downloading ${target.asset}`)
  await downloadFile(url, archivePath)
  await verifySha256(archivePath, target.sha256)
  await rm(targetDir, { force: true, recursive: true })
  await mkdir(targetDir, { recursive: true })

  if (target.asset.endsWith(".zip")) {
    await extractZipExecutable(archivePath, outputPath, target.executable)
  } else {
    await extractTarExecutable(archivePath, outputPath, target.executable)
  }

  if (!target.executable.endsWith(".exe")) {
    await chmod(outputPath, 0o755)
  }
  console.log(`Installed ${targetKey} Readium CLI at ${path.relative(repoRoot, outputPath)}`)
}

async function downloadFile(url, outputPath, redirects = 0) {
  await new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        if (redirects > 5) {
          reject(new Error(`Too many redirects while downloading ${url}`))
          return
        }
        downloadFile(new URL(response.headers.location, url).toString(), outputPath, redirects + 1).then(resolve, reject)
        return
      }

      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`Download failed for ${url}: HTTP ${response.statusCode}`))
        return
      }

      const file = createWriteStream(outputPath)
      response.pipe(file)
      file.on("finish", () => file.close(resolve))
      file.on("error", reject)
    })
    request.on("error", reject)
  })
}

async function verifySha256(filePath, expected) {
  const actual = createHash("sha256").update(await readFile(filePath)).digest("hex")
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${path.basename(filePath)}. Expected ${expected}, got ${actual}`)
  }
}

async function extractZipExecutable(archivePath, outputPath, executable) {
  const zip = await JSZip.loadAsync(await readFile(archivePath))
  const executableEntry = Object.values(zip.files).find((entry) => !entry.dir && path.basename(entry.name) === executable)
  if (!executableEntry) {
    throw new Error(`Executable ${executable} not found in ${path.basename(archivePath)}`)
  }
  await writeFile(outputPath, await executableEntry.async("nodebuffer"))
}

async function extractTarExecutable(archivePath, outputPath, executable) {
  const extractDir = path.join(downloadDir, `${path.basename(archivePath)}.extract`)
  await rm(extractDir, { force: true, recursive: true })
  await mkdir(extractDir, { recursive: true })
  await execFileAsync("tar", ["-xzf", archivePath, "-C", extractDir])
  const executablePath = await findFileByBaseName(extractDir, executable)
  if (!executablePath) {
    throw new Error(`Executable ${executable} not found in ${path.basename(archivePath)}`)
  }
  await copyFile(executablePath, outputPath)
  await rm(extractDir, { force: true, recursive: true })
}

async function findFileByBaseName(dir, basename) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = await findFileByBaseName(entryPath, basename)
      if (nested) {
        return nested
      }
      continue
    }
    if (entry.name === basename) {
      return entryPath
    }
  }
  return undefined
}

function currentTargetKey() {
  return `${process.platform}-${normalizedArch()}`
}

function normalizedArch() {
  if (process.arch === "x64") return "x86_64"
  if (process.arch === "ia32") return "i386"
  if (process.arch === "arm") return "armv7"
  return process.arch
}
