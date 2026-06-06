import type {
  Annotation,
  AnnotationDraft,
  AnnotationUpdateDraft,
  AppSettings,
  AudiobookExport,
  BookDetails,
  BookSummary,
  ImportBooksResult,
  LibraryQuery,
  ReaderLocator,
  RuntimeDiagnostic,
  TtsJob,
  VoiceProfile
} from "@renderer/types"
import { defaultSettings, sampleAnnotations, sampleBooks } from "@renderer/lib/sampleData"
import { normalizeSearch } from "@renderer/lib/utils"

const STORAGE_KEY = "dreamreader.renderer.fallback"

type FallbackState = {
  books: BookDetails[]
  annotations: Annotation[]
  settings: AppSettings
  positions: Record<string, ReaderLocator>
}

function readFallbackState(): FallbackState {
  const stored = window.localStorage.getItem(STORAGE_KEY)

  if (!stored) {
    return {
      books: sampleBooks,
      annotations: sampleAnnotations,
      settings: normalizeSettings(defaultSettings),
      positions: {}
    }
  }

  try {
    const parsed = JSON.parse(stored) as Partial<FallbackState>

    return {
      books: parsed.books?.length ? parsed.books : sampleBooks,
      annotations: parsed.annotations ?? sampleAnnotations,
      settings: normalizeSettings(parsed.settings),
      positions: parsed.positions ?? {}
    }
  } catch {
    return {
      books: sampleBooks,
      annotations: sampleAnnotations,
      settings: normalizeSettings(defaultSettings),
      positions: {}
    }
  }
}

