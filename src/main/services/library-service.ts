import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { eq } from "drizzle-orm"
import { XMLParser } from "fast-xml-parser"
import JSZip from "jszip"
import { marked } from "marked"
import { AppDatabase } from "@main/db/client"
import { annotations, assets, bookmarks, books, readingPositions, settings } from "@main/db/schema"
import { AppPaths } from "@main/lib/paths"
import { hashBuffer, hashFile } from "@main/lib/hash"
import { createId } from "@main/lib/ids"
import { AppError } from "@main/lib/errors"
import { SettingsSchema } from "@shared/contracts/settings"

export type ReaderChapter = {
  id: string
  href: string
  title: string
  content: string
  mediaType: string
  progressionStart: number
  progressionEnd: number
}

export type ReaderManifest = {
  format: string
  title: string
  authors: string[]
  language: string
  chapters: ReaderChapter[]
  tableOfContents: Array<{ href: string; title: string }>
  cover?: {
    href: string
    mediaType: string
    assetId?: string
  }
}

export type ImportResult = {
  imported: unknown[]
  skipped: Array<{ path: string; reason: "duplicate" | "unsupported_type" | "invalid_file" | "failed"; existingBookId?: string }>
}

type EpubManifestItem = {
  id: string
  href: string
  mediaType: string
  properties?: string
}

type AnnotationRow = typeof annotations.$inferSelect
type BookRow = typeof books.$inferSelect

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "text"
})

const navigationParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "#text"
})

export class LibraryService {
  constructor(
    private readonly db: AppDatabase,
    private readonly paths: AppPaths
  ) {}

  async importFiles(filePaths: string[]): Promise<ImportResult> {
    await this.ensureDirectories()
    const importedBooks: unknown[] = []
    const skippedItems: ImportResult["skipped"] = []

    for (const filePath of filePaths) {
      const parsed = path.parse(filePath)
      const fileType = normalizeFileType(parsed.ext)
      if (!fileType) {
        skippedItems.push({ path: filePath, reason: "unsupported_type" })
        continue
      }

      try {
        const contentHash = await hashFile(filePath)
        const existing = await this.db.query.books.findFirst({
          where: eq(books.contentHash, contentHash)
        })
        if (existing) {
          const manifest = await this.extractManifest(filePath, fileType, parsed.name)
          importedBooks.push(toBookContract(await this.refreshExistingBook(existing, filePath, manifest)))
          continue
        }

        const manifest = await this.extractManifest(filePath, fileType, parsed.name)
        const bookId = createId("book")
        const libraryPath = path.join(this.paths.booksDir, `${contentHash}.${fileType}`)
        await copyFile(filePath, libraryPath)

        const [inserted] = await this.db
          .insert(books)
          .values({
            id: bookId,
            contentHash,
            fileType,
            title: manifest.title,
            authors: manifest.authors,
            language: manifest.language,
            originalPath: filePath,
            libraryPath,
            manifestJson: manifest
          })
          .returning()

        const coverAsset = manifest.cover ? await this.storeEpubCover(filePath, bookId, manifest.cover) : undefined
        const bookRow = coverAsset
          ? (
            await this.db
              .update(books)
              .set({
                coverAssetId: coverAsset.id,
                manifestJson: {
                  ...manifest,
                  cover: {
                    ...manifest.cover,
                    assetId: coverAsset.id
                  }
                },
                updatedAt: new Date()
              })
              .where(eq(books.id, inserted.id))
              .returning()
          )[0]
          : inserted

        importedBooks.push(toBookContract(bookRow))
      } catch (error) {
        skippedItems.push({
          path: filePath,
          reason: error instanceof AppError && error.code === "invalid_epub" ? "invalid_file" : "failed"
        })
      }
    }

    return { imported: importedBooks, skipped: skippedItems }
  }

  private async refreshExistingBook(
    existing: typeof books.$inferSelect,
    filePath: string,
    manifest: ReaderManifest
  ): Promise<typeof books.$inferSelect> {
    const coverAsset = manifest.cover ? await this.storeEpubCover(filePath, existing.id, manifest.cover) : undefined
    const nextManifest = coverAsset
      ? {
        ...manifest,
        cover: {
          ...manifest.cover,
          assetId: coverAsset.id
        }
      }
      : manifest
    const [updated] = await this.db
      .update(books)
      .set({
        title: manifest.title,
        authors: manifest.authors,
        language: manifest.language,
        originalPath: filePath,
        coverAssetId: coverAsset?.id ?? existing.coverAssetId,
        manifestJson: nextManifest,
        updatedAt: new Date()
      })
      .where(eq(books.id, existing.id))
      .returning()
    return updated
  }

