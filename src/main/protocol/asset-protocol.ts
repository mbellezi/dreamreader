import { readFile } from "node:fs/promises"
import { protocol } from "electron"
import { eq } from "drizzle-orm"
import type { AppDatabase } from "@main/db/client"
import { assets } from "@main/db/schema"

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

    return new Response(await readFile(asset.path), {
      headers: {
        "content-type": asset.mimeType,
        "cache-control": "private, max-age=86400"
      }
    })
  })

  registered = true
}
