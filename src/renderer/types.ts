export type Locale = "pt-BR" | "en"

export type AppearanceTheme = "light" | "dark" | "sepia" | "contrast"

export type ReadingStatus = "unread" | "reading" | "finished"

export type BookFormat = "epub" | "txt" | "markdown" | "html"

export type AnnotationKind = "highlight" | "note" | "favorite"

export type HighlightColor = "yellow" | "green" | "blue" | "rose"

export type BookSummary = {
  id: string
  title: string
  authors: string[]
  language: string
  format: BookFormat
  status: ReadingStatus
  progress: number
  tags: string[]
  collection?: string
  updatedAt: string
  coverColor: string
}

export type Chapter = {
  id: string
  title: string
  position: number
  text: string
}

export type BookDetails = BookSummary & {
  publisher?: string
  description?: string
  chapters: Chapter[]
}

export type ReaderLocator = {
  bookId: string
  chapterId: string
  progress: number
  updatedAt: string
}

export type Annotation = {
  id: string
  bookId: string
  chapterId: string
  kind: AnnotationKind
  color: HighlightColor
  excerpt: string
  note: string
  createdAt: string
}

export type ReaderPreferences = {
  theme: AppearanceTheme
  fontScale: number
  columnWidth: number
  lineHeight: number
  hyphenation: boolean
}

export type AppSettings = {
  locale: Locale
  appearance: AppearanceTheme
  reader: ReaderPreferences
}

export type LibraryQuery = {
  search: string
}

export type AnnotationDraft = Omit<Annotation, "id" | "createdAt">

export type DreamReaderBridge = {
  library?: {
    listBooks?: (query?: LibraryQuery) => Promise<BookSummary[]>
    getBook?: (bookId: string) => Promise<BookDetails | null>
    importBooks?: () => Promise<BookSummary[]>
    updateBookMetadata?: (input: Record<string, unknown>) => Promise<unknown>
  }
  reader?: {
    saveProgress?: (locator: ReaderLocator) => Promise<void>
    listAnnotations?: (bookId: string) => Promise<Annotation[]>
    createAnnotation?: (draft: AnnotationDraft) => Promise<Annotation>
    deleteAnnotation?: (annotationId: string) => Promise<void>
    exportNotes?: (bookId: string, format: "markdown" | "json") => Promise<string>
  }
  settings?: {
    getSettings?: () => Promise<AppSettings>
    saveSettings?: (settings: AppSettings) => Promise<AppSettings>
  }
  models?: {
    list?: () => Promise<unknown[]>
    diagnostics?: () => Promise<unknown[]>
    installFromPath?: (modelPath: string) => Promise<unknown>
  }
  tts?: {
    enqueueChapter?: (input: Record<string, unknown>) => Promise<unknown>
    cancelJob?: (id: string) => Promise<unknown>
    getJob?: (id: string) => Promise<unknown>
    listJobs?: (filter?: { bookId?: string; engineId?: string }) => Promise<unknown[]>
  }
  voices?: {
    list?: () => Promise<unknown[]>
    listCompatible?: (engineId?: string) => Promise<unknown[]>
    createFromReference?: (input: Record<string, unknown>) => Promise<unknown>
    preview?: (voiceProfileId: string, engineId: string) => Promise<unknown>
    update?: (input: Record<string, unknown>) => Promise<unknown>
    delete?: (voiceProfileId: string) => Promise<unknown>
  }
  audiobook?: {
    getExport?: (bookId: string) => Promise<unknown>
    enableAutoBuild?: (bookId: string, enabled: boolean) => Promise<unknown>
    rebuild?: (bookId: string) => Promise<unknown>
    reveal?: (bookId: string) => Promise<unknown>
  }
}

declare global {
  interface Window {
    dreamreader?: DreamReaderBridge
  }
}