  async listBooks(query?: string): Promise<{ books: unknown[]; total: number }> {
    const rows = await this.db.query.books.findMany({
      orderBy: (table, { desc }) => [desc(table.lastOpenedAt), desc(table.addedAt)]
    })
    const positions = await this.db.query.readingPositions.findMany()
    const positionByBookId = new Map(positions.map((position) => [position.bookId, position]))
    const normalized = query?.trim().toLocaleLowerCase("pt-BR")
    if (!normalized) {
      return { books: rows.map((book) => toBookContract(book, positionByBookId.get(book.id))), total: rows.length }
    }
    const filtered = rows.filter((book) => {
      const haystack = [book.title, book.subtitle, ...(book.authors ?? []), book.language]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("pt-BR")
      return haystack.includes(normalized)
    })
    return { books: filtered.map((book) => toBookContract(book, positionByBookId.get(book.id))), total: filtered.length }
  }

  async updateBookMetadata(input: {
    bookId: string
    title?: string
    subtitle?: string | null
    authors?: Array<{ name: string }>
    language?: string | null
    publisher?: string | null
    publishedAt?: string | null
    description?: string | null
    coverAssetId?: string | null
  }) {
    await this.getBook(input.bookId)
    const values: Partial<typeof books.$inferInsert> = {
      updatedAt: new Date()
    }

    if (input.title !== undefined) values.title = input.title
    if (input.subtitle !== undefined) values.subtitle = input.subtitle
    if (input.authors !== undefined) values.authors = input.authors.map((author) => author.name)
    if (input.language !== undefined) values.language = input.language ?? "pt-BR"
    if (input.publisher !== undefined) values.publisher = input.publisher
    if (input.publishedAt !== undefined) values.publishedAt = input.publishedAt
    if (input.description !== undefined) values.description = input.description
    if (input.coverAssetId !== undefined) values.coverAssetId = input.coverAssetId

    const [updated] = await this.db.update(books).set(values).where(eq(books.id, input.bookId)).returning()
    if (!updated) {
      throw new AppError("book_not_found", "Book not found")
    }
    return toBookContract(updated)
  }

  async openBook(bookId: string) {
    const book = await this.getBook(bookId)
    const manifest = book.manifestJson as ReaderManifest
    await this.db.update(books).set({ lastOpenedAt: new Date() }).where(eq(books.id, bookId))
    const position = await this.db.query.readingPositions.findFirst({
      where: eq(readingPositions.bookId, bookId)
    })
    const bookAnnotations = await this.db.query.annotations.findMany({
      where: eq(annotations.bookId, bookId),
      orderBy: (table, { desc }) => [desc(table.createdAt)]
    })
    const bookBookmarks = await this.db.query.bookmarks.findMany({
      where: eq(bookmarks.bookId, bookId),
      orderBy: (table, { desc }) => [desc(table.createdAt)]
    })

    return {
      bookId,
      position: position ? toReadingPositionContract(position) : undefined,
      tableOfContents: manifest.tableOfContents,
      manifest: toReaderManifestContract(manifest),
      annotations: bookAnnotations.filter((item) => !item.deletedAt).map(toAnnotationContract),
      bookmarks: bookBookmarks.map(toBookmarkContract),
      book: toBookContract(book, position)
    }
  }

  async getResource(input: { bookId: string; href: string }) {
    const book = await this.getBook(input.bookId)
    const manifest = book.manifestJson as ReaderManifest
    const chapter = manifest.chapters.find((item) => item.href === input.href || item.id === input.href)
    if (!chapter) {
      throw new AppError("resource_not_found", "Book resource not found")
    }
    return {
      bookId: input.bookId,
      href: chapter.href,
      mimeType: chapter.mediaType,
      content: chapter.content,
      encoding: "utf8" as const
    }
  }

  async saveReadingPosition(input: {
    bookId: string
    locator: Record<string, unknown>
    chapterHref?: string
    progression: number
  }) {
    await this.getBook(input.bookId)
    const existing = await this.db.query.readingPositions.findFirst({
      where: eq(readingPositions.bookId, input.bookId)
    })
    const value = {
      locatorJson: input.locator,
      chapterHref: input.chapterHref,
      progression: input.progression,
      updatedAt: new Date()
    }
    if (existing) {
      const [updated] = await this.db
        .update(readingPositions)
        .set(value)
        .where(eq(readingPositions.id, existing.id))
        .returning()
      return toReadingPositionContract(updated)
    }
    const [created] = await this.db
      .insert(readingPositions)
      .values({
        id: createId("pos"),
        bookId: input.bookId,
        ...value
      })
      .returning()
    return toReadingPositionContract(created)
  }