function writeFallbackState(state: FallbackState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function toSummary(book: BookDetails): BookSummary {
  const {
    chapters: _chapters,
    description: _description,
    lastChapterId: _lastChapterId,
    lastPosition: _lastPosition,
    publisher: _publisher,
    ...summary
  } = book
  return summary
}

function filterBooks(books: BookDetails[], query?: LibraryQuery): BookSummary[] {
  const search = normalizeSearch(query?.search ?? "")

  return books
    .filter((book) => {
      if (!search) {
        return true
      }

      return normalizeSearch([book.title, ...book.authors, ...book.tags, book.collection ?? ""].join(" ")).includes(search)
    })
    .map(toSummary)
}

function normalizeSettings(settings?: Partial<AppSettings>): AppSettings {
  return {
    ...defaultSettings,
    ...settings,
    reader: {
      ...defaultSettings.reader,
      ...settings?.reader
    }
  }
}

function exportAnnotations(book: BookDetails | undefined, annotations: Annotation[], format: "markdown" | "json"): string {
  if (format === "json") {
    return JSON.stringify(annotations, null, 2)
  }

  const title = book?.title ?? "DreamReader"
  const lines = [`# ${title}`, ""]

  annotations.forEach((annotation) => {
    const chapter = book?.chapters.find((item) => item.id === annotation.chapterId)
    lines.push(`## ${chapter?.title ?? annotation.chapterId}`)
    lines.push("")
    lines.push(`> ${annotation.excerpt}`)
    if (annotation.note) {
      lines.push("")
      lines.push(annotation.note)
    }
    lines.push("")
  })

  return lines.join("\n")
}

export const dreamreaderClient = {
  hasBridge(): boolean {
    return Boolean(window.dreamreader)
  },

  async listBooks(query?: LibraryQuery): Promise<BookSummary[]> {
    const bridgeList = window.dreamreader?.library?.listBooks

    if (bridgeList) {
      return bridgeList(query)
    }

    return filterBooks(readFallbackState().books, query)
  },

  async getBook(bookId: string): Promise<BookDetails | null> {
    const bridgeGet = window.dreamreader?.library?.getBook

    if (bridgeGet) {
      return bridgeGet(bookId)
    }

    const state = readFallbackState()
    const book = state.books.find((item) => item.id === bookId)
    return book
      ? {
        ...book,
        lastChapterId: state.positions[bookId]?.chapterId,
        lastPosition: state.positions[bookId]
      }
      : null
  },

  async importBooks(): Promise<ImportBooksResult> {
    const bridgeImport = window.dreamreader?.library?.importBooks

    if (bridgeImport) {
      return bridgeImport()
    }

    throw Object.assign(new Error("Import requires the Electron bridge"), {
      code: "library_import_requires_app_bridge"
    })
  },

  async saveProgress(locator: ReaderLocator): Promise<void> {
    const bridgeSave = window.dreamreader?.reader?.saveProgress

    if (bridgeSave) {
      await bridgeSave(locator)
      return
    }

    const state = readFallbackState()
    const bookIndex = state.books.findIndex((book) => book.id === locator.bookId)

    if (bookIndex >= 0) {
      state.books[bookIndex] = {
        ...state.books[bookIndex],
        progress: locator.progress,
        status: locator.progress >= 100 ? "finished" : "reading",
        updatedAt: locator.updatedAt
      }
      state.positions[locator.bookId] = locator
      writeFallbackState(state)
    }
  },

  async listAnnotations(bookId: string): Promise<Annotation[]> {
    const bridgeList = window.dreamreader?.reader?.listAnnotations

    if (bridgeList) {
      return bridgeList(bookId)
    }

    return readFallbackState().annotations.filter((annotation) => annotation.bookId === bookId)
  },

  async createAnnotation(draft: AnnotationDraft): Promise<Annotation> {
    const bridgeCreate = window.dreamreader?.reader?.createAnnotation

    if (bridgeCreate) {
      return bridgeCreate(draft)
    }

    const state = readFallbackState()
    const annotation: Annotation = {
      ...draft,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    }
    state.annotations = [annotation, ...state.annotations]
    writeFallbackState(state)
    return annotation
  },

  async updateAnnotation(draft: AnnotationUpdateDraft): Promise<Annotation> {
    const bridgeUpdate = window.dreamreader?.reader?.updateAnnotation

    if (bridgeUpdate) {
      return bridgeUpdate(draft)
    }

    const state = readFallbackState()
    const annotationIndex = state.annotations.findIndex((annotation) => annotation.id === draft.id)

    if (annotationIndex < 0) {
      throw Object.assign(new Error("Annotation not found"), {
        code: "annotation_not_found"
      })
    }

    const annotation = {
      ...state.annotations[annotationIndex],
      color: draft.color ?? state.annotations[annotationIndex].color,
      note: draft.note ?? state.annotations[annotationIndex].note
    }
    state.annotations[annotationIndex] = annotation
    writeFallbackState(state)
    return annotation
  },

  async deleteAnnotation(annotationId: string): Promise<void> {
    const bridgeDelete = window.dreamreader?.reader?.deleteAnnotation

    if (bridgeDelete) {
      await bridgeDelete(annotationId)
      return
    }

    const state = readFallbackState()
    state.annotations = state.annotations.filter((annotation) => annotation.id !== annotationId)
    writeFallbackState(state)
  },

  async exportNotes(bookId: string, format: "markdown" | "json"): Promise<string> {
    const bridgeExport = window.dreamreader?.reader?.exportNotes

    if (bridgeExport) {
      return bridgeExport(bookId, format)
    }

    const state = readFallbackState()
    const book = state.books.find((item) => item.id === bookId)
    const annotations = state.annotations.filter((annotation) => annotation.bookId === bookId)
    return exportAnnotations(book, annotations, format)
  },

  async getSettings(): Promise<AppSettings> {
    const bridgeGet = window.dreamreader?.settings?.getSettings

    if (bridgeGet) {
      return bridgeGet()
    }

    return readFallbackState().settings
  },

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    const bridgeSave = window.dreamreader?.settings?.saveSettings

    if (bridgeSave) {
      return bridgeSave(settings)
    }

    const state = readFallbackState()
    state.settings = settings
    writeFallbackState(state)
    return settings
  },

  async enqueueChapterAudio(input: {
    bookId: string
    chapterHref: string
    engineId?: string
    quality?: "draft" | "standard" | "high"
    voiceProfileId?: string
    useExpressiveNarration?: boolean
  }): Promise<TtsJob> {
    const bridgeEnqueue = window.dreamreader?.tts?.enqueueChapter

    if (bridgeEnqueue) {
      return toTtsJob(await bridgeEnqueue(input))
    }

    return fallbackTtsJob(input.bookId, input.chapterHref, "completed")
  },

  async cancelTtsJob(id: string): Promise<TtsJob> {
    const bridgeCancel = window.dreamreader?.tts?.cancelJob

    if (bridgeCancel) {
      return toTtsJob(await bridgeCancel(id))
    }

    return fallbackTtsJob("fallback-book", "chapter-1", "cancelled", id)
  },

  async retryTtsJob(id: string): Promise<TtsJob> {
    const bridgeRetry = window.dreamreader?.tts?.retryJob

    if (bridgeRetry) {
      return toTtsJob(await bridgeRetry(id))
    }

    return fallbackTtsJob("fallback-book", "chapter-1", "queued", id)
  },

  async listTtsJobs(filter?: { bookId?: string; engineId?: string }): Promise<TtsJob[]> {
    const bridgeList = window.dreamreader?.tts?.listJobs

    if (bridgeList) {
      return (await bridgeList(filter)).map(toTtsJob)
    }

    return []
  },

  async getAudiobookExport(bookId: string): Promise<AudiobookExport | null> {
    const bridgeGet = window.dreamreader?.audiobook?.getExport

    if (bridgeGet) {
      return toAudiobookExport(await bridgeGet(bookId))
    }

    return null
  },

  async setAudiobookAutoBuild(bookId: string, enabled: boolean): Promise<AudiobookExport | null> {
    const bridgeSet = window.dreamreader?.audiobook?.enableAutoBuild

    if (bridgeSet) {
      return toAudiobookExport(await bridgeSet(bookId, enabled))
    }

    return {
      id: `fallback-audiobook-${bookId}`,
      bookId,
      status: "none",
      autoBuildEnabled: enabled,
      chaptersReady: 0,
      chaptersTotal: 0,
      stale: false
    }
  },

  async rebuildAudiobook(bookId: string): Promise<AudiobookExport | null> {
    const bridgeRebuild = window.dreamreader?.audiobook?.rebuild

    if (bridgeRebuild) {
      return toAudiobookExport(await bridgeRebuild(bookId))
    }

    return null
  },

  async listModelDiagnostics(): Promise<RuntimeDiagnostic[]> {
    const bridgeDiagnostics = window.dreamreader?.models?.diagnostics

    if (bridgeDiagnostics) {
      return (await bridgeDiagnostics()).map(toRuntimeDiagnostic)
    }

    return [
      {
        id: "fallback",
        label: "Renderer",
        status: "not_configured",
        detail: "Electron bridge unavailable"
      }
    ]
  },

  async listCompatibleVoices(engineId?: string): Promise<VoiceProfile[]> {
    const bridgeList = window.dreamreader?.voices?.listCompatible

    if (bridgeList) {
      return (await bridgeList(engineId)).map(toVoiceProfile)
    }

    return [
      {
        id: "voice_builtin_ptbr_neutral",
        name: "Narrador PT-BR neutro",
        language: "pt-BR",
        kind: "built_in"
      }
    ]
  }
}

