import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { eq } from "drizzle-orm"
import { XMLParser } from "fast-xml-parser"
import JSZip from "jszip"
import { marked } from "marked"
import { AppDatabase } from "@main/db/client"
import { annotations, bookmarks, books, readingPositions, settings } from "@main/db/schema"
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

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "text"
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
          skippedItems.push({ path: filePath, reason: "duplicate", existingBookId: existing.id })
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

        importedBooks.push(toBookContract(inserted))
      } catch (error) {
        skippedItems.push({
          path: filePath,
          reason: error instanceof AppError && error.code === "invalid_epub" ? "invalid_file" : "failed"
        })
      }
    }

    return { imported: importedBooks, skipped: skippedItems }
  }

  async listBooks(query?: string): Promise<{ books: unknown[]; total: number }> {
    const rows = await this.db.query.books.findMany({
      orderBy: (table, { desc }) => [desc(table.lastOpenedAt), desc(table.addedAt)]
    })
    const normalized = query?.trim().toLocaleLowerCase("pt-BR")
    if (!normalized) {
      return { books: rows.map(toBookContract), total: rows.length }
    }
    const filtered = rows.filter((book) => {
      const haystack = [book.title, book.subtitle, ...(book.authors ?? []), book.language]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("pt-BR")
      return haystack.includes(normalized)
    })
    return { books: filtered.map(toBookContract), total: filtered.length }
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
      book: toBookContract(book)
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
    const titleByBookId = new Map(bookRows.map((book) => [book.id, book.title]))
    const lines = [input.bookId ? `# ${titleByBookId.get(input.bookId) ?? "DreamReader"}` : "# Anotacoes DreamReader", ""]
    let currentBookId = ""
    for (const item of visible) {
      if (!input.bookId && item.bookId !== currentBookId) {
        currentBookId = item.bookId
        lines.push(`## ${titleByBookId.get(item.bookId) ?? item.bookId}`, "")
      }
      lines.push(`> ${item.quote}`)
      if (item.note) {
        lines.push("", item.note)
      }
      if (item.tags.length) {
        lines.push("", `Tags: ${item.tags.map((tag) => `#${tag}`).join(" ")}`)
      }
      lines.push("")
    }
    return lines.join("\n")
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
    const containerFile = zip.file("META-INF/container.xml")
    if (!containerFile) {
      throw new AppError("invalid_epub", "EPUB container not found")
    }
    const container = parser.parse(await containerFile.async("text"))
    const rootfile = first(rootfiles(container)?.rootfile) as Record<string, string> | undefined
    const rootfilePath = rootfile?.["full-path"]
    if (!rootfilePath) {
      throw new AppError("invalid_epub", "EPUB rootfile not found")
    }

    const opfFile = zip.file(rootfilePath)
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
    const chapters: ReaderChapter[] = []

    for (const [index, itemref] of spine.entries()) {
      const manifestItem = itemById.get(itemref.idref)
      if (!manifestItem || !manifestItem.mediaType?.includes("html")) {
        continue
      }
      const fullPath = path.posix.normalize(path.posix.join(baseDir, manifestItem.href))
      const chapterFile = zip.file(fullPath)
      if (!chapterFile) {
        continue
      }
      const content = await chapterFile.async("text")
      const title = extractTitle(content) ?? manifestItem.id ?? `Capitulo ${index + 1}`
      chapters.push({
        id: manifestItem.id,
        href: manifestItem.href,
        title,
        content,
        mediaType: manifestItem.mediaType,
        progressionStart: index / Math.max(spine.length, 1),
        progressionEnd: (index + 1) / Math.max(spine.length, 1)
      })
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
      tableOfContents: chapters.map((chapter) => ({ href: chapter.href, title: chapter.title }))
    }
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

function toBookContract(book: typeof books.$inferSelect) {
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
    manifest: (book.manifestJson ?? {}) as Record<string, unknown>,
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