  async createAnnotation(input: {
    bookId: string
    locator: Record<string, unknown>
    quote: string
    color: string
    note?: string
    tags?: string[]
  }) {
    await this.getBook(input.bookId)
    const [created] = await this.db
      .insert(annotations)
      .values({
        id: createId("ann"),
        bookId: input.bookId,
        locatorJson: input.locator,
        quote: input.quote,
        color: input.color,
        note: input.note ?? "",
        tags: input.tags ?? []
      })
      .returning()
    return toAnnotationContract(created)
  }

  async updateAnnotation(input: {
    id: string
    color?: string
    note?: string | null
    tags?: string[]
    deleted?: boolean
  }) {
    const [updated] = await this.db
      .update(annotations)
      .set({
        color: input.color,
        note: input.note ?? undefined,
        tags: input.tags,
        deletedAt: input.deleted ? new Date() : undefined,
        updatedAt: new Date()
      })
      .where(eq(annotations.id, input.id))
      .returning()
    if (!updated) {
      throw new AppError("annotation_not_found", "Annotation not found")
    }
    return toAnnotationContract(updated)
  }

  async deleteAnnotation(id: string) {
    await this.updateAnnotation({ id, deleted: true })
    return { deleted: true as const }
  }

  async createBookmark(input: { bookId: string; locator: Record<string, unknown>; label?: string }) {
    await this.getBook(input.bookId)
    const [created] = await this.db
      .insert(bookmarks)
      .values({
        id: createId("mark"),
        bookId: input.bookId,
        locatorJson: input.locator,
        label: input.label ?? ""
      })
      .returning()
    return toBookmarkContract(created)
  }

  async exportAnnotations(input: { bookId?: string; format: "markdown" | "json"; includeDeleted: boolean }): Promise<string> {
    const rows = input.bookId
      ? await this.db.query.annotations.findMany({
        where: eq(annotations.bookId, input.bookId),
        orderBy: (table, { asc }) => [asc(table.createdAt)]
      })
      : await this.db.query.annotations.findMany({
        orderBy: (table, { asc }) => [asc(table.createdAt)]
      })
    const visible = input.includeDeleted ? rows : rows.filter((item) => !item.deletedAt)
    if (input.format === "json") {
      return JSON.stringify(visible.map(toAnnotationContract), null, 2)
    }

    const bookRows = input.bookId
      ? [await this.getBook(input.bookId)]
      : await this.db.query.books.findMany()
    return renderAnnotationsMarkdown(bookRows, visible, input.bookId)
  }

  async exportAnnotationsFileName(bookId?: string, format: "markdown" | "json" = "markdown"): Promise<string> {
    const book = bookId ? await this.getBook(bookId) : undefined
    const extension = format === "json" ? "json" : "md"
    const suffix = format === "json" ? "annotations" : "notas"
    const baseName = slugifyFileName(book ? `${book.title}-${suffix}` : `dreamreader-${suffix}`)
    return `${baseName}.${extension}`
  }

  async exportAnnotationsToFile(input: {
    bookId?: string
    format: "markdown" | "json"
    includeDeleted: boolean
    targetPath: string
  }): Promise<{ exported: true; filePath: string }> {
    const content = await this.exportAnnotations(input)
    await writeFile(input.targetPath, content, "utf8")
    return { exported: true, filePath: input.targetPath }
  }

  async getSettings() {
    const rows = await this.db.query.settings.findMany()
    return rowsToSettings(rows)
  }

  async updateSettings(values: Record<string, unknown>) {
    for (const key of ["ui", "reader", "library", "audio", "resources", "privacy"]) {
      const valueJson = values[key]
      if (!isJsonObject(valueJson)) {
        continue
      }
      await this.db
        .insert(settings)
        .values({ key, valueJson, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: settings.key,
          set: { valueJson, updatedAt: new Date() }
        })
    }
    return this.getSettings()
  }

  private async getBook(bookId: string) {
    const book = await this.db.query.books.findFirst({ where: eq(books.id, bookId) })
    if (!book) {
      throw new AppError("book_not_found", "Book not found")
    }
    return book
  }

