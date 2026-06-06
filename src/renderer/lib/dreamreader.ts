import type {
  Annotation,
  AnnotationDraft,
  AppSettings,
  BookDetails,
  BookSummary,
  LibraryQuery,
  ReaderLocator
} from "@renderer/types"
import { defaultSettings, sampleAnnotations, sampleBooks } from "@renderer/lib/sampleData"
import { normalizeSearch } from "@renderer/lib/utils"

const STORAGE_KEY = "dreamreader.renderer.fallback"

type FallbackState = {
  books: BookDetails[]
  annotations: Annotation[]
  settings: AppSettings
}

function readFallbackState(): FallbackState {
  const stored = window.localStorage.getItem(STORAGE_KEY)

  if (!stored) {
    return {
      books: sampleBooks,
      annotations: sampleAnnotations,
      settings: defaultSettings
    }
  }

  try {
    const parsed = JSON.parse(stored) as Partial<FallbackState>

    return {
      books: parsed.books?.length ? parsed.books : sampleBooks,
      annotations: parsed.annotations ?? sampleAnnotations,
      settings: parsed.settings ?? defaultSettings
    }
  } catch {
    return {
      books: sampleBooks,
      annotations: sampleAnnotations,
      settings: defaultSettings
    }
  }
}

function writeFallbackState(state: FallbackState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function toSummary(book: BookDetails): BookSummary {
  const { chapters: _chapters, description: _description, publisher: _publisher, ...summary } = book
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

    return readFallbackState().books.find((book) => book.id === bookId) ?? null
  },

  async importBooks(): Promise<BookSummary[]> {
    const bridgeImport = window.dreamreader?.library?.importBooks

    if (bridgeImport) {
      return bridgeImport()
    }

    return filterBooks(readFallbackState().books)
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
  }
}
