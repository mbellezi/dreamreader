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
import type { ReaderChapter, ReaderManifest } from "@main/services/library-service"
import type { ReadiumWebPublicationManifest } from "@main/services/readium-manifest-adapter"

let registered = false
const epubCache = new Map<string, Promise<JSZip>>()
const epubProfile = "https://readium.org/webpub-manifest/profiles/epub"
const positionListMimeType = "application/vnd.readium.position-list+json"
const webPublicationManifestMimeType = "application/webpub+json"

type JsonRecord = Record<string, unknown>

type PublicationProtocolBook = {
  id: string
  fileType: string
  title: string
  authors?: string[] | null
  language?: string | null
  libraryPath: string
  manifestJson: Record<string, unknown>
}

export type PublicationPositionList = {
  total: number
  positions: Array<{
    href: string
    type: string
    title?: string
    locations: {
      position: number
      progression: number
      totalProgression: number
    }
  }>
}

export function registerAssetProtocol(db: AppDatabase): void {
  if (registered) {
    return
  }

  protocol.handle("dreamreader", async (request) => {
    if (request.method === "OPTIONS") {
      return corsPreflightResponse(request)
    }

    const url = new URL(request.url)
    if (url.hostname === "book-resource") {
      return serveBookResource(db, request, url)
    }

    if (url.hostname === "publication") {
      return servePublication(db, request, url)
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
        ...corsHeadersForRequest(request),
        "content-type": asset.mimeType,
      }
    })
  })

  registered = true
}

async function servePublication(db: AppDatabase, request: Request, url: URL): Promise<Response> {
  const parts = url.pathname.split("/").filter(Boolean).map(decodePathSafely)
  const bookId = parts[0]
  const route = parts[1]
  if (!bookId || !route) {
    return new Response("Not found", { status: 404 })
  }

  const book = await db.query.books.findFirst({
    where: eq(books.id, bookId)
  })
  if (!book) {
    return new Response("Not found", { status: 404 })
  }

  if (route === "manifest.json" && parts.length === 2) {
    return serveJson(request, createPublicationManifest(book), webPublicationManifestMimeType)
  }

  if (route === "positions.json" && parts.length === 2) {
    return serveJson(request, await createPublicationPositionsForBook(book), positionListMimeType)
  }

  if (route === "resource") {
    const resourcePath = normalizePublicationResourcePath(parts.slice(2).join("/"))
    if (!resourcePath) {
      return new Response("Not found", { status: 404 })
    }
    return servePublicationResource(book, request, resourcePath)
  }

  return new Response("Not found", { status: 404 })
}

async function servePublicationResource(
  book: PublicationProtocolBook,
  request: Request,
  resourcePath: string
): Promise<Response> {
  if (book.fileType === "epub") {
    const mimeType = mimeTypeForPublicationResourcePath(resourcePath)
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
    const normalizedContent = isPublicationHtmlMimeType(mimeType)
      ? normalizeEpubPublicationHtml(buffer.toString("utf8"))
      : undefined
    return serveBuffer(
      request,
      normalizedContent ? Buffer.from(normalizedContent, "utf8") : buffer,
      mimeType,
      securityHeadersForEpubMimeType(mimeType)
    )
  }

  const manifest = book.manifestJson as ReaderManifest
  const chapter = findManifestChapter(manifest, resourcePath)
  if (!chapter) {
    return new Response("Not found", { status: 404 })
  }

  const mimeType = mimeTypeForPublicationResourcePath(resourcePath, chapter.mediaType)
  if (!mimeType) {
    return new Response("Unsupported media type", { status: 415 })
  }

  const content = mimeType === "text/html"
    ? normalizeVirtualPublicationHtml(chapter.content, chapter.title)
    : chapter.content

  return serveBuffer(request, Buffer.from(content, "utf8"), mimeType, securityHeadersForMimeType(mimeType))
}

