import { contextBridge, ipcRenderer } from "electron"
import { buildSaveLocatorRequest, type RendererLocator } from "@preload/locator"

type IpcSuccess<T> = { ok: true; data: T }
type IpcFailure = { ok: false; error: { code: string; message: string; details?: unknown } }
type IpcResult<T> = IpcSuccess<T> | IpcFailure

async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, payload)) as IpcResult<T>
  if (!result.ok) {
    throw Object.assign(new Error(result.error.message), {
      code: result.error.code,
      details: result.error.details
    })
  }
  return result.data
}

const api = {
  library: {
    importFiles: (filePaths?: string[]) => invoke("library.importFiles", { filePaths }),
    updateBookMetadata: (input: Record<string, unknown>) => invoke("library.updateBookMetadata", input),
    importBooks: async () => {
      const imported = await invoke<{ imported: unknown[]; skipped: unknown[] }>("library.importFiles", {})
      const result = await invoke<{ books: unknown[]; total: number }>("library.listBooks", {})
      return {
        books: result.books.map(toRendererBookSummary),
        importedCount: imported.imported.length,
        skipped: imported.skipped
      }
    },
    listBooks: async (query?: { search?: string } | string) => {
      const search = typeof query === "string" ? query : query?.search
      const result = await invoke<{ books: unknown[]; total: number }>("library.listBooks", { query: search })
      return result.books.map(toRendererBookSummary)
    },
    getBook: async (bookId: string) => {
      const opened = await invoke<Record<string, unknown>>("reader.openBook", { bookId })
      const book = toRendererBookSummary(opened.book)
      const toc = toArray(opened.tableOfContents)
      const chapters = await Promise.all(
        toc.map(async (item, index) => {
          const entry = item as Record<string, unknown>
          const href = String(entry.href ?? `chapter-${index + 1}`)
          const resource = await invoke<{ content: string }>("reader.getResource", { bookId, href })
          return {
            id: href,
            title: String(entry.title ?? `Capitulo ${index + 1}`),
            position: index + 1,
            text: htmlToPlainText(resource.content)
          }
        })
      )
      const position = (opened.position ?? {}) as Record<string, unknown>
      const locator = (position.locator ?? {}) as Record<string, unknown>
      return {
        ...book,
        publisher: optionalString((opened.book as Record<string, unknown> | undefined)?.publisher),
        description: optionalString((opened.book as Record<string, unknown> | undefined)?.description),
        lastChapterId: optionalString(position.chapterHref) ?? optionalString(locator.href),
        lastPosition: toRendererLocator(bookId, position),
        chapters
      }
    }
  },
  reader: {
    saveProgress: async (locator: RendererLocator) => invoke("reader.saveLocator", buildSaveLocatorRequest(locator)),
    openBook: (bookId: string) => invoke("reader.openBook", { bookId }),
    getResource: (bookId: string, href: string) => invoke("reader.getResource", { bookId, href }),
    saveLocator: (input: {
      bookId: string
      locator: Record<string, unknown>
      chapterHref?: string
      progression: number
    }) => invoke("reader.saveLocator", input)
  },
  annotations: {
    create: (input: {
      bookId: string
      locator: Record<string, unknown>
      quote: string
      color: string
      note?: string
      tags?: string[]
    }) => invoke("annotations.create", input),
    update: (input: { id: string; color?: string; note?: string; tags?: string[]; deleted?: boolean }) =>
      invoke("annotations.update", input),
    delete: (id: string) => invoke("annotations.delete", { id })
  },
  readerAnnotations: {
    listAnnotations: async (bookId: string) => {
      const opened = await invoke<{ annotations?: unknown[] }>("reader.openBook", { bookId })
      return (opened.annotations ?? []).map((annotation) => toRendererAnnotation(annotation))
    },
    createAnnotation: async (draft: {
      bookId: string
      chapterId: string
      kind: string
      color: string
      excerpt: string
      note: string
      anchorParagraphIndex?: number
      anchorTextOffset?: number
    }) => {
      // Strip undefined: locator.text crosses IPC as a JSON object contract that
      // rejects undefined values, so an undefined anchor would fail validation.
      const text = compact({
        anchorParagraphIndex: draft.anchorParagraphIndex,
        anchorTextOffset: draft.anchorTextOffset,
        anchorText: draft.excerpt
      })
      const created = await invoke("annotations.create", {
        bookId: draft.bookId,
        locator: Object.keys(text).length ? { href: draft.chapterId, text } : { href: draft.chapterId },
        quote: draft.excerpt,
        color: draft.color === "rose" ? "pink" : draft.color,
        note: draft.note,
        tags: [draft.kind]
      })
      return toRendererAnnotation(created, draft.kind, draft.chapterId)
    },
    updateAnnotation: async (draft: {
      id: string
      color?: string
      note?: string
    }) => {
      const updated = await invoke("annotations.update", {
        id: draft.id,
        color: draft.color === "rose" ? "pink" : draft.color,
        note: draft.note
      })
      return toRendererAnnotation(updated)
    },
    deleteAnnotation: (annotationId: string) => invoke("annotations.delete", { id: annotationId }),
    exportNotes: (bookId: string, format: "markdown" | "json") =>
      invoke<string>("annotations.export", { bookId, format })
  },
  bookmarks: {
    create: (input: { bookId: string; locator: Record<string, unknown>; label?: string }) =>
      invoke("bookmarks.create", input)
  },
  settings: {
    get: () => invoke("settings.get"),
    update: (values: Record<string, Record<string, unknown>>) => invoke("settings.update", values),
    getSettings: async () => toRendererSettings(await invoke("settings.get")),
    saveSettings: async (settings: {
      locale: string
      appearance: string
      reader: Record<string, unknown>
    }) => toRendererSettings(await invoke("settings.update", rendererSettingsToCanonical(settings)))
  },
  models: {
    list: () => invoke("models.list"),
    diagnostics: () => invoke("models.diagnostics"),
    installFromPath: (modelPath?: string) => invoke("models.installFromPath", modelPath ? { path: modelPath } : {}),
    download: (modelId: string) => invoke("models.download", { modelId })
  },
  tts: {
    enqueueChapter: (input: Record<string, unknown>) => invoke("tts.enqueueChapter", input),
    cancelJob: (id: string) => invoke("tts.cancelJob", { id }),
    retryJob: (id: string) => invoke("tts.retryJob", { id }),
    getJob: (id: string) => invoke("tts.getJob", { id }),
    listJobs: (filter?: { bookId?: string; engineId?: string }) => invoke("tts.listJobs", filter ?? {}),
    clearChapterAudio: (input: { bookId: string; chapterHref: string }) => invoke("tts.clearChapterAudio", input)
  },
  voices: {
    list: () => invoke("voices.list"),
    listCompatible: (engineId?: string) => invoke("voices.listCompatible", { engineId }),
    createFromReference: (input: Record<string, unknown>) => invoke("voices.createFromReference", input),
    preview: (voiceProfileId: string, engineId: string) => invoke("voices.preview", { voiceProfileId, engineId }),
    update: (input: Record<string, unknown>) => invoke("voices.update", input),
    delete: (voiceProfileId: string) => invoke("voices.delete", { voiceProfileId })
  },
  audiobook: {
    getExport: (bookId: string) => invoke("audiobook.getExport", { bookId }),
    enableAutoBuild: (bookId: string, enabled: boolean) =>
      invoke("audiobook.enableAutoBuild", { bookId, enabled }),
    rebuild: (bookId: string) => invoke("audiobook.rebuild", { bookId }),
    reveal: (bookId: string) => invoke("audiobook.reveal", { bookId })
  },
  pronunciation: {
    list: (input?: { bookId?: string; includeGlobal?: boolean }) => invoke("pronunciation.list", input ?? {}),
    create: (input: Record<string, unknown>) => invoke("pronunciation.create", input),
    update: (input: Record<string, unknown>) => invoke("pronunciation.update", input),
    delete: (id: string) => invoke("pronunciation.delete", { id })
  }
}

