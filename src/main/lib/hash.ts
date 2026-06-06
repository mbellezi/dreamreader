import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"

export async function hashFile(filePath: string): Promise<string> {
  const data = await readFile(filePath)
  return hashBuffer(data)
}

export function hashBuffer(buffer: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(buffer).digest("hex")
}

