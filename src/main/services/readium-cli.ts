import { access } from "node:fs/promises"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { ReadiumWebPublicationManifest } from "./readium-manifest-adapter"

const execFileAsync = promisify(execFile)

export type ReadiumManifestProvider = {
  manifest(filePath: string): Promise<ReadiumWebPublicationManifest>
}

export class ReadiumCliManifestProvider implements ReadiumManifestProvider {
  constructor(
    private readonly resourcesDir: string,
    private readonly env = process.env
  ) {}

  async manifest(filePath: string): Promise<ReadiumWebPublicationManifest> {
    const readiumPath = await this.resolveReadiumCliPath()
    const { stdout } = await execFileAsync(readiumPath, ["manifest", filePath], {
      maxBuffer: 64 * 1024 * 1024,
      timeout: 60_000
    })
    return JSON.parse(stdout) as ReadiumWebPublicationManifest
  }

  private async resolveReadiumCliPath(): Promise<string> {
    const candidates = readiumCliCandidates(this.resourcesDir, this.env.READIUM_BIN)
    for (const candidate of candidates) {
      try {
        await access(candidate)
        return candidate
      } catch {
        continue
      }
    }
    throw new Error(`Readium CLI not found. Checked: ${candidates.join(", ")}`)
  }
}

export function readiumCliCandidates(resourcesDir: string, explicitPath?: string): string[] {
  const platformKey = readiumPlatformKey()
  const executableName = process.platform === "win32" ? "readium.exe" : "readium"
  return [
    explicitPath,
    path.join(resourcesDir, "readium", platformKey, executableName),
    path.join(resourcesDir, "vendor", "readium", platformKey, executableName)
  ].filter((candidate): candidate is string => Boolean(candidate))
}

function readiumPlatformKey(): string {
  const arch = process.arch === "x64"
    ? "x86_64"
    : process.arch === "ia32"
      ? "i386"
      : process.arch === "arm"
        ? "armv7"
        : process.arch
  return `${process.platform}-${arch}`
}
