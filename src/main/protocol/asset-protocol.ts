import { createReadStream } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import { protocol } from "electron"
import { eq } from "drizzle-orm"
import JSZip from "jszip"
import type { AppDatabase } from "@main/db/client"
import { assets, books } from "@main/db/schema"
import { parseSingleByteRange } from "@main/protocol/byte-range"

let registered = false
const epubCache = new Map<string, Promise<JSZip>>()

export function registerAssetProtocol(db: AppDatabase): void {
  if (registered) {
    return
  }

  protocol.handle("dreamreader", async (request) => {
    const url = new URL(request.url)
    if (url.hostname === "book-resource") {
      return serveBookResource(db, request, url)
    }

    if (url.hostname !== "asset") {
      return new Response("Not found", { status: 404 })
    }

    const assetId = decodeURIComponent(url.pathname.replace(/^\/+/, ""))
    const asset = await db.query.assets.findFirst({
      where: eq(assets.id, assetId)
    })
    if (!asset) {
      return new Response("Not found", { status: 404 })
    }

    const info = await stat(asset.path).catch(() => undefined)
    if (!info?.isFile()) {
      return new Response("Not found", { status: 404 })
    }

    const sizeBytes = info.size
    const range = parseSingleByteRange(request.headers.get("range"), sizeBytes)
    if (range === "invalid") {
      return new Response(null, {
        status: 416,
        headers: {
          "accept-ranges": "bytes",
          "content-range": `bytes */${sizeBytes}`
        }
      })
    }

    const start = range?.start ?? 0
    const end = range?.end ?? Math.max(0, sizeBytes - 1)
    const contentLength = range ? end - start + 1 : sizeBytes
    const body =
      request.method === "HEAD"
        ? null
        : (Readable.toWeb(createReadStream(asset.path, range ? { start, end } : undefined)) as ReadableStream)

    return new Response(body, {
      status: range ? 206 : 200,
      headers: {
        "accept-ranges": "bytes",
        "cache-control": "private, max-age=86400",
        "content-length": String(contentLength),
        ...(range ? { "content-range": `bytes ${start}-${end}/${sizeBytes}` } : {}),
        "content-type": asset.mimeType,
      }
    })
  })

  registered = true
}

async function serveBookResource(db: AppDatabase, request: Request, url: URL): Promise<Response> {
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent)
  const bookId = parts.shift()
  const resourcePath = normalizeEpubResourcePath(parts.join("/"))
  if (!bookId || !resourcePath) {
    return new Response("Not found", { status: 404 })
  }

  const book = await db.query.books.findFirst({
    where: eq(books.id, bookId)
  })
  if (!book || book.fileType !== "epub") {
    return new Response("Not found", { status: 404 })
  }

  const mimeType = imageMimeTypeForPath(resourcePath)
  if (!mimeType) {
    return new Response("Unsupported media type", { status: 415 })
  }

  const info = await stat(book.libraryPath).catch(() => undefined)
  if (!info?.isFile()) {
    return new Response("Not found", { status: 404 })
  }

  const zip = await loadEpub(book.libraryPath)
  const file = findZipFile(zip, resourcePath)
  if (!file) {
    return new Response("Not found", { status: 404 })
  }

  const buffer = await file.async("nodebuffer")
  const sizeBytes = buffer.byteLength
  const range = parseSingleByteRange(request.headers.get("range"), sizeBytes)
  if (range === "invalid") {
    return new Response(null, {
      status: 416,
      headers: {
        "accept-ranges": "bytes",
        "content-range": `bytes */${sizeBytes}`
      }
    })
  }

  const start = range?.start ?? 0
  const end = range?.end ?? Math.max(0, sizeBytes - 1)
  const chunk = buffer.subarray(start, end + 1)
  let body: ArrayBuffer | null = null
  if (request.method !== "HEAD") {
    body = new ArrayBuffer(chunk.byteLength)
    new Uint8Array(body).set(chunk)
  }
  const contentLength = range ? end - start + 1 : sizeBytes
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=86400",
      "content-length": String(contentLength),
      ...(range ? { "content-range": `bytes ${start}-${end}/${sizeBytes}` } : {}),
      "content-type": mimeType,
      "x-content-type-options": "nosniff"
    }
  })
}

function loadEpub(filePath: string): Promise<JSZip> {
  const cached = epubCache.get(filePath)
  if (cached) {
    return cached
  }
  const loaded = readFile(filePath).then((buffer) => JSZip.loadAsync(buffer))
  epubCache.set(filePath, loaded)
  return loaded
}

function findZipFile(zip: JSZip, filePath: string) {
  const cleanPath = filePath.replace(/^\/+/, "")
  const candidates = new Set([
    cleanPath,
    path.posix.normalize(cleanPath),
    decodePathSafely(cleanPath),
    decodePathSafely(path.posix.normalize(cleanPath))
  ])

  for (const candidate of candidates) {
    const file = zip.file(candidate)
    if (file) {
      return file
    }
  }

  return null
}

function normalizeEpubResourcePath(value: string): string | undefined {
  const normalized = path.posix.normalize(decodePathSafely(value).replace(/\\/g, "/")).replace(/^\/+/, "")
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("\0")) {
    return undefined
  }
  return normalized
}

function decodePathSafely(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function imageMimeTypeForPath(filePath: string): string | undefined {
  const extension = path.extname(filePath).toLocaleLowerCase("en-US")
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg"
  if (extension === ".png") return "image/png"
  if (extension === ".gif") return "image/gif"
  if (extension === ".webp") return "image/webp"
  if (extension === ".svg") return "image/svg+xml"
  return undefined
}