async function serveBookResource(db: AppDatabase, request: Request, url: URL): Promise<Response> {
  const parts = url.pathname.split("/").filter(Boolean).map(decodePathSafely)
  const bookId = parts.shift()
  const resourcePath = normalizePublicationResourcePath(parts.join("/"))
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

  return serveBuffer(request, await file.async("nodebuffer"), mimeType)
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

export function normalizePublicationResourcePath(value: string): string | undefined {
  const decoded = decodePathSafely(splitPublicationHref(value).path).replace(/\\/g, "/").replace(/^\/+/, "")
  if (!decoded || decoded.includes("\0")) {
    return undefined
  }
  const segments = decoded.split("/")
  if (segments.some((segment) => segment === "..")) {
    return undefined
  }
  const normalized = path.posix.normalize(decoded).replace(/^\/+/, "")
  if (!normalized || normalized === "." || normalized.startsWith("../")) {
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

export function mimeTypeForPublicationResourcePath(filePath: string, fallbackMimeType?: string): string | undefined {
  const extension = path.extname(splitPublicationHref(filePath).path).toLocaleLowerCase("en-US")
  if (extension === ".xhtml" || extension === ".xht") return "application/xhtml+xml"
  if (extension === ".html" || extension === ".htm") return "text/html"
  if (extension === ".css") return "text/css"
  if (extension === ".txt") return "text/plain"
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg"
  if (extension === ".png") return "image/png"
  if (extension === ".gif") return "image/gif"
  if (extension === ".webp") return "image/webp"
  if (extension === ".svg" || extension === ".svgz") return "image/svg+xml"
  if (extension === ".avif") return "image/avif"
  if (extension === ".bmp") return "image/bmp"
  if (extension === ".woff") return "font/woff"
  if (extension === ".woff2") return "font/woff2"
  if (extension === ".ttf") return "font/ttf"
  if (extension === ".otf") return "font/otf"
  if (extension === ".eot") return "application/vnd.ms-fontobject"

  const fallback = cleanMimeType(fallbackMimeType)
  return fallback && isSupportedPublicationMimeType(fallback) ? fallback : undefined
}

export function createPublicationManifest(book: PublicationProtocolBook): ReadiumWebPublicationManifest {
  const readerManifest = book.manifestJson as ReaderManifest
  const readiumManifest = book.fileType === "epub" ? storedReadiumManifest(readerManifest) : undefined
  const publicationManifest = readiumManifest
    ? rewriteReadiumManifest(readiumManifest, book.id)
    : createVirtualPublicationManifest(book, readerManifest)
  return withPublicationManifestDefaults(publicationManifest, book, readerManifest) as ReadiumWebPublicationManifest
}

export function createPublicationPositions(bookId: string, manifest: ReaderManifest): PublicationPositionList {
  const chapters = Array.isArray(manifest.chapters) ? manifest.chapters : []
  const positions = chapters.flatMap((chapter, index) => {
    const href = publicationResourceUrl(bookId, chapter.href || chapter.id, { includeFragment: false })
    const type = mimeTypeForPublicationResourcePath(chapter.href || chapter.id, chapter.mediaType)
    if (!href || !type) {
      return []
    }

    return [
      {
        href,
        type,
        title: chapter.title,
        locations: {
          position: index + 1,
          progression: 0,
          totalProgression: clampProgression(chapter.progressionStart, index / Math.max(chapters.length, 1))
        }
      }
    ]
  })

  return {
    total: positions.length,
    positions
  }
}

export function normalizeVirtualPublicationHtml(content: string, title = ""): string {
  const trimmed = content.trim()
  const metadata = [
    `<meta charset="utf-8">`,
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(virtualPublicationContentSecurityPolicy())}">`,
    title ? `<title>${escapeHtml(title)}</title>` : ""
  ].join("")

  if (!/<html(?:\s|>)/i.test(trimmed)) {
    return `<!doctype html><html><head>${metadata}</head><body>${content}</body></html>`
  }

  let html = /^<!doctype/i.test(trimmed) ? trimmed : `<!doctype html>${trimmed}`

  if (/<head(?:\s|>)/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, `<head$1>${metadata}`)
  } else {
    html = html.replace(/<html([^>]*)>/i, `<html$1><head>${metadata}</head>`)
  }

  if (!/<body(?:\s|>)/i.test(html)) {
    html = html.replace(/<\/head>/i, "</head><body>")
    html = html.replace(/<\/html>\s*$/i, "</body></html>")
  }

  return html
}

export function normalizeEpubPublicationHtml(content: string): string | undefined {
  if (content.includes("data-dreamreader-cover-fit") || !isCoverLikeEpubHtml(content)) {
    return undefined
  }

  const style = [
    '<style data-dreamreader-cover-fit="true">',
    "html,body{height:100%;}",
    "body{box-sizing:border-box;margin:0!important;padding:0!important;}",
    "body>.cover:first-child{box-sizing:border-box;display:flex!important;align-items:center;justify-content:center;min-height:100vh;width:100%;margin:0!important;padding:0!important;break-inside:avoid;page-break-inside:avoid;}",
    "body>.cover:first-child img{display:block;width:auto!important;height:auto!important;max-width:100vw!important;max-height:100vh!important;object-fit:contain;}",
    "</style>"
  ].join("")

  if (/<head(?:\s|>)/i.test(content)) {
    return content.replace(/<head([^>]*)>/i, `<head$1>${style}`)
  }

  if (/<html(?:\s|>)/i.test(content)) {
    return content.replace(/<html([^>]*)>/i, `<html$1><head>${style}</head>`)
  }

  return `${style}${content}`
}

function isPublicationHtmlMimeType(mimeType: string): boolean {
  const clean = cleanMimeType(mimeType)
  return clean === "text/html" || clean === "application/xhtml+xml"
}

function isCoverLikeEpubHtml(content: string): boolean {
  if (!/<img(?:\s|>)/i.test(content)) {
    return false
  }

  const bodyOpen = content.match(/<body\b[^>]*>/i)?.[0] ?? ""
  const bodyContent = content.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? content
  const hasCoverMarker =
    /\bepub:type\s*=\s*["'][^"']*(?:cover|frontmatter)[^"']*["']/i.test(bodyOpen) ||
    /\bclass\s*=\s*["'][^"']*\bcover\b[^"']*["']/i.test(bodyContent) ||
    /\bsrc\s*=\s*["'][^"']*(?:cover|title|capa)[^"']*\.(?:jpe?g|png|webp|gif|svg)[^"']*["']/i.test(bodyContent)
  if (!hasCoverMarker) {
    return false
  }

  const visibleText = bodyContent
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&(?:nbsp|#160);/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
  return visibleText.length <= 120
}

async function createPublicationPositionsForBook(book: PublicationProtocolBook): Promise<PublicationPositionList> {
  const manifest = book.manifestJson as ReaderManifest
  const readiumManifest = book.fileType === "epub" ? storedReadiumManifest(manifest) : undefined
  const manifestPositions = readiumManifest
    ? createPublicationPositionsFromReadiumManifest(book.id, readiumManifest)
    : undefined
  if (manifestPositions) {
    return manifestPositions
  }

  const readiumPositions = readiumManifest ? await readStoredReadiumPositions(book, manifest) : undefined
  return (
    readiumPositions ??
    createPublicationPositions(book.id, manifest)
  )
}

async function readStoredReadiumPositions(
  book: PublicationProtocolBook,
  manifest: ReaderManifest
): Promise<PublicationPositionList | undefined> {
  const readiumManifest = storedReadiumManifest(manifest)
  const positionHref = readiumManifest ? findReadiumPositionListHref(readiumManifest) : undefined
  const resourcePath = positionHref ? localPublicationResourcePathFromHref(positionHref)?.resourcePath : undefined
  if (!resourcePath) {
    return undefined
  }

  const info = await stat(book.libraryPath).catch(() => undefined)
  if (!info?.isFile()) {
    return undefined
  }

  const zip = await loadEpub(book.libraryPath)
  const file = findZipFile(zip, resourcePath)
  if (!file) {
    return undefined
  }

  try {
    const json = JSON.parse(await file.async("text")) as unknown
    return normalizeReadiumPositionList(book.id, json)
  } catch {
    return undefined
  }
}

function serveJson(request: Request, data: unknown, mimeType: string): Response {
  return serveBuffer(
    request,
    Buffer.from(JSON.stringify(data), "utf8"),
    mimeType,
    {
      "cache-control": "private, max-age=300"
    }
  )
}

function serveBuffer(
  request: Request,
  buffer: Buffer,
  mimeType: string,
  extraHeaders: Record<string, string> = {}
): Response {
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
  const body = request.method === "HEAD" ? null : bufferToArrayBuffer(chunk)
  const contentLength = range ? end - start + 1 : sizeBytes
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=86400",
      "content-length": String(contentLength),
      ...(range ? { "content-range": `bytes ${start}-${end}/${sizeBytes}` } : {}),
      ...corsHeadersForRequest(request),
      "content-type": mimeType,
      "x-content-type-options": "nosniff",
      ...extraHeaders
    }
  })
}

function corsPreflightResponse(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeadersForRequest(request),
      "access-control-allow-methods": "GET, HEAD, OPTIONS",
      "access-control-allow-headers": request.headers.get("access-control-request-headers") ?? "Range, Content-Type",
      "access-control-max-age": "600"
    }
  })
}