  private async ensureDirectories() {
    await Promise.all([
      mkdir(this.paths.booksDir, { recursive: true }),
      mkdir(this.paths.coversDir, { recursive: true }),
      mkdir(this.paths.extractedDir, { recursive: true })
    ])
  }

  private async extractManifest(filePath: string, fileType: string, fallbackTitle: string): Promise<ReaderManifest> {
    if (fileType === "epub") {
      return this.extractEpub(filePath, fallbackTitle)
    }
    const raw = await readFile(filePath, "utf8")
    const title = fallbackTitle
    const content = fileType === "markdown" ? await marked.parse(raw) : toHtml(raw, fileType)
    return {
      format: fileType,
      title,
      authors: [],
      language: "pt-BR",
      chapters: [
        {
          id: "chapter-1",
          href: "chapter-1",
          title,
          content,
          mediaType: "text/html",
          progressionStart: 0,
          progressionEnd: 1
        }
      ],
      tableOfContents: [{ href: "chapter-1", title }]
    }
  }

  private async extractEpub(filePath: string, fallbackTitle: string): Promise<ReaderManifest> {
    const zip = await JSZip.loadAsync(await readFile(filePath))
    const containerFile = findZipFile(zip, "META-INF/container.xml")
    if (!containerFile) {
      throw new AppError("invalid_epub", "EPUB container not found")
    }
    const container = parser.parse(await containerFile.async("text"))
    const rootfile = first(rootfiles(container)?.rootfile) as Record<string, string> | undefined
    const rootfilePath = rootfile?.["full-path"]
    if (!rootfilePath) {
      throw new AppError("invalid_epub", "EPUB rootfile not found")
    }

    const opfFile = findZipFile(zip, rootfilePath)
    if (!opfFile) {
      throw new AppError("invalid_epub", "EPUB package not found")
    }
    const opf = parser.parse(await opfFile.async("text"))
    const metadata = opf?.package?.metadata ?? {}
    const manifestItems = arrayify<Record<string, string>>(opf?.package?.manifest?.item).map((item): EpubManifestItem => {
      return {
        id: item.id,
        href: item.href,
        mediaType: item["media-type"],
        properties: item.properties
      }
    })
    const itemById = new Map(manifestItems.map((item) => [item.id, item]))
    const spine = arrayify<Record<string, string>>(opf?.package?.spine?.itemref)
    const baseDir = path.posix.dirname(rootfilePath)
    const coverItem = findEpubCoverItem(metadata, manifestItems)
    const tocEntries = await this.extractEpubToc(zip, baseDir, manifestItems, String(opf?.package?.spine?.toc ?? ""))
    let chapters: ReaderChapter[] = []

    if (tocEntries.length) {
      chapters = await this.extractChaptersFromToc(zip, baseDir, tocEntries)
    }

    if (!chapters.length) {
      chapters = await this.extractChaptersFromSpine(zip, baseDir, spine, itemById, manifestItems)
    }

    if (!chapters.length) {
      throw new AppError("invalid_epub", "EPUB has no readable text chapters")
    }

    const title = textValue(metadata["dc:title"]) ?? fallbackTitle
    const creators = arrayify(metadata["dc:creator"]).map(textValue).filter(isString)
    const language = textValue(metadata["dc:language"]) ?? "pt-BR"
    return {
      format: "epub",
      title,
      authors: creators,
      language,
      chapters,
      tableOfContents: chapters.map((chapter) => ({ href: chapter.href, title: chapter.title })),
      cover: coverItem
        ? {
          href: resolveEpubPath(baseDir, coverItem.href),
          mediaType: coverItem.mediaType
        }
        : undefined
    }
  }

  private async extractChaptersFromSpine(
    zip: JSZip,
    baseDir: string,
    spine: Array<Record<string, string>>,
    itemById: Map<string, EpubManifestItem>,
    manifestItems: EpubManifestItem[]
  ): Promise<ReaderChapter[]> {
    const chapters: ReaderChapter[] = []
    const spineItems = spine
      .map((itemref) => itemById.get(itemref.idref))
      .filter((item): item is EpubManifestItem => Boolean(item && isHtmlMediaType(item.mediaType)))
    const readableItems = spineItems.length
      ? spineItems
      : manifestItems.filter((item) => isHtmlMediaType(item.mediaType))

    for (const [index, manifestItem] of readableItems.entries()) {
      const fullPath = resolveEpubPath(baseDir, manifestItem.href)
      const chapterFile = findZipFile(zip, fullPath)
      if (!chapterFile) {
        continue
      }
      const content = await chapterFile.async("text")
      const title = extractTitle(content) ?? manifestItem.id ?? `Capitulo ${index + 1}`
      chapters.push({
        id: manifestItem.id,
        href: fullPath,
        title,
        content,
        mediaType: manifestItem.mediaType,
        progressionStart: index / Math.max(readableItems.length, 1),
        progressionEnd: (index + 1) / Math.max(readableItems.length, 1)
      })
    }
    return chapters
  }

