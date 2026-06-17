export type Locale = "pt-BR" | "en"

export type AppearanceTheme = "light" | "dark" | "sepia" | "contrast"

export type ReadingStatus = "unread" | "reading" | "finished"

export type BookFormat = "epub" | "txt" | "markdown" | "html"

export type AnnotationKind = "highlight" | "note" | "favorite"

export type HighlightColor = "yellow" | "green" | "blue" | "rose" | "purple"

export type ReaderFontFamily =
  | "georgia"
  | "palatino"
  | "charter"
  | "system-serif"
  | "atkinson"
  | "avenir"
  | "verdana"
  | "system-sans"

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
  publishedAt?: string
  updatedAt: string
  coverColor: string
  coverImageUrl?: string
}

export type Chapter = {
  blocks?: Array<
    | {
        footnotes?: Array<{
          marker: string
          note: string
          offset: number
          target: string
        }>
        type: "paragraph"
        text: string
      }
    | {
        type: "image"
        alt?: string
        src: string
      }
  >
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

export type ExportNotesResult = {
  exported: boolean
  filePath?: string
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

export type TtsModelSettings = {
  cfgStrength?: number
  cfgWeight?: number
  crossFadeDuration?: number
  doSample?: boolean
  exaggeration?: number
  maxNewTokens?: number
  nfeStep?: number
  nonStreamingMode?: boolean
  removeSilence?: boolean
  repetitionPenalty?: number
  speed?: number
  subtalkerDoSample?: boolean
  subtalkerTemperature?: number
  subtalkerTopK?: number
  subtalkerTopP?: number
  swaySamplingCoef?: number
  targetRms?: number
  temperature?: number
  topK?: number
  topP?: number
}

export type AudioSettings = {
  defaultEngineId?: string
  defaultVoiceProfileId?: string
  defaultQuality: "draft" | "standard" | "high"
  expressiveNarrationEnabled: boolean
  autoBuildM4b: boolean
  generationLanguageByEngineId: Record<string, string>
  modelSettingsByEngineId: Record<string, TtsModelSettings>
  seed: number
  seedFixed: boolean
}

export type AppSettings = {
  locale: Locale
  appearance: AppearanceTheme
  reader: ReaderPreferences
  audio: AudioSettings
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
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"

export type ProsodyEmotion = "neutral" | "warm" | "tense" | "sad" | "joyful" | "angry" | "suspense" | "formal"
export type ProsodyPace = "slow" | "normal" | "fast"
export type ProsodyPitch = "low" | "neutral" | "high"

export type SegmentProsody = {
  emotion: ProsodyEmotion
  intensity: number
  pace: ProsodyPace
  pitch: ProsodyPitch
  pauseBeforeMs: number
  pauseAfterMs: number
  instructionPtBr: string
}

export type TtsSegment = {
  id: string
  jobId: string
  segmentIndex: number
  status: string
  textPreview: string
  audioAssetId?: string
  durationMs?: number
  prosody?: SegmentProsody
  prosodyMode?: "expressive" | "neutral"
}

export type TtsJob = {
  id: string
  bookId: string
  chapterHref: string
  engineId: string
  voiceProfileId?: string
  voiceBindingId?: string
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
  assetId?: string
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

export type AudiobookBuildJob = {
  id: string
  bookId: string
  audiobookExportId: string
  status: "queued" | "building" | "validating" | "completed" | "failed" | "cancelled"
  progress: number
  reason: string
  resultAssetId?: string
  errorCode?: string
  errorMessage?: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
}

export type LibraryAudioStatus = {
  bookId: string
  title: string
  authors: string[]
  coverAssetId?: string
  status: "none" | "partial" | "stale" | "complete" | "error"
  chaptersReady: number
  chaptersTotal: number
  durationMs: number
  hasChapterAudio: boolean
  hasActiveJob: boolean
  updatedAt: string
}

export type RuntimeDiagnostic = {
  id: string
  label: string
  status: "available" | "not_configured"
  detail: string
}

export type RuntimeSidecar = {
  id: string
  adapterId: string
  name: string
  runtime: string
  status: "available" | "not_configured" | "failed"
  executablePath?: string
  scriptPath?: string
  healthcheckCommand?: string
  sizeBytes?: number
  modelEngineIds: string[]
  createdAt: string
  updatedAt: string
}

export type RuntimeOperationStatus = "queued" | "running" | "completed" | "failed"

export type RuntimeOperationKind = "model_download" | "model_install" | "model_delete" | "sidecar_install" | "sidecar_uninstall"

export type RuntimeOperationLogEntry = {
  id: string
  level: "info" | "warning" | "error"
  messageKey: string
  values: Record<string, string | number>
  createdAt: string
}

export type RuntimeOperationJob = {
  id: string
  kind: RuntimeOperationKind
  targetKind: "model" | "sidecar"
  targetId: string
  status: RuntimeOperationStatus
  progress: number
  progressLabelKey?: string
  progressLabelValues: Record<string, string | number>
  errorCode?: string
  errorMessage?: string
  logs: RuntimeOperationLogEntry[]
  createdAt: string
  startedAt?: string
  finishedAt?: string
  updatedAt: string
}

export type HuggingFaceTokenStatus = {
  configured: boolean
  storage?: "electron-safe-storage"
  updatedAt?: string
}

export type ModelInstallStatus = "not_configured" | "queued" | "downloading" | "available" | "failed"

export type RuntimeInstallBackend = "auto" | "mlx" | "cuda" | "vulkan"

export type RuntimeModel = {
  id: string
  kind: "llm" | "tts" | "tokenizer" | "vocoder" | "runtime"
  name: string
  provider: string
  version: string
  runtime: string
  format: string
  acceleratorPreference: string
  installStatus: ModelInstallStatus
  downloadProgress: number
  path?: string
  sizeBytes?: number
  checksum?: string
  checksumAlgorithm?: string
  license: string
  memoryEstimateMb?: number
  sourceUrl?: string
  canDownload: boolean
  engineId?: string
  metadata: Record<string, unknown>
  installedAt?: string
  createdAt: string
  updatedAt: string
}

export type ModelDownloadJob = {
  id: string
  modelAssetId: string
  status: ModelInstallStatus
  progress: number
  receivedBytes: number
  totalBytes?: number
  sourceUrl: string
  targetPath: string
  errorCode?: string
  errorMessage?: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
  updatedAt: string
}

export type VoiceProfile = {
  id: string
  name: string
  description?: string
  language: string
  kind: string
  source?: Record<string, unknown>
  tags?: string[]
  settings?: Record<string, unknown>
  createdFromEngineId?: string
  createdAt?: string
  updatedAt?: string
}

export type PronunciationEntry = {
  id: string
  scope: "global" | "book"
  bookId?: string
  pattern: string
  replacement: string
  matchKind: "literal" | "word" | "regex"
  caseSensitive: boolean
  createdAt: string
  updatedAt: string
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
    exportNotes?: (bookId: string, format: "markdown" | "json") => Promise<ExportNotesResult>
  }
  settings?: {
    getSettings?: () => Promise<AppSettings>
    saveSettings?: (settings: AppSettings) => Promise<AppSettings>
  }
  models?: {
    list?: () => Promise<unknown[]>
    diagnostics?: () => Promise<unknown[]>
    downloads?: () => Promise<unknown[]>
    operations?: () => Promise<unknown[]>
    huggingFaceToken?: () => Promise<unknown>
    updateHuggingFaceToken?: (token: string) => Promise<unknown>
    installFromPath?: (modelPath?: string) => Promise<unknown>
    installRecommended?: (modelId: string, backend?: RuntimeInstallBackend) => Promise<unknown>
    delete?: (modelId: string, deleteFiles?: boolean) => Promise<unknown>
    download?: (modelId: string) => Promise<unknown>
  }
  sidecars?: {
    list?: () => Promise<unknown[]>
    install?: (sidecarId: string, backend?: RuntimeInstallBackend) => Promise<unknown>
    uninstall?: (sidecarId: string) => Promise<unknown>
  }
  tts?: {
    enqueueChapter?: (input: Record<string, unknown>) => Promise<unknown>
    enqueueChapters?: (input: Record<string, unknown>) => Promise<unknown[]>
    cancelJob?: (id: string) => Promise<unknown>
    pauseJob?: (id: string) => Promise<unknown>
    resumeJob?: (id: string) => Promise<unknown>
    retryJob?: (id: string) => Promise<unknown>
    getJob?: (id: string) => Promise<unknown>
    listJobs?: (filter?: { bookId?: string; engineId?: string }) => Promise<unknown[]>
    listSegments?: (jobId: string) => Promise<unknown[]>
    clearChapterAudio?: (input: { bookId: string; chapterHref: string }) => Promise<unknown>
    clearTerminalJobs?: (input: { bookId: string }) => Promise<unknown>
  }
  voices?: {
    list?: () => Promise<unknown[]>
    listCompatible?: (engineId?: string) => Promise<unknown[]>
    createFromReference?: (input: Record<string, unknown>) => Promise<unknown>
    createFromDesignPrompt?: (input: Record<string, unknown>) => Promise<unknown>
    selectReferenceAudio?: () => Promise<{ path?: string; durationMs?: number; sampleRate?: number }>
    preview?: (voiceProfileId: string, engineId: string) => Promise<unknown>
    update?: (input: Record<string, unknown>) => Promise<unknown>
    delete?: (voiceProfileId: string) => Promise<unknown>
    export?: (voiceProfileId: string) => Promise<unknown>
    import?: (archivePaths?: string[]) => Promise<unknown>
  }
  audiobook?: {
    getExport?: (bookId: string) => Promise<unknown>
    listLibraryStatus?: () => Promise<unknown[]>
    enableAutoBuild?: (bookId: string, enabled: boolean) => Promise<unknown>
    rebuild?: (bookId: string) => Promise<unknown>
    getBuildJob?: (bookId: string) => Promise<unknown>
    save?: (bookId: string) => Promise<unknown>
    reveal?: (bookId: string) => Promise<unknown>
  }
  pronunciation?: {
    list?: (input?: { bookId?: string; includeGlobal?: boolean }) => Promise<unknown[]>
    create?: (input: Record<string, unknown>) => Promise<unknown>
    update?: (input: Record<string, unknown>) => Promise<unknown>
    delete?: (id: string) => Promise<unknown>
  }
}

declare global {
  interface Window {
    dreamreader?: DreamReaderBridge
  }
}