export function corsHeadersForRequest(request: Request): Record<string, string> {
  const origin = request.headers.get("origin")
  const allowedOrigin = origin ? allowedCorsOrigin(origin) : undefined
  if (!allowedOrigin) {
    return {}
  }
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-expose-headers": "Accept-Ranges, Content-Length, Content-Range, Content-Type",
    "vary": "Origin"
  }
}

function allowedCorsOrigin(origin: string): string | undefined {
  if (origin === "null") {
    return origin
  }

  try {
    const url = new URL(origin)
    if (url.protocol === "file:" || url.protocol === "dreamreader:") {
      return origin
    }
    if ((url.protocol === "http:" || url.protocol === "https:") && isLocalhost(url.hostname)) {
      return origin
    }
  } catch {
    return undefined
  }

  return undefined
}

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]"
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  const body = new ArrayBuffer(buffer.byteLength)
  new Uint8Array(body).set(buffer)
  return body
}

function createVirtualPublicationManifest(book: PublicationProtocolBook, manifest: ReaderManifest): JsonRecord {
  const chapters = Array.isArray(manifest.chapters) ? manifest.chapters : []
  const tableOfContents = Array.isArray(manifest.tableOfContents) ? manifest.tableOfContents : []
  const readingOrder = chapters.flatMap((chapter) => {
    const link = chapterToPublicationLink(book.id, chapter)
    return link ? [link] : []
  })
  const toc = tableOfContents.flatMap((entry) => {
    const href = publicationResourceUrl(book.id, entry.href)
    return href ? [{ href, title: entry.title }] : []
  })

  return {
    metadata: publicationMetadata(book, manifest),
    readingOrder,
    resources: coverPublicationLinks(book.id, manifest),
    toc
  }
}