  private async extractEpubToc(
    zip: JSZip,
    baseDir: string,
    manifestItems: EpubManifestItem[],
    spineTocId: string
  ): Promise<Array<{ title: string; href: string }>> {
    const ncxItem =
      manifestItems.find((item) => item.id === spineTocId) ??
      manifestItems.find((item) => item.mediaType === "application/x-dtbncx+xml")
    if (!ncxItem) {
      return []
    }
    const ncxFile = findZipFile(zip, resolveEpubPath(baseDir, ncxItem.href))
    if (!ncxFile) {
      return []
    }
    const ncx = navigationParser.parse(await ncxFile.async("text"))
    const navPoints = flattenNavPoints(ncx?.ncx?.navMap?.navPoint)
    return navPoints
      .map((point) => ({
        title: navPointLabel(point),
        href: navPointHref(point)
      }))
      .filter((item) => item.title && item.href)
      .map((item) => ({
        title: item.title,
        href: normalizeEpubTocHref(baseDir, item.href)
      }))
  }

  private async extractChaptersFromToc(
    zip: JSZip,
    baseDir: string,
    tocEntries: Array<{ title: string; href: string }>
  ): Promise<ReaderChapter[]> {
    const chapters: ReaderChapter[] = []
    const htmlByPath = new Map<string, string>()

    for (const [index, entry] of tocEntries.entries()) {
      const parsed = splitHref(entry.href)
      const chapterFile = findZipFile(zip, parsed.filePath)
      if (!chapterFile || !isHtmlPath(parsed.filePath)) {
        continue
      }

      const html = htmlByPath.get(parsed.filePath) ?? await chapterFile.async("text")
      htmlByPath.set(parsed.filePath, html)
      const nextEntry = tocEntries.slice(index + 1).map((item) => splitHref(item.href)).find((item) => item.filePath === parsed.filePath)
      const startIndex = parsed.fragment ? findAnchorIndex(html, parsed.fragment) ?? 0 : bodyStartIndex(html)
      const endIndex = nextEntry?.fragment ? findAnchorIndex(html, nextEntry.fragment) ?? html.length : html.length
      const content = html.slice(startIndex, Math.max(startIndex, endIndex))

      if (!htmlToReadableText(content)) {
        continue
      }

      chapters.push({
        id: parsed.fragment ? `${parsed.filePath}#${parsed.fragment}` : parsed.filePath,
        href: parsed.fragment ? `${parsed.filePath}#${parsed.fragment}` : parsed.filePath,
        title: entry.title,
        content,
        mediaType: "application/xhtml+xml",
        progressionStart: index / Math.max(tocEntries.length, 1),
        progressionEnd: (index + 1) / Math.max(tocEntries.length, 1)
      })
    }
    return chapters
  }

  private async storeEpubCover(
    epubPath: string,
    bookId: string,
    cover: { href: string; mediaType: string }
  ): Promise<typeof assets.$inferSelect | undefined> {
    const zip = await JSZip.loadAsync(await readFile(epubPath))
    const coverFile = findZipFile(zip, cover.href)
    if (!coverFile) {
      return undefined
    }
    const buffer = await coverFile.async("nodebuffer")
    const contentHash = hashBuffer(buffer)
    const extension = extensionForMimeType(cover.mediaType) ?? (path.extname(cover.href).replace(".", "") || "bin")
    const coverPath = path.join(this.paths.coversDir, `${contentHash}.${extension}`)
    await writeFile(coverPath, buffer)
    const [asset] = await this.db
      .insert(assets)
      .values({
        id: createId("asset"),
        kind: "cover",
        bookId,
        path: coverPath,
        mimeType: cover.mediaType,
        contentHash,
        sizeBytes: buffer.byteLength
      })
      .returning()
    return asset
  }
}