function fallbackTtsJob(bookId: string, chapterHref: string, status: TtsJob["status"], id: string = crypto.randomUUID()): TtsJob {
  const now = new Date().toISOString()
  return {
    id,
    bookId,
    chapterHref,
    engineId: "dreamreader-local-tts",
    voiceProfileId: "voice_builtin_ptbr_neutral",
    status,
    progress: status === "completed" ? 1 : 0,
    settings: {
      useExpressiveNarration: false
    },
    createdAt: now,
    updatedAt: now,
    finishedAt: status === "completed" || status === "cancelled" ? now : undefined
  }
}

function toTtsJob(input: unknown): TtsJob {
  const job = (input ?? {}) as Record<string, unknown>
  return {
    id: String(job.id ?? ""),
    bookId: String(job.bookId ?? ""),
    chapterHref: String(job.chapterHref ?? ""),
    engineId: String(job.engineId ?? "dreamreader-local-tts"),
    voiceProfileId: optionalString(job.voiceProfileId),
    status: toTtsJobStatus(job.status),
    progress: Number(job.progress ?? 0),
    settings: jsonObject(job.settings),
    errorMessage: optionalString(job.errorMessage),
    createdAt: String(job.createdAt ?? new Date().toISOString()),
    updatedAt: String(job.updatedAt ?? new Date().toISOString()),
    finishedAt: optionalString(job.finishedAt)
  }
}