function publicationMetadata(book: PublicationProtocolBook, manifest: ReaderManifest): JsonRecord {
  const metadata: JsonRecord = {
    title: manifest.title || book.title,
    language: manifest.language || book.language || "pt-BR"
  }
  const manifestAuthors = Array.isArray(manifest.authors) ? manifest.authors : []
  const authors = manifestAuthors.length ? manifestAuthors : book.authors ?? []
  if (authors.length) {
    metadata.author = authors.map((name) => ({ name }))
  }
  if (book.fileType === "epub") {
    metadata.conformsTo = [epubProfile]
  }
  return metadata
}

function chapterToPublicationLink(bookId: string, chapter: ReaderChapter): JsonRecord | undefined {
  const href = publicationResourceUrl(bookId, chapter.href || chapter.id, { includeFragment: false })
  const type = mimeTypeForPublicationResourcePath(chapter.href || chapter.id, chapter.mediaType)
  if (!href || !type) {
    return undefined
  }
  return {
    href,
    type,
    title: chapter.title
  }
}

function coverPublicationLinks(bookId: string, manifest: ReaderManifest): JsonRecord[] {
  const cover = manifest.cover
  const href = cover?.href ? publicationResourceUrl(bookId, cover.href) : undefined
  if (!cover || !href) {
    return []
  }
  return [
    {
      href,
      type: cover.mediaType,
      rel: "cover"
    }
  ]
}