function toHtml(raw: string, fileType: string): string {
  if (fileType === "html") {
    return raw
  }
  const escaped = raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replaceAll("\n", "<br />")}</p>`)
    .join("\n")
  return `<article>${escaped}</article>`
}

function findEpubCoverItem(metadata: Record<string, unknown>, manifestItems: EpubManifestItem[]): EpubManifestItem | undefined {
  const coverMeta = arrayify<Record<string, string>>(metadata.meta as Record<string, string> | Array<Record<string, string>> | undefined)
    .find((item) => item.name === "cover" && item.content)
  return (
    manifestItems.find((item) => item.id === coverMeta?.content) ??
    manifestItems.find((item) => item.properties?.split(/\s+/).includes("cover-image")) ??
    manifestItems.find((item) => item.id.toLocaleLowerCase("en-US").includes("cover") && item.mediaType?.startsWith("image/"))
  )
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

function resolveEpubPath(baseDir: string, href: string): string {
  const decodedHref = decodePathSafely(href)
  return path.posix.normalize(path.posix.join(baseDir, decodedHref)).replace(/^\/+/, "")
}

function normalizeEpubTocHref(baseDir: string, href: string): string {
  const [filePath, fragment] = href.split("#")
  const resolvedPath = resolveEpubPath(baseDir, filePath)
  return fragment ? `${resolvedPath}#${decodePathSafely(fragment)}` : resolvedPath
}

function splitHref(href: string): { filePath: string; fragment?: string } {
  const [filePath, fragment] = href.split("#")
  return {
    filePath,
    fragment
  }
}

function decodePathSafely(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function isHtmlMediaType(mediaType?: string): boolean {
  return Boolean(mediaType?.includes("html") || mediaType?.includes("xhtml"))
}

function isHtmlPath(filePath: string): boolean {
  return /\.(?:xhtml|html?|xml)$/i.test(filePath)
}

function flattenNavPoints(value: unknown): Array<Record<string, unknown>> {
  return arrayify(value as Record<string, unknown> | Array<Record<string, unknown>> | undefined).flatMap((point) => [
    point,
    ...flattenNavPoints(point.navPoint)
  ])
}

function navPointLabel(point: Record<string, unknown>): string {
  const navLabel = point.navLabel as Record<string, unknown> | undefined
  return textValue(navLabel?.text)?.trim() ?? ""
}

function navPointHref(point: Record<string, unknown>): string {
  const content = point.content as Record<string, unknown> | undefined
  return typeof content?.src === "string" ? content.src : ""
}

function findAnchorIndex(html: string, fragment: string): number | undefined {
  const escaped = escapeRegExp(decodePathSafely(fragment))
  const match = html.match(new RegExp(`<[^>]+\\s(?:id|name)=["']${escaped}["'][^>]*>`, "i"))
  return match?.index
}

function bodyStartIndex(html: string): number {
  const match = html.match(/<body[^>]*>/i)
  return match?.index === undefined ? 0 : match.index + match[0].length
}

function htmlToReadableText(html: string): string {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function extensionForMimeType(mimeType: string): string | undefined {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg"
  if (mimeType === "image/png") return "png"
  if (mimeType === "image/webp") return "webp"
  if (mimeType === "image/gif") return "gif"
  if (mimeType === "image/svg+xml") return "svg"
  return undefined
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function rootfiles(container: unknown): { rootfile?: unknown } | undefined {
  return (container as { container?: { rootfiles?: { rootfile?: unknown } } }).container?.rootfiles
}

function arrayify<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return []
  }
  return Array.isArray(value) ? value : [value]
}

function first<T>(value: T | T[] | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value
  }
  if (value && typeof value === "object" && "text" in value && typeof value.text === "string") {
    return value.text
  }
  return undefined
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function extractTitle(html: string): string | undefined {
  const title = html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1] ?? html.match(/<h1[^>]*>(.*?)<\/h1>/is)?.[1]
  return title?.replace(/<[^>]+>/g, "").trim()
}

export async function fileSize(filePath: string): Promise<number> {
  return (await stat(filePath)).size
}

export async function writeJsonAsset(filePath: string, data: unknown): Promise<string> {
  const json = JSON.stringify(data, null, 2)
  await writeFile(filePath, json)
  return hashBuffer(json)
}

function renderAnnotationsMarkdown(bookRows: BookRow[], annotationRows: AnnotationRow[], singleBookId?: string): string {
  const bookById = new Map(bookRows.map((book) => [book.id, book]))

  if (singleBookId) {
    const book = bookById.get(singleBookId)
    return book ? renderBookAnnotationsMarkdown(book, annotationRows, 1).join("\n") : "# DreamReader\n"
  }

  const lines = ["# Anotacoes DreamReader", ""]
  const annotationsByBook = groupByBook(annotationRows)
  for (const book of bookRows.filter((item) => annotationsByBook.has(item.id))) {
    lines.push(...renderBookAnnotationsMarkdown(book, annotationsByBook.get(book.id) ?? [], 2), "")
  }
  if (!annotationsByBook.size) {
    lines.push("_Nenhuma anotacao exportada._", "")
  }
  return lines.join("\n")
}

