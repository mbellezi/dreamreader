export type Locale = "pt-BR" | "en"

export type AppearanceTheme = "light" | "dark" | "sepia" | "contrast"

export type ReadingStatus = "unread" | "reading" | "finished"

export type BookFormat = "epub" | "txt" | "markdown" | "html"

export type AnnotationKind = "highlight" | "note" | "favorite"

export type HighlightColor = "yellow" | "green" | "blue" | "rose" | "purple"

export type ReaderFontFamily = "georgia" | "palatino" | "charter" | "system-serif" | "system-sans"

export type ReaderTextAlign = "start" | "justify"

export type ReaderFlowMode = "continuous" | "paginated"

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
  coverImageUrl?: string
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
  lastChapterId?: string
  lastPosition?: ReaderLocator
  chapters: Chapter[]
}

export type ReaderLocator = {
  anchorParagraphIndex?: number
  anchorText?: string
  anchorTextOffset?: number
  bookId: string
  chapterId: string
  pageCount?: number
  pageIndex?: number
  progress: number
  readingFlow?: ReaderFlowMode
  scrollProgress?: number
  scrollTop?: number
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
  // Layout-independent anchor for the highlighted text: which paragraph it lives
  // in and the character offset of its start. Distinguishes repeated words (e.g.
  // "que") so a highlight lands on the exact occurrence, not every match.
  anchorParagraphIndex?: number
  anchorTextOffset?: number
}

export type AnnotationUpdateDraft = {
  id: string
  color?: HighlightColor
  note?: string
}

export type ReaderPreferences = {
  theme: AppearanceTheme
  fontFamily: ReaderFontFamily
  fontScale: number
  columnWidth: number
  columnCount: 1 | 2
  lineHeight: number
  paragraphSpacing: number
  margins: number
  readingFlow: ReaderFlowMode
  textAlign: ReaderTextAlign
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

export type ImportSkippedItem = {
  path: string
  reason: "duplicate" | "unsupported_type" | "invalid_file" | "failed"
  existingBookId?: string
}

export type ImportBooksResult = {
  books: BookSummary[]
  importedCount: number
  skipped: ImportSkippedItem[]
}

export type AnnotationDraft = Omit<Annotation, "id" | "createdAt">

export type TtsJobStatus =
  | "queued"
  | "preparing"
  | "analyzing"
  | "synthesizing"
  | "assembling"
  | "updating_m4b"
  | "building"
  | "validating"
  | "completed"
  | "failed"
  | "cancelled"

export type TtsJob = {
  id: string
  bookId: string
  chapterHref: string
  engineId: string
  voiceProfileId?: string
  status: TtsJobStatus
  progress: number
  settings: Record<string, unknown>
  errorMessage?: string
  createdAt: string
  updatedAt: string
  finishedAt?: string
}

export type AudiobookChapter = {
  bookId: string
  chapterHref: string
  chapterIndex: number
  title: string
  audioAssetId: string
  engineId: string
  voiceProfileId?: string
  durationMs: number
  startMs: number
  endMs: number
  contentHash: string
  audioHash: string
}

export type AudiobookExport = {
  id: string
  bookId: string
  status: "none" | "partial" | "stale" | "complete" | "error"
  autoBuildEnabled: boolean
  draftAssetId?: string
  manifest?: {
    chapters: AudiobookChapter[]
    durationMs: number
  }
  chaptersReady: number
  chaptersTotal: number
  durationMs?: number
  stale: boolean
  errorMessage?: string
}

export type RuntimeDiagnostic = {
  id: string
  label: string
  status: "available" | "not_configured"
  detail: string
}

export type VoiceProfile = {
  id: string
  name: string
  language: string
  kind: string
}

export type DreamReaderBridge = {
  library?: {
    listBooks?: (query?: LibraryQuery) => Promise<BookSummary[]>
    getBook?: (bookId: string) => Promise<BookDetails | null>
    importBooks?: () => Promise<ImportBooksResult>
    updateBookMetadata?: (input: Record<string, unknown>) => Promise<unknown>
  }
  reader?: {
    saveProgress?: (locator: ReaderLocator) => Promise<void>
    listAnnotations?: (bookId: string) => Promise<Annotation[]>
    createAnnotation?: (draft: AnnotationDraft) => Promise<Annotation>
    updateAnnotation?: (draft: AnnotationUpdateDraft) => Promise<Annotation>
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
    retryJob?: (id: string) => Promise<unknown>
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