function rewriteReadiumManifest(manifest: ReadiumWebPublicationManifest, bookId: string): JsonRecord {
  const next = cloneJsonRecord(manifest as JsonRecord)
  for (const key of ["links", "readingOrder", "resources", "toc"]) {
    if (key in next) {
      next[key] = rewritePublicationLinkCollection(next[key], bookId, { includeFragment: key !== "readingOrder" })
    }
  }
  return next
}

function withPublicationManifestDefaults(
  manifest: JsonRecord,
  book: PublicationProtocolBook,
  readerManifest: ReaderManifest
): JsonRecord {
  const metadata = isJsonRecord(manifest.metadata)
    ? { ...publicationMetadata(book, readerManifest), ...manifest.metadata }
    : publicationMetadata(book, readerManifest)
  if (book.fileType === "epub") {
    metadata.conformsTo = withConformsTo(metadata.conformsTo, epubProfile)
  }

  return {
    ...manifest,
    metadata,
    links: publicationTopLinks(book.id, manifest.links)
  }
}

function publicationTopLinks(bookId: string, existingLinks: unknown): JsonRecord[] {
  const links = arrayifyRecords(existingLinks).filter(
    (link) => !linkHasRel(link, "self") && !isPositionListLink(link)
  )
  return [
    {
      href: publicationManifestUrl(bookId),
      type: webPublicationManifestMimeType,
      rel: "self"
    },
    {
      href: publicationPositionsUrl(bookId),
      type: positionListMimeType,
      rel: "positions"
    },
    ...links
  ]
}

function rewritePublicationLinkCollection(
  value: unknown,
  bookId: string,
  options: { includeFragment: boolean } = { includeFragment: true }
): JsonRecord[] {
  return arrayifyRecords(value).flatMap((link) => {
    const rewritten = rewritePublicationLink(link, bookId, options)
    return rewritten ? [rewritten] : []
  })
}

function rewritePublicationLink(
  link: JsonRecord,
  bookId: string,
  options: { includeFragment: boolean }
): JsonRecord | undefined {
  const next: JsonRecord = { ...link }
  if (typeof link.href === "string") {
    const href = rewritePublicationHref(link.href, link, bookId, options)
    if (!href) {
      return undefined
    }
    next.href = href
  }
  for (const key of ["children", "alternate"]) {
    if (Array.isArray(link[key])) {
      next[key] = rewritePublicationLinkCollection(link[key], bookId, options)
    }
  }
  return next
}

function rewritePublicationHref(
  href: string,
  link: JsonRecord,
  bookId: string,
  options: { includeFragment: boolean }
): string | undefined {
  if (linkHasRel(link, "self") || cleanMimeType(link.type) === webPublicationManifestMimeType) {
    return publicationManifestUrl(bookId)
  }
  if (isPositionListLink(link)) {
    return publicationPositionsUrl(bookId)
  }
  if (href.startsWith("dreamreader://")) {
    return href
  }
  if (hasExternalScheme(href)) {
    return undefined
  }
  return publicationResourceUrl(bookId, href, options)
}

function normalizeReadiumPositionList(bookId: string, value: unknown): PublicationPositionList | undefined {
  if (!isJsonRecord(value) || !Array.isArray(value.positions)) {
    return undefined
  }

  const positions = value.positions.flatMap((item) => {
    if (!isJsonRecord(item) || typeof item.href !== "string") {
      return []
    }
    const href = publicationResourceUrl(bookId, item.href, { includeFragment: false })
    const type = typeof item.type === "string"
      ? cleanMimeType(item.type)
      : mimeTypeForPublicationResourcePath(item.href)
    if (!href || !type) {
      return []
    }
    const locations = isJsonRecord(item.locations) ? item.locations : {}
    const position = positiveNumber(locations.position)
    if (!position) {
      return []
    }
    return [
      {
        href,
        type,
        title: typeof item.title === "string" ? item.title : undefined,
        locations: {
          position,
          progression: clampProgression(locations.progression, 0),
          totalProgression: clampProgression(locations.totalProgression, 0)
        }
      }
    ]
  })

  if (!positions.length) {
    return undefined
  }

  return {
    total: positions.length,
    positions
  }
}