Object.assign(api.reader, api.readerAnnotations)

contextBridge.exposeInMainWorld("dreamreader", api)

export type DreamreaderApi = typeof api

function toRendererBookSummary(input: unknown) {
  const book = (input ?? {}) as Record<string, unknown>
  const authors = toArray(book.authors)
    .map((author) => {
      if (typeof author === "string") return author
      return String((author as Record<string, unknown>).name ?? "")
    })
    .filter(Boolean)
  const progress = Number(
    ((book.manifest as Record<string, unknown> | undefined)?.progress as number | undefined) ?? 0
  )
  return {
    id: String(book.id ?? ""),
    title: String(book.title ?? ""),
    authors,
    language: String(book.language ?? "pt-BR"),
    format: String(book.fileType ?? "epub") === "md" ? "markdown" : String(book.fileType ?? "epub"),
    status: progress > 0 ? "reading" : "unread",
    progress,
    tags: [],
    updatedAt: String(book.updatedAt ?? new Date().toISOString()),
    coverColor: colorFromId(String(book.id ?? book.title ?? "book")),
    coverImageUrl: optionalString(book.coverImageUrl)
  }
}

function toRendererAnnotation(input: unknown, fallbackKind = "highlight", fallbackChapterId = "chapter-1") {
  const annotation = (input ?? {}) as Record<string, unknown>
  const locator = (annotation.locator ?? {}) as Record<string, unknown>
  const text = (locator.text ?? {}) as Record<string, unknown>
  const tags = toArray(annotation.tags).map(String)
  return {
    id: String(annotation.id ?? ""),
    bookId: String(annotation.bookId ?? ""),
    chapterId: String(locator.href ?? fallbackChapterId),
    kind: tags.includes("favorite") ? "favorite" : tags.includes("note") ? "note" : fallbackKind,
    color: String(annotation.color ?? "yellow") === "pink" ? "rose" : String(annotation.color ?? "yellow"),
    excerpt: String(annotation.quote ?? ""),
    note: String(annotation.note ?? ""),
    createdAt: String(annotation.createdAt ?? new Date().toISOString()),
    anchorParagraphIndex: optionalNumber(text.anchorParagraphIndex),
    anchorTextOffset: optionalNumber(text.anchorTextOffset)
  }
}