function renderBookAnnotationsMarkdown(book: BookRow, annotationRows: AnnotationRow[], titleLevel: 1 | 2): string[] {
  const manifest = book.manifestJson as ReaderManifest
  const sorted = sortAnnotationsForReading(annotationRows, manifest)
  const chapterHeading = "#".repeat(titleLevel + 1)
  const paragraphHeading = "#".repeat(titleLevel + 2)
  const lines = [
    `${"#".repeat(titleLevel)} ${singleLine(book.title)}`,
    "",
    `- **Livro:** ${singleLine(book.title)}`,
    `- **Autor(es):** ${formatAuthors(book.authors)}`,
    `- **Total de anotacoes:** ${sorted.length}`,
    `- **Exportado em:** ${new Date().toISOString()}`,
    ""
  ]

  if (!sorted.length) {
    lines.push("_Nenhuma anotacao exportada._", "")
    return lines
  }

  let currentChapter = ""
  for (const annotation of sorted) {
    const chapterHref = annotationChapterHref(annotation)
    if (chapterHref !== currentChapter) {
      currentChapter = chapterHref
      lines.push(`${chapterHeading} ${singleLine(chapterTitle(manifest, chapterHref))}`, "")
    }

    lines.push(`${paragraphHeading} ${paragraphLabel(annotation)}`, "")
    lines.push(`- **Tipo:** ${formatAnnotationKind(annotation.tags)}`)
    lines.push(`- **Criado em:** ${toIso(annotation.createdAt)}`)
    const displayTags = annotation.tags.filter((tag) => !["highlight", "note", "favorite"].includes(tag))
    if (displayTags.length) {
      lines.push(`- **Tags:** ${displayTags.map((tag) => `#${tag}`).join(" ")}`)
    }
    lines.push("", blockQuote(annotation.quote))
    if (annotation.note) {
      lines.push("", "**Nota:**", "", annotation.note.trim())
    }
    lines.push("")
  }

  return lines
}

function groupByBook(annotationRows: AnnotationRow[]): Map<string, AnnotationRow[]> {
  const grouped = new Map<string, AnnotationRow[]>()
  for (const annotation of annotationRows) {
    grouped.set(annotation.bookId, [...(grouped.get(annotation.bookId) ?? []), annotation])
  }
  return grouped
}

function sortAnnotationsForReading(annotationRows: AnnotationRow[], manifest: ReaderManifest): AnnotationRow[] {
  const chapterOrder = new Map<string, number>()
  manifest.chapters.forEach((chapter, index) => {
    chapterOrder.set(chapter.href, index)
    chapterOrder.set(chapter.id, index)
  })

  return [...annotationRows].sort((left, right) => {
    const leftChapter = chapterOrder.get(annotationChapterHref(left)) ?? Number.MAX_SAFE_INTEGER
    const rightChapter = chapterOrder.get(annotationChapterHref(right)) ?? Number.MAX_SAFE_INTEGER
    if (leftChapter !== rightChapter) {
      return leftChapter - rightChapter
    }

    const leftParagraph = annotationParagraphNumber(left) ?? Number.MAX_SAFE_INTEGER
    const rightParagraph = annotationParagraphNumber(right) ?? Number.MAX_SAFE_INTEGER
    if (leftParagraph !== rightParagraph) {
      return leftParagraph - rightParagraph
    }

    return toIso(left.createdAt).localeCompare(toIso(right.createdAt))
  })
}

function annotationChapterHref(annotation: AnnotationRow): string {
  const locator = annotation.locatorJson
  return typeof locator.href === "string" ? locator.href : ""
}

function annotationParagraphNumber(annotation: AnnotationRow): number | undefined {
  const locator = annotation.locatorJson
  const text = isJsonObject(locator.text) ? locator.text : undefined
  const index = typeof text?.anchorParagraphIndex === "number" ? text.anchorParagraphIndex : undefined
  return typeof index === "number" && Number.isFinite(index) ? index + 1 : undefined
}

function paragraphLabel(annotation: AnnotationRow): string {
  const paragraphNumber = annotationParagraphNumber(annotation)
  return paragraphNumber ? `Paragrafo ${paragraphNumber}` : "Paragrafo nao informado"
}

function chapterTitle(manifest: ReaderManifest, href: string): string {
  const chapter = manifest.chapters.find((item) => item.href === href || item.id === href)
  const toc = manifest.tableOfContents.find((item) => item.href === href)
  return chapter?.title ?? toc?.title ?? (href || "Capitulo sem identificacao")
}

function formatAuthors(authors: string[]): string {
  return authors.length ? authors.map(singleLine).join(", ") : "Autor desconhecido"
}

function formatAnnotationKind(tags: string[]): string {
  if (tags.includes("favorite")) {
    return "Favorito"
  }
  if (tags.includes("note")) {
    return "Nota"
  }
  return "Marcacao"
}

function blockQuote(text: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n")
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function slugifyFileName(value: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "dreamreader-notas"
}

function normalizeFileType(ext: string): "epub" | "txt" | "markdown" | "html" | undefined {
  const clean = ext.toLowerCase().replace(".", "")
  if (clean === "md" || clean === "markdown") {
    return "markdown"
  }
  if (clean === "htm" || clean === "html") {
    return "html"
  }
  if (clean === "epub" || clean === "txt") {
    return clean
  }
  return undefined
}

function toBookContract(book: typeof books.$inferSelect, position?: typeof readingPositions.$inferSelect) {
  const progress = Math.round((position?.progression ?? 0) * 100)

  return {
    id: book.id,
    contentHash: book.contentHash,
    fileType: book.fileType === "md" ? "markdown" : book.fileType,
    title: book.title,
    subtitle: optional(book.subtitle),
    authors: (book.authors ?? []).map((name) => ({ name })),
    language: book.language,
    publisher: optional(book.publisher),
    publishedAt: optional(book.publishedAt),
    description: optional(book.description),
    originalPath: optional(book.originalPath),
    libraryPath: book.libraryPath,
    coverAssetId: optional(book.coverAssetId),
    coverImageUrl: book.coverAssetId ? `dreamreader://asset/${encodeURIComponent(book.coverAssetId)}` : undefined,
    manifest: {
      ...((book.manifestJson ?? {}) as Record<string, unknown>),
      progress
    },
    addedAt: toIso(book.addedAt),
    updatedAt: toIso(book.updatedAt),
    lastOpenedAt: optionalDate(book.lastOpenedAt)
  }
}

function toReaderManifestContract(manifest: ReaderManifest) {
  return {
    tableOfContents: manifest.tableOfContents,
    metadata: {
      format: manifest.format,
      title: manifest.title,
      authors: manifest.authors,
      language: manifest.language
    },
    resources: manifest.chapters.map((chapter) => ({
      href: chapter.href,
      title: chapter.title,
      mediaType: chapter.mediaType,
      progressionStart: chapter.progressionStart,
      progressionEnd: chapter.progressionEnd
    })),
    raw: manifest as unknown as Record<string, unknown>
  }
}

function toReadingPositionContract(position: typeof readingPositions.$inferSelect) {
  return {
    id: position.id,
    bookId: position.bookId,
    locator: position.locatorJson,
    chapterHref: optional(position.chapterHref),
    progression: position.progression,
    audioPositionMs: position.audioPositionMs,
    updatedAt: toIso(position.updatedAt)
  }
}

function toAnnotationContract(annotation: typeof annotations.$inferSelect) {
  return {
    id: annotation.id,
    bookId: annotation.bookId,
    locator: annotation.locatorJson,
    quote: annotation.quote,
    color: annotation.color,
    note: optional(annotation.note),
    tags: annotation.tags,
    createdAt: toIso(annotation.createdAt),
    updatedAt: toIso(annotation.updatedAt),
    deletedAt: optionalDate(annotation.deletedAt)
  }
}

function toBookmarkContract(bookmark: typeof bookmarks.$inferSelect) {
  return {
    id: bookmark.id,
    bookId: bookmark.bookId,
    locator: bookmark.locatorJson,
    label: optional(bookmark.label),
    createdAt: toIso(bookmark.createdAt)
  }
}

function rowsToSettings(rows: Array<typeof settings.$inferSelect>) {
  const values = Object.fromEntries(rows.map((row) => [row.key, row.valueJson]))
  return SettingsSchema.parse({
    schemaVersion: "settings/v1",
    ui: values.ui ?? {},
    reader: values.reader ?? {},
    library: values.library ?? {},
    audio: values.audio ?? {},
    resources: values.resources ?? {},
    privacy: values.privacy ?? {}
  })
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}

function optionalDate(value: Date | string | null): string | undefined {
  return value ? toIso(value) : undefined
}

function optional<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