function findReadiumPositionListHref(manifest: ReadiumWebPublicationManifest): string | undefined {
  return arrayifyRecords((manifest as JsonRecord).links)
    .find(isPositionListLink)
    ?.href as string | undefined
}

export function createPublicationPositionsFromReadiumManifest(
  bookId: string,
  manifest: ReadiumWebPublicationManifest
): PublicationPositionList | undefined {
  const readingOrder = arrayifyRecords((manifest as JsonRecord).readingOrder)
  const positions = readingOrder.flatMap((item, index) => {
    if (typeof item.href !== "string") {
      return []
    }
    const href = publicationResourceUrl(bookId, item.href, { includeFragment: false })
    const type = cleanMimeType(item.type) ?? mimeTypeForPublicationResourcePath(item.href)
    if (!href || !type) {
      return []
    }

    return [
      {
        href,
        type,
        title: typeof item.title === "string" ? item.title : undefined,
        locations: {
          position: index + 1,
          progression: 0,
          totalProgression: clampProgression(index / Math.max(readingOrder.length, 1), 0)
        }
      }
    ]
  })

  return positions.length ? { total: positions.length, positions } : undefined
}

function findManifestChapter(manifest: ReaderManifest, resourcePath: string): ReaderChapter | undefined {
  const normalizedPath = normalizePublicationResourcePath(resourcePath)
  if (!normalizedPath || !Array.isArray(manifest.chapters)) {
    return undefined
  }
  return manifest.chapters.find((chapter) => {
    return chapterResourcePath(chapter.href) === normalizedPath || chapterResourcePath(chapter.id) === normalizedPath
  })
}

function chapterResourcePath(href: string): string | undefined {
  return localPublicationResourcePathFromHref(href)?.resourcePath ?? normalizePublicationResourcePath(href)
}

function publicationManifestUrl(bookId: string): string {
  return `dreamreader://publication/${encodeURIComponent(bookId)}/manifest.json`
}

function publicationPositionsUrl(bookId: string): string {
  return `dreamreader://publication/${encodeURIComponent(bookId)}/positions.json`
}

function publicationResourceUrl(
  bookId: string,
  href: string,
  options: { includeFragment?: boolean } = {}
): string | undefined {
  if (href.startsWith("dreamreader://publication/")) {
    return options.includeFragment === false ? href.split("#")[0] : href
  }
  const localResource = localPublicationResourcePathFromHref(href)
  if (!localResource) {
    return undefined
  }
  const resourceUrl = `dreamreader://publication/${encodeURIComponent(bookId)}/resource/${encodeResourcePath(localResource.resourcePath)}`
  return options.includeFragment !== false && localResource.fragment
    ? `${resourceUrl}#${encodeURIComponent(decodePathSafely(localResource.fragment))}`
    : resourceUrl
}

function localPublicationResourcePathFromHref(href: string): { resourcePath: string; fragment?: string } | undefined {
  const { path: hrefPath, fragment } = splitPublicationHref(href)
  const scheme = hrefPath.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLocaleLowerCase("en-US")
  if (scheme === "file") {
    return undefined
  }
  if (scheme === "dreamreader") {
    try {
      const url = new URL(href)
      if (url.hostname !== "publication") {
        return undefined
      }
      const parts = url.pathname.split("/").filter(Boolean).map(decodePathSafely)
      const resourceIndex = parts.indexOf("resource")
      const resourcePath = resourceIndex >= 0
        ? normalizePublicationResourcePath(parts.slice(resourceIndex + 1).join("/"))
        : undefined
      return resourcePath ? { resourcePath, fragment: url.hash ? decodePathSafely(url.hash.slice(1)) : fragment } : undefined
    } catch {
      return undefined
    }
  }
  if (scheme) {
    return undefined
  }

  const resourcePath = normalizePublicationResourcePath(hrefPath)
  return resourcePath ? { resourcePath, fragment } : undefined
}