function toRendererSettings(input: unknown) {
  const settings = (input ?? {}) as Record<string, unknown>
  const ui = (settings.ui ?? {}) as Record<string, unknown>
  const reader = (settings.reader ?? {}) as Record<string, unknown>
  return {
    locale: String(ui.locale ?? "pt-BR"),
    appearance: String(ui.theme ?? "light") === "system" ? "light" : String(ui.theme ?? "light"),
    reader: {
      theme: String(reader.theme ?? "light") === "high_contrast" ? "contrast" : String(reader.theme ?? "light"),
      fontFamily: String(reader.fontFamily ?? "georgia"),
      fontScale: Number(reader.fontSizePx ?? 18),
      columnWidth: Number(reader.columnWidthPx ?? 720),
      columnCount: Number(reader.columnCount ?? 1),
      lineHeight: Number(reader.lineHeight ?? 1.5),
      paragraphSpacing: Number(reader.paragraphSpacing ?? 1),
      margins: Number(reader.marginsPx ?? 24),
      readingFlow: String(reader.readingFlow ?? "continuous"),
      textAlign: String(reader.textAlign ?? "justify"),
      hyphenation: Boolean(reader.hyphenation ?? true)
    }
  }
}

function rendererSettingsToCanonical(input: { locale: string; appearance: string; reader: Record<string, unknown> }) {
  return {
    ui: {
      locale: input.locale,
      theme: input.appearance === "sepia" || input.appearance === "contrast" ? "light" : input.appearance
    },
    reader: {
      theme: input.reader.theme === "contrast" ? "high_contrast" : input.reader.theme,
      fontFamily: input.reader.fontFamily,
      fontSizePx: input.reader.fontScale,
      columnWidthPx: input.reader.columnWidth,
      columnCount: input.reader.columnCount,
      lineHeight: input.reader.lineHeight,
      paragraphSpacing: input.reader.paragraphSpacing,
      marginsPx: input.reader.margins,
      readingFlow: input.reader.readingFlow,
      textAlign: input.reader.textAlign,
      hyphenation: input.reader.hyphenation
    }
  }
}

function toRendererLocator(bookId: string, position: Record<string, unknown>) {
  const locator = (position.locator ?? {}) as Record<string, unknown>
  const locations = (locator.locations ?? {}) as Record<string, unknown>
  const text = (locator.text ?? {}) as Record<string, unknown>
  const progression = Number(position.progression ?? locations.progression ?? 0)
  const chapterId = optionalString(position.chapterHref) ?? optionalString(locator.href)

  if (!chapterId) {
    return undefined
  }

  return {
    anchorParagraphIndex: optionalNumber(text.anchorParagraphIndex),
    anchorText: optionalString(text.anchorText),
    anchorTextOffset: optionalNumber(text.anchorTextOffset),
    bookId,
    chapterId,
    pageCount: optionalNumber(locations.pageCount),
    pageIndex: optionalNumber(locations.pageIndex),
    progress: Math.round(progression * 100),
    readingFlow: optionalString(locations.readingFlow) ?? "continuous",
    scrollProgress: optionalNumber(locations.scrollProgress),
    scrollTop: optionalNumber(locations.scrollTop),
    updatedAt: String(position.updatedAt ?? new Date().toISOString())
  }
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|div|section|article|h1|h2|h3|li)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function colorFromId(value: string): string {
  const colors = ["#4f46e5", "#0f766e", "#b45309", "#be123c", "#6d28d9"]
  const index = [...value].reduce((total, char) => total + char.charCodeAt(0), 0) % colors.length
  return colors[index]
}

function toArray(value: unknown): unknown[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>
}
