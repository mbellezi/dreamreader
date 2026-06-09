import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { Readable } from "node:stream"
import { protocol } from "electron"
import { eq } from "drizzle-orm"
import type { AppDatabase } from "@main/db/client"
import { assets } from "@main/db/schema"
import { parseSingleByteRange } from "@main/protocol/byte-range"

let registered = false

export function registerAssetProtocol(db: AppDatabase): void {
  if (registered) {
    return
  }

  protocol.handle("dreamreader", async (request) => {
    const url = new URL(request.url)
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