function splitPublicationHref(href: string): { path: string; fragment?: string } {
  const hashIndex = href.indexOf("#")
  const withoutFragment = hashIndex >= 0 ? href.slice(0, hashIndex) : href
  const fragment = hashIndex >= 0 ? href.slice(hashIndex + 1) : undefined
  const queryIndex = withoutFragment.indexOf("?")
  return {
    path: queryIndex >= 0 ? withoutFragment.slice(0, queryIndex) : withoutFragment,
    fragment
  }
}

function encodeResourcePath(resourcePath: string): string {
  return resourcePath.split("/").map(encodeURIComponent).join("/")
}

function hasExternalScheme(href: string): boolean {
  const scheme = href.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLocaleLowerCase("en-US")
  return Boolean(scheme && scheme !== "file" && scheme !== "dreamreader")
}

function cleanMimeType(value: unknown): string | undefined {
  return typeof value === "string"
    ? value.split(";")[0].trim().toLocaleLowerCase("en-US") || undefined
    : undefined
}

function isSupportedPublicationMimeType(mimeType: string): boolean {
  return (
    mimeType === "text/html" ||
    mimeType === "application/xhtml+xml" ||
    mimeType === "text/css" ||
    mimeType === "text/plain" ||
    mimeType.startsWith("image/") ||
    mimeType.startsWith("font/") ||
    mimeType === "application/vnd.ms-fontobject" ||
    mimeType === "application/font-woff" ||
    mimeType === "application/font-woff2" ||
    mimeType === "application/x-font-ttf" ||
    mimeType === "application/x-font-opentype"
  )
}

function securityHeadersForMimeType(mimeType: string): Record<string, string> {
  if (mimeType !== "text/html" && mimeType !== "application/xhtml+xml" && mimeType !== "image/svg+xml") {
    return {}
  }
  return {
    "content-security-policy": [
      "default-src 'self' dreamreader: data: blob:",
      "script-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "img-src 'self' dreamreader: data: blob:",
      "style-src 'self' dreamreader: 'unsafe-inline'",
      "font-src 'self' dreamreader: data: blob:"
    ].join("; ")
  }
}

function securityHeadersForEpubMimeType(mimeType: string): Record<string, string> {
  if (isPublicationHtmlMimeType(mimeType)) {
    return {}
  }
  return securityHeadersForMimeType(mimeType)
}

function virtualPublicationContentSecurityPolicy(): string {
  return [
    "default-src 'self' dreamreader: data: blob:",
    "script-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "img-src 'self' dreamreader: data: blob:",
    "style-src 'self' dreamreader: 'unsafe-inline'",
    "font-src 'self' dreamreader: data: blob:"
  ].join("; ")
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;")
}

function storedReadiumManifest(manifest: ReaderManifest): ReadiumWebPublicationManifest | undefined {
  const readiumManifest = (manifest as { readiumManifest?: unknown }).readiumManifest
  return isJsonRecord(readiumManifest) ? readiumManifest as ReadiumWebPublicationManifest : undefined
}

function withConformsTo(value: unknown, profile: string): string[] {
  const profiles = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? [value]
      : []
  return profiles.includes(profile) ? profiles : [...profiles, profile]
}

function linkHasRel(link: JsonRecord, rel: string): boolean {
  const value = link.rel
  return Array.isArray(value)
    ? value.includes(rel)
    : value === rel
}

function isPositionListLink(link: JsonRecord): boolean {
  return linkHasRel(link, "positions") || cleanMimeType(link.type) === positionListMimeType
}

function arrayifyRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isJsonRecord) : []
}

function cloneJsonRecord(value: JsonRecord): JsonRecord {
  return JSON.parse(JSON.stringify(value)) as JsonRecord
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

function clampProgression(value: unknown, fallback: number): number {
  const numberValue = typeof value === "number" && Number.isFinite(value) ? value : fallback
  return Math.min(1, Math.max(0, numberValue))
}