function toAudiobookExport(input: unknown): AudiobookExport | null {
  if (!input) {
    return null
  }
  const item = input as Record<string, unknown>
  const manifest = item.manifest as Record<string, unknown> | undefined
  return {
    id: String(item.id ?? ""),
    bookId: String(item.bookId ?? ""),
    status: toAudiobookStatus(item.status),
    autoBuildEnabled: Boolean(item.autoBuildEnabled),
    draftAssetId: optionalString(item.draftAssetId),
    manifest: manifest
      ? {
          chapters: toArray(manifest.chapters).map((chapter) => {
            const row = chapter as Record<string, unknown>
            return {
              bookId: String(row.bookId ?? ""),
              chapterHref: String(row.chapterHref ?? ""),
              chapterIndex: Number(row.chapterIndex ?? 0),
              title: String(row.title ?? ""),
              audioAssetId: String(row.audioAssetId ?? ""),
              engineId: String(row.engineId ?? "dreamreader-local-tts"),
              voiceProfileId: optionalString(row.voiceProfileId),
              durationMs: Number(row.durationMs ?? 0),
              startMs: Number(row.startMs ?? 0),
              endMs: Number(row.endMs ?? 0),
              contentHash: String(row.contentHash ?? ""),
              audioHash: String(row.audioHash ?? "")
            }
          }),
          durationMs: Number(manifest.durationMs ?? 0)
        }
      : undefined,
    chaptersReady: Number(item.chaptersReady ?? 0),
    chaptersTotal: Number(item.chaptersTotal ?? 0),
    durationMs: optionalNumber(item.durationMs),
    stale: Boolean(item.stale),
    errorMessage: optionalString(item.errorMessage)
  }
}

function toRuntimeDiagnostic(input: unknown): RuntimeDiagnostic {
  const item = (input ?? {}) as Record<string, unknown>
  return {
    id: String(item.id ?? ""),
    label: String(item.label ?? item.id ?? ""),
    status: item.status === "available" ? "available" : "not_configured",
    detail: String(item.detail ?? "")
  }
}

function toVoiceProfile(input: unknown): VoiceProfile {
  const voice = (input ?? {}) as Record<string, unknown>
  return {
    id: String(voice.id ?? ""),
    name: String(voice.name ?? ""),
    language: String(voice.language ?? "pt-BR"),
    kind: String(voice.kind ?? "built_in")
  }
}

function toTtsJobStatus(value: unknown): TtsJob["status"] {
  const status = String(value ?? "queued")
  if (
    status === "queued" ||
    status === "preparing" ||
    status === "analyzing" ||
    status === "synthesizing" ||
    status === "assembling" ||
    status === "updating_m4b" ||
    status === "building" ||
    status === "validating" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled"
  ) {
    return status
  }
  return "queued"
}

function toAudiobookStatus(value: unknown): AudiobookExport["status"] {
  const status = String(value ?? "none")
  if (status === "partial" || status === "stale" || status === "complete" || status === "error") {
    return status
  }
  return "none"
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

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
