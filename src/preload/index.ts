import { contextBridge, ipcRenderer } from "electron"
import { buildSaveLocatorRequest, type RendererLocator } from "@preload/locator"
import { htmlToReaderBlocks } from "@preload/reader-content"

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
          const blocks = htmlToReaderBlocks(resource.content, { bookId, chapterHref: href })
          return {
            id: href,
            title: String(entry.title ?? `Capitulo ${index + 1}`),
            position: index + 1,
            text: blocks
              .filter((block) => block.type === "paragraph")
              .map((block) => block.text)
              .join("\n\n"),
            blocks
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
      invoke<{ exported: boolean; filePath?: string }>("annotations.export", { bookId, format })
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
      audio?: Record<string, unknown>
      reader: Record<string, unknown>
    }) => toRendererSettings(await invoke("settings.update", rendererSettingsToCanonical(settings)))
  },
  models: {
    list: () => invoke("models.list"),
    diagnostics: () => invoke("models.diagnostics"),
    downloads: () => invoke("models.downloads"),
    operations: () => invoke("models.operations"),
    huggingFaceToken: () => invoke("models.huggingFaceToken"),
    updateHuggingFaceToken: (token: string) => invoke("models.updateHuggingFaceToken", { token }),
    installFromPath: (modelPath?: string) => invoke("models.installFromPath", modelPath ? { path: modelPath } : {}),
    installRecommended: (modelId: string, backend = "auto") => invoke("models.installRecommended", { modelId, backend }),
    delete: (modelId: string, deleteFiles = true) => invoke("models.delete", { modelId, deleteFiles }),
    download: (modelId: string) => invoke("models.download", { modelId })
  },
  sidecars: {
    list: () => invoke("sidecars.list"),
    install: (sidecarId: string, backend = "auto") => invoke("sidecars.install", { sidecarId, backend }),
    uninstall: (sidecarId: string) => invoke("sidecars.uninstall", { sidecarId })
  },
  tts: {
    enqueueChapter: (input: Record<string, unknown>) => invoke("tts.enqueueChapter", input),
    enqueueChapters: (input: Record<string, unknown>) => invoke("tts.enqueueChapters", input),
    cancelJob: (id: string) => invoke("tts.cancelJob", { id }),
    pauseJob: (id: string) => invoke("tts.pauseJob", { id }),
    resumeJob: (id: string) => invoke("tts.resumeJob", { id }),
    retryJob: (id: string) => invoke("tts.retryJob", { id }),
    getJob: (id: string) => invoke("tts.getJob", { id }),
    listJobs: (filter?: { bookId?: string; engineId?: string }) => invoke("tts.listJobs", filter ?? {}),
    listSegments: (jobId: string) => invoke("tts.listSegments", { jobId }),
    clearChapterAudio: (input: { bookId: string; chapterHref: string }) => invoke("tts.clearChapterAudio", input),
    clearTerminalJobs: (input: { bookId: string }) => invoke("tts.clearTerminalJobs", input)
  },
  voices: {
    list: () => invoke("voices.list"),
    listCompatible: (engineId?: string) => invoke("voices.listCompatible", { engineId }),
    createFromReference: (input: Record<string, unknown>) => invoke("voices.createFromReference", input),
    createFromDesignPrompt: (input: Record<string, unknown>) => invoke("voices.createFromDesignPrompt", input),
    selectReferenceAudio: () => invoke("voices.selectReferenceAudio", {}),
    preview: (voiceProfileId: string, engineId: string) => invoke("voices.preview", { voiceProfileId, engineId }),
    update: (input: Record<string, unknown>) => invoke("voices.update", input),
    delete: (voiceProfileId: string) => invoke("voices.delete", { voiceProfileId }),
    export: (voiceProfileId: string) => invoke("voices.export", { voiceProfileId }),
    import: (archivePaths?: string[]) => invoke("voices.import", { archivePaths: archivePaths ?? [] })
  },
  audiobook: {
    getExport: (bookId: string) => invoke("audiobook.getExport", { bookId }),
    listLibraryStatus: () => invoke("audiobook.listLibraryStatus"),
    enableAutoBuild: (bookId: string, enabled: boolean) =>
      invoke("audiobook.enableAutoBuild", { bookId, enabled }),
    rebuild: (bookId: string) => invoke("audiobook.rebuild", { bookId }),
    getBuildJob: (bookId: string) => invoke("audiobook.getBuildJob", { bookId }),
    save: (bookId: string) => invoke("audiobook.save", { bookId }),
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
    publishedAt: optionalString(book.publishedAt),
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
  const audio = (settings.audio ?? {}) as Record<string, unknown>
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
    },
    audio: {
      defaultEngineId: optionalString(audio.defaultEngineId),
      defaultVoiceProfileId: optionalString(audio.defaultVoiceProfileId),
      expressiveNarrationEnabled: Boolean(audio.expressiveNarrationEnabled),
      autoBuildM4b: Boolean(audio.autoBuildM4b),
      generationLanguageByEngineId: stringRecord(audio.generationLanguageByEngineId),
      modelSettingsByEngineId: recordObject(audio.modelSettingsByEngineId),
      seed: clampSeed(audio.seed),
      seedFixed: Boolean(audio.seedFixed)
    }
  }
}

function rendererSettingsToCanonical(input: { locale: string; appearance: string; audio?: Record<string, unknown>; reader: Record<string, unknown> }) {
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
    },
    audio: {
      defaultEngineId: optionalString(input.audio?.defaultEngineId),
      defaultVoiceProfileId: optionalString(input.audio?.defaultVoiceProfileId),
      expressiveNarrationEnabled: Boolean(input.audio?.expressiveNarrationEnabled),
      autoBuildM4b: Boolean(input.audio?.autoBuildM4b),
      generationLanguageByEngineId: stringRecord(input.audio?.generationLanguageByEngineId),
      modelSettingsByEngineId: recordObject(input.audio?.modelSettingsByEngineId),
      seed: clampSeed(input.audio?.seed),
      seedFixed: Boolean(input.audio?.seedFixed)
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

function clampSeed(value: unknown): number {
  const seed = Math.floor(Number(value))
  if (!Number.isFinite(seed)) {
    return 1801202606
  }
  return Math.min(Math.max(seed, 0), 4_294_967_295)
}

function recordObject(value: unknown): Record<string, Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item && typeof item === "object" && !Array.isArray(item))
      .map(([key, item]) => [key, item as Record<string, unknown>])
  )
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => typeof item === "string" && item.length > 0)
      .map(([key, item]) => [key, String(item)])
  )
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>
}
