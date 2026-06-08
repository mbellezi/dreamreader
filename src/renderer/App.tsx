import { BookOpen, Headphones, Library, Loader2, ServerCog, Settings } from "lucide-react"
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react"
import { NavButton } from "@renderer/components/common/Controls"
import { AudioDashboardPane } from "@renderer/components/audio/AudioDashboardPane"
import { BookAudioPane } from "@renderer/components/audio/BookAudioPane"
import { LibraryPane } from "@renderer/components/library/LibraryPane"
import { ModelManagerPane } from "@renderer/components/models/ModelManagerPane"
import { InspectorPane } from "@renderer/components/reader/InspectorPane"
import { ReaderPane } from "@renderer/components/reader/ReaderPane"
import { SettingsDialog } from "@renderer/components/settings/SettingsDialog"
import { translate } from "@renderer/i18n"
import { dreamreaderClient } from "@renderer/lib/dreamreader"
import {
  initialChapterIndex,
  libraryImportStatusForError,
  libraryImportStatusForResult
} from "@renderer/lib/appState"
import { clamp, cn } from "@renderer/lib/utils"
import type {
  AppView,
  InspectorTab,
  LibraryMode,
  LibraryStatus,
  LibraryStatusDescriptor
} from "@renderer/app/types"
import type {
  Annotation,
  AnnotationKind,
  AppSettings,
  AudioSettings,
  BookDetails,
  BookSummary,
  HighlightColor,
  ReaderLocator,
  ReaderPreferences,
  RuntimeDiagnostic,
  RuntimeModel,
  RuntimeOperationJob,
  RuntimeSidecar,
  TtsJob,
  VoiceProfile,
  AudiobookExport,
  LibraryAudioStatus,
  HuggingFaceTokenStatus,
  ModelDownloadJob,
  PronunciationEntry
} from "@renderer/types"

export function App(): ReactElement {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [books, setBooks] = useState<BookSummary[]>([])
  const [selectedBook, setSelectedBook] = useState<BookDetails | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [audioJobs, setAudioJobs] = useState<TtsJob[]>([])
  const [audiobookExport, setAudiobookExport] = useState<AudiobookExport | null>(null)
  const [audioLoading, setAudioLoading] = useState(false)
  const [modelManagementLoading, setModelManagementLoading] = useState(false)
  const [libraryAudioStatus, setLibraryAudioStatus] = useState<LibraryAudioStatus[]>([])
  const [audioBook, setAudioBook] = useState<BookDetails | null>(null)
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostic[]>([])
  const [runtimeModels, setRuntimeModels] = useState<RuntimeModel[]>([])
  const [modelDownloadJobs, setModelDownloadJobs] = useState<ModelDownloadJob[]>([])
  const [runtimeOperations, setRuntimeOperations] = useState<RuntimeOperationJob[]>([])
  const [runtimeSidecars, setRuntimeSidecars] = useState<RuntimeSidecar[]>([])
  const [huggingFaceTokenStatus, setHuggingFaceTokenStatus] = useState<HuggingFaceTokenStatus>({ configured: false })
  const [voices, setVoices] = useState<VoiceProfile[]>([])
  const [pronunciationEntries, setPronunciationEntries] = useState<PronunciationEntry[]>([])
  const [activeView, setActiveView] = useState<AppView>("library")
  const [libraryMode, setLibraryMode] = useState<LibraryMode>("grid")
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("summary")
  const [chapterIndex, setChapterIndex] = useState(0)
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [importing, setImporting] = useState(false)
  const [libraryStatus, setLibraryStatus] = useState<LibraryStatus | null>(null)
  const [exportContent, setExportContent] = useState("")
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [cleanReading, setCleanReading] = useState(false)
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null)
  const [annotationFocusTick, setAnnotationFocusTick] = useState(0)
  const [returnChapterIndex, setReturnChapterIndex] = useState<number | null>(null)
  const stableChapterIndexRef = useRef<number | null>(null)
  const pendingSettingsSignatureRef = useRef("")
  const settingsSaveTimerRef = useRef<number | null>(null)
  const modelManagementRefreshIdRef = useRef(0)

  const locale = settings?.locale ?? "pt-BR"
  const t = useCallback((key: string, values?: Record<string, string | number>) => translate(locale, key, values), [locale])
  const translateLibraryStatus = useCallback(
    (status: LibraryStatusDescriptor): LibraryStatus => ({
      tone: status.tone,
      message: t(status.messageKey, status.values)
    }),
    [t]
  )

  const refreshBooks = useCallback(
    async (query = search) => {
      const nextBooks = await dreamreaderClient.listBooks({ search: query })
      setBooks(nextBooks)
    },
    [search]
  )

  const refreshAudioState = useCallback(async (bookId: string) => {
    const [nextJobs, nextExport, nextModels, nextVoices, nextPronunciationEntries] = await Promise.all([
      dreamreaderClient.listTtsJobs({ bookId }),
      dreamreaderClient.getAudiobookExport(bookId),
      dreamreaderClient.listModels(),
      dreamreaderClient.listCompatibleVoices(),
      dreamreaderClient.listPronunciationEntries(bookId)
    ])
    setAudioJobs(nextJobs)
    setAudiobookExport(nextExport)
    setRuntimeModels(nextModels)
    setVoices(nextVoices)
    setPronunciationEntries(nextPronunciationEntries)
  }, [])

  const refreshAudioDashboard = useCallback(async () => {
    const [nextStatus, nextJobs, nextModels, nextVoices] = await Promise.all([
      dreamreaderClient.listLibraryAudioStatus(),
      dreamreaderClient.listTtsJobs(),
      dreamreaderClient.listModels(),
      dreamreaderClient.listCompatibleVoices()
    ])
    setLibraryAudioStatus(nextStatus)
    setAudioJobs(nextJobs)
    setRuntimeModels(nextModels)
    setVoices(nextVoices)
  }, [])

  const refreshActiveAudioView = useCallback(async () => {
    if (audioBook) {
      await refreshAudioState(audioBook.id)
    } else {
      await refreshAudioDashboard()
    }
  }, [audioBook, refreshAudioDashboard, refreshAudioState])

  const refreshModelManagement = useCallback(async () => {
    const refreshId = modelManagementRefreshIdRef.current + 1
    modelManagementRefreshIdRef.current = refreshId
    setModelManagementLoading(true)

    try {
      const [nextDiagnostics, nextModels, nextDownloads, nextOperations, nextSidecars, nextHuggingFaceTokenStatus] = await Promise.all([
        dreamreaderClient.listModelDiagnostics(),
        dreamreaderClient.listModels(),
        dreamreaderClient.listModelDownloadJobs(),
        dreamreaderClient.listRuntimeOperations(),
        dreamreaderClient.listSidecars(),
        dreamreaderClient.getHuggingFaceTokenStatus()
      ])
      setDiagnostics(nextDiagnostics)
      setRuntimeModels(nextModels)
      setModelDownloadJobs(nextDownloads)
      setRuntimeOperations(nextOperations)
      setRuntimeSidecars(nextSidecars)
      setHuggingFaceTokenStatus(nextHuggingFaceTokenStatus)
    } finally {
      if (modelManagementRefreshIdRef.current === refreshId) {
        setModelManagementLoading(false)
      }
    }
  }, [])

  const loadInitialData = useCallback(async () => {
    setLoading(true)
    setError(false)

    try {
      const [nextSettings, nextBooks] = await Promise.all([
        dreamreaderClient.getSettings(),
        dreamreaderClient.listBooks({ search: "" })
      ])
      setSettings(nextSettings)
      setBooks(nextBooks)

      if (nextBooks[0]) {
        const firstBook = await dreamreaderClient.getBook(nextBooks[0].id)
        setSelectedBook(firstBook)
        const nextChapterIndex = initialChapterIndex(firstBook)
        setChapterIndex(nextChapterIndex)
        stableChapterIndexRef.current = nextChapterIndex
        setAnnotations(firstBook ? await dreamreaderClient.listAnnotations(firstBook.id) : [])
      }
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadInitialData()
  }, [loadInitialData])

  useEffect(() => {
    if (!selectedBook || !selectedBook.chapters.length || activeView !== "reader") {
      return
    }

    const safeChapterIndex = clamp(chapterIndex, 0, selectedBook.chapters.length - 1)
    if (safeChapterIndex !== chapterIndex) {
      setChapterIndex(safeChapterIndex)
    }
  }, [activeView, chapterIndex, selectedBook])

  const filteredCount = books.length
  const currentChapter = selectedBook?.chapters[chapterIndex] ?? null
  const bridgeLabel = dreamreaderClient.hasBridge() ? t("app.connection.bridge") : t("app.connection.fallback")
  const readerIsClean = activeView === "reader" && cleanReading && Boolean(selectedBook)

  const updateSearch = async (value: string) => {
    setSearch(value)
    await refreshBooks(value)
  }

  const selectBook = async (bookId: string) => {
    const book = await dreamreaderClient.getBook(bookId)
    const nextChapterIndex = initialChapterIndex(book)
    setSelectedBook(book)
    setChapterIndex(nextChapterIndex)
    stableChapterIndexRef.current = nextChapterIndex
    setReturnChapterIndex(null)
    setActiveAnnotationId(null)
    setExportContent("")
    setActiveView("reader")
    setInspectorTab("summary")
    setAnnotations(book ? await dreamreaderClient.listAnnotations(book.id) : [])
  }

  useEffect(() => {
    if (activeView !== "audio") {
      return
    }

    const hasActiveJob = audioJobs.some((job) => !["completed", "failed", "cancelled", "paused"].includes(job.status))
    if (!hasActiveJob) {
      return
    }

    const interval = window.setInterval(() => {
      void refreshActiveAudioView()
    }, 800)
    return () => window.clearInterval(interval)
  }, [activeView, audioJobs, refreshActiveAudioView])

  useEffect(() => {
    if (activeView !== "models") {
      return
    }

    const hasActiveDownload = runtimeModels.some((model) => model.installStatus === "queued" || model.installStatus === "downloading")
    const hasActiveOperation = runtimeOperations.some((operation) => operation.status === "queued" || operation.status === "running")
    if (!hasActiveDownload && !hasActiveOperation) {
      return
    }

    const interval = window.setInterval(() => {
      void refreshModelManagement()
    }, 800)
    return () => window.clearInterval(interval)
  }, [activeView, refreshModelManagement, runtimeModels, runtimeOperations])

  const importBooks = async () => {
    setImporting(true)
    setLibraryStatus({ tone: "info", message: t("library.importing") })

    try {
      const result = await dreamreaderClient.importBooks()
      setBooks(result.books)
      setLibraryStatus(translateLibraryStatus(libraryImportStatusForResult(result)))
    } catch (caught) {
      setLibraryStatus(translateLibraryStatus(libraryImportStatusForError(caught)))
    } finally {
      setImporting(false)
    }
  }

  const navigateToChapter = (index: number, annotationId?: string) => {
    if (!selectedBook || !selectedBook.chapters.length) {
      return
    }

    const nextIndex = clamp(index, 0, selectedBook.chapters.length - 1)
    if (nextIndex !== chapterIndex) {
      setReturnChapterIndex(chapterIndex)
    }
    setChapterIndex(nextIndex)
    setActiveAnnotationId(annotationId ?? null)
    setActiveView("reader")
  }

  const changeChapter = (direction: -1 | 1) => {
    navigateToChapter(chapterIndex + direction)
  }

  const jumpToChapter = (index: number) => {
    navigateToChapter(index)
  }

  const jumpToAnnotation = (annotation: Annotation) => {
    if (!selectedBook?.chapters.length) {
      return
    }

    const nextIndex = selectedBook.chapters.findIndex((chapter) => chapter.id === annotation.chapterId)
    navigateToChapter(nextIndex >= 0 ? nextIndex : chapterIndex, annotation.id)
    setAnnotationFocusTick((current) => current + 1)
    setInspectorTab("annotations")
  }

  const returnToPreviousPosition = () => {
    if (returnChapterIndex === null) {
      return
    }

    const currentIndex = chapterIndex
    navigateToChapter(returnChapterIndex)
    setReturnChapterIndex(currentIndex)
  }

  const saveReadingPosition = useCallback(
    async (locator: ReaderLocator) => {
      if (!selectedBook || locator.bookId !== selectedBook.id) {
        return
      }

      await dreamreaderClient.saveProgress(locator)
      const nextStableIndex = selectedBook.chapters.findIndex((chapter) => chapter.id === locator.chapterId)
      const previousStableIndex = stableChapterIndexRef.current

      if (nextStableIndex >= 0) {
        stableChapterIndexRef.current = nextStableIndex
        if (previousStableIndex !== null && previousStableIndex !== nextStableIndex) {
          setReturnChapterIndex(previousStableIndex)
        }
      }

      void refreshBooks()
    },
    [refreshBooks, selectedBook]
  )

  const createAnnotation = async (draft: {
    anchorParagraphIndex?: number
    anchorTextOffset?: number
    chapterId: string
    color: HighlightColor
    excerpt: string
    kind: AnnotationKind
    note: string
  }) => {
    if (!selectedBook || !draft.excerpt.trim()) {
      return
    }

    const annotation = await dreamreaderClient.createAnnotation({
      anchorParagraphIndex: draft.anchorParagraphIndex,
      anchorTextOffset: draft.anchorTextOffset,
      bookId: selectedBook.id,
      chapterId: draft.chapterId,
      kind: draft.kind,
      color: draft.color,
      excerpt: draft.excerpt.trim(),
      note: draft.note.trim()
    })
    setAnnotations((current) => [annotation, ...current])
    setActiveAnnotationId(annotation.id)
    setInspectorTab("annotations")
  }

  const updateAnnotationColor = async (annotationId: string, color: HighlightColor) => {
    const annotation = await dreamreaderClient.updateAnnotation({ id: annotationId, color })
    setAnnotations((current) => current.map((item) => (item.id === annotationId ? annotation : item)))
    setActiveAnnotationId(annotationId)
  }

  const deleteAnnotation = async (annotationId: string) => {
    await dreamreaderClient.deleteAnnotation(annotationId)
    setAnnotations((current) => current.filter((annotation) => annotation.id !== annotationId))
    if (activeAnnotationId === annotationId) {
      setActiveAnnotationId(null)
    }
  }

  const exportNotes = async () => {
    if (!selectedBook) {
      return
    }

    setExportContent(await dreamreaderClient.exportNotes(selectedBook.id, "markdown"))
  }

  const openAudioDashboard = () => {
    setActiveView("audio")
    setAudioBook(null)
    void refreshAudioDashboard()
  }

  const openModelManager = () => {
    setActiveView("models")
    void refreshModelManagement()
  }

  const openBookAudio = async (bookId: string) => {
    setActiveView("audio")
    const book = await dreamreaderClient.getBook(bookId)
    setAudioBook(book)
    if (book) {
      await refreshAudioState(book.id)
    }
  }

  const closeBookAudio = () => {
    setAudioBook(null)
    void refreshAudioDashboard()
  }

  const generateChapterAudio = async (input: {
    chapterHref: string
    engineId: string
    generationLanguage?: string
    modelSettings?: Record<string, unknown>
    quality: "draft" | "standard" | "high"
    seed?: number
    seedFixed?: boolean
    useExpressiveNarration: boolean
    voiceProfileId?: string
  }) => {
    if (!audioBook) {
      return
    }

    setAudioLoading(true)
    try {
      await dreamreaderClient.enqueueChapterAudio({
        bookId: audioBook.id,
        ...input
      })
      await refreshAudioState(audioBook.id)
    } finally {
      setAudioLoading(false)
    }
  }

  const generateChapters = async (input: {
    chapterHrefs?: string[]
    engineId: string
    generationLanguage?: string
    modelSettings?: Record<string, unknown>
    quality: "draft" | "standard" | "high"
    seed?: number
    seedFixed?: boolean
    useExpressiveNarration: boolean
    voiceProfileId?: string
  }) => {
    if (!audioBook) {
      return
    }

    setAudioLoading(true)
    try {
      await dreamreaderClient.enqueueChaptersAudio({
        bookId: audioBook.id,
        ...input
      })
      await refreshAudioState(audioBook.id)
    } finally {
      setAudioLoading(false)
    }
  }

  const cancelTtsJob = async (jobId: string) => {
    await dreamreaderClient.cancelTtsJob(jobId)
    await refreshActiveAudioView()
  }

  const pauseTtsJob = async (jobId: string) => {
    await dreamreaderClient.pauseTtsJob(jobId)
    await refreshActiveAudioView()
  }

  const resumeTtsJob = async (jobId: string) => {
    await dreamreaderClient.resumeTtsJob(jobId)
    await refreshActiveAudioView()
  }

  const listTtsSegments = (jobId: string) => dreamreaderClient.listTtsSegments(jobId)

  const retryTtsJob = async (jobId: string) => {
    await dreamreaderClient.retryTtsJob(jobId)
    await refreshActiveAudioView()
  }

  const toggleAudiobookAutoBuild = async (enabled: boolean) => {
    if (!audioBook) {
      return
    }

    setAudioLoading(true)
    try {
      setAudiobookExport(await dreamreaderClient.setAudiobookAutoBuild(audioBook.id, enabled))
      await refreshAudioState(audioBook.id)
    } finally {
      setAudioLoading(false)
    }
  }

  const rebuildAudiobook = async () => {
    if (!audioBook) {
      return
    }

    setAudioLoading(true)
    try {
      setAudiobookExport(await dreamreaderClient.rebuildAudiobook(audioBook.id))
      await refreshAudioState(audioBook.id)
    } finally {
      setAudioLoading(false)
    }
  }

  const clearChapterAudio = async (chapterHref: string) => {
    if (!audioBook) {
      return
    }

    setAudioLoading(true)
    try {
      await dreamreaderClient.clearChapterAudio({
        bookId: audioBook.id,
        chapterHref
      })
      await refreshAudioState(audioBook.id)
    } finally {
      setAudioLoading(false)
    }
  }

  const clearTerminalTtsJobs = async () => {
    if (!audioBook) {
      return
    }

    setAudioLoading(true)
    try {
      await dreamreaderClient.clearTerminalTtsJobs(audioBook.id)
      await refreshAudioState(audioBook.id)
    } finally {
      setAudioLoading(false)
    }
  }

  const selectVoiceReferenceAudio = async () => dreamreaderClient.selectVoiceReferenceAudio()

  const createVoiceFromReference = async (input: {
    consentConfirmed: true
    consentNote: string
    language: string
    name: string
    referenceAudioPath: string
    transcript?: string
  }) => {
    setAudioLoading(true)
    try {
      const voice = await dreamreaderClient.createVoiceFromReference(input)
      await refreshActiveAudioView()
      return voice
    } finally {
      setAudioLoading(false)
    }
  }

  const createVoiceFromDesignPrompt = async (input: {
    engineId: string
    language: string
    name: string
    prompt: string
  }) => {
    setAudioLoading(true)
    try {
      const voice = await dreamreaderClient.createVoiceFromDesignPrompt(input)
      await refreshActiveAudioView()
      return voice
    } finally {
      setAudioLoading(false)
    }
  }

  const updateVoice = async (input: { voiceProfileId: string; name: string }) => {
    setAudioLoading(true)
    try {
      await dreamreaderClient.updateVoice(input)
      await refreshActiveAudioView()
    } finally {
      setAudioLoading(false)
    }
  }

  const deleteVoice = async (voiceProfileId: string) => {
    setAudioLoading(true)
    try {
      await dreamreaderClient.deleteVoice(voiceProfileId)
      await refreshActiveAudioView()
    } finally {
      setAudioLoading(false)
    }
  }

  const createPronunciationEntry = async (input: {
    pattern: string
    replacement: string
    scope: "global" | "book"
  }) => {
    if (!audioBook || !input.pattern.trim() || !input.replacement.trim()) {
      return
    }

    await dreamreaderClient.createPronunciationEntry({
      bookId: input.scope === "book" ? audioBook.id : undefined,
      matchKind: "word",
      pattern: input.pattern.trim(),
      replacement: input.replacement.trim(),
      scope: input.scope
    })
    await refreshAudioState(audioBook.id)
  }

  const deletePronunciationEntry = async (id: string) => {
    if (!audioBook) {
      return
    }

    await dreamreaderClient.deletePronunciationEntry(id)
    await refreshAudioState(audioBook.id)
  }

  const downloadModel = async (modelId: string) => {
    await dreamreaderClient.downloadModel(modelId)
    await refreshModelManagement()
    if (audioBook) {
      await refreshAudioState(audioBook.id)
    }
  }

  const installRecommendedModel = async (modelId: string) => {
    await dreamreaderClient.installRecommendedModel(modelId)
    await refreshModelManagement()
    if (audioBook) {
      await refreshAudioState(audioBook.id)
    }
  }

  const installModelFromPath = async () => {
    await dreamreaderClient.installModelFromPath()
    await refreshModelManagement()
    if (audioBook) {
      await refreshAudioState(audioBook.id)
    }
  }

  const deleteModel = async (modelId: string) => {
    await dreamreaderClient.deleteModel(modelId)
    await refreshModelManagement()
    if (audioBook) {
      await refreshAudioState(audioBook.id)
    }
  }

  const installSidecar = async (sidecarId: string) => {
    await dreamreaderClient.installSidecar(sidecarId)
    await refreshModelManagement()
  }

  const uninstallSidecar = async (sidecarId: string) => {
    await dreamreaderClient.uninstallSidecar(sidecarId)
    await refreshModelManagement()
  }

  const saveHuggingFaceToken = async (token: string) => {
    setHuggingFaceTokenStatus(await dreamreaderClient.updateHuggingFaceToken(token))
  }

  const updateSettings = (nextSettings: AppSettings) => {
    setSettings(nextSettings)
    setSettingsSaved(false)
  }

  const scheduleSettingsSave = (nextSettings: AppSettings, delay = 450) => {
    const signature = JSON.stringify(nextSettings)
    pendingSettingsSignatureRef.current = signature

    if (settingsSaveTimerRef.current) {
      window.clearTimeout(settingsSaveTimerRef.current)
    }

    settingsSaveTimerRef.current = window.setTimeout(async () => {
      const saved = await dreamreaderClient.saveSettings(nextSettings)
      if (pendingSettingsSignatureRef.current === signature) {
        setSettings(saved)
        setSettingsSaved(true)
      }
    }, delay)
  }

  const updateReaderPreference = <Key extends keyof ReaderPreferences>(key: Key, value: ReaderPreferences[Key]) => {
    if (!settings) {
      return
    }

    const nextSettings = {
      ...settings,
      reader: {
        ...settings.reader,
        [key]: value
      }
    }

    updateSettings(nextSettings)
    scheduleSettingsSave(nextSettings, key === "readingFlow" || key === "theme" ? 0 : 450)
  }

  const updateAudioSettings = (audio: AudioSettings, delay = 450) => {
    if (!settings) {
      return
    }

    const nextSettings = {
      ...settings,
      audio
    }

    updateSettings(nextSettings)
    scheduleSettingsSave(nextSettings, delay)
  }

  const saveSettings = async () => {
    if (!settings) {
      return
    }

    if (settingsSaveTimerRef.current) {
      window.clearTimeout(settingsSaveTimerRef.current)
      settingsSaveTimerRef.current = null
    }

    const saved = await dreamreaderClient.saveSettings(settings)
    pendingSettingsSignatureRef.current = JSON.stringify(saved)
    setSettings(saved)
    setSettingsSaved(true)
  }

  useEffect(() => {
    return () => {
      if (settingsSaveTimerRef.current) {
        window.clearTimeout(settingsSaveTimerRef.current)
      }
    }
  }, [])

  const shellClass = cn("h-screen overflow-hidden bg-background text-foreground", settings?.appearance && `theme-${settings.appearance}`)

  if (loading || !settings) {
    return (
      <main className={shellClass}>
        <div className="flex h-full items-center justify-center">
          <div className="flex items-center gap-3 rounded-md border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>{t("common.loading")}</span>
          </div>
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main className={shellClass}>
        <div className="flex h-full items-center justify-center px-6">
          <div className="w-full max-w-md rounded-md border bg-card p-5 shadow-sm">
            <h1 className="text-lg font-semibold">{t("common.error")}</h1>
            <button className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" onClick={loadInitialData}>
              {t("common.retry")}
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className={shellClass}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        {!readerIsClean ? (
          <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background/95 px-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <BookOpen className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h1 className="text-base font-semibold leading-tight">{t("app.name")}</h1>
                <p className="text-xs text-muted-foreground">{bridgeLabel}</p>
              </div>
            </div>
            <nav className="flex items-center gap-1 rounded-md border bg-card p-1" aria-label={t("common.actions")}>
              <NavButton icon={Library} label={t("nav.library")} active={activeView === "library"} onClick={() => setActiveView("library")} />
              <NavButton icon={BookOpen} label={t("nav.reader")} active={activeView === "reader"} onClick={() => setActiveView("reader")} />
              <NavButton icon={Headphones} label={t("nav.audio")} active={activeView === "audio"} onClick={openAudioDashboard} />
              <NavButton icon={ServerCog} label={t("nav.models")} active={activeView === "models"} onClick={openModelManager} />
              <NavButton icon={Settings} label={t("nav.settings")} active={activeView === "settings"} onClick={() => setActiveView("settings")} />
            </nav>
          </header>
        ) : null}

        {activeView === "library" ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <LibraryPane
              expanded
              books={books}
              count={filteredCount}
              importing={importing}
              mode={libraryMode}
              search={search}
              selectedBookId={selectedBook?.id}
              status={libraryStatus}
              t={t}
              onImport={importBooks}
              onModeChange={setLibraryMode}
              onSearchChange={updateSearch}
              onSelectBook={selectBook}
            />
          </div>
        ) : activeView === "audio" ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            {audioBook ? (
              <BookAudioPane
                audiobook={audiobookExport}
                book={audioBook}
                jobs={audioJobs}
                loading={audioLoading}
                audioSettings={settings.audio}
                models={runtimeModels}
                pronunciationEntries={pronunciationEntries}
                t={t}
                voices={voices}
                onBack={closeBookAudio}
                onCancelJob={cancelTtsJob}
                onClearChapterAudio={clearChapterAudio}
                onClearTerminalJobs={clearTerminalTtsJobs}
                onCreatePronunciationEntry={createPronunciationEntry}
                onDeletePronunciationEntry={deletePronunciationEntry}
                onGenerateChapter={generateChapterAudio}
                onGenerateChapters={generateChapters}
                onListSegments={listTtsSegments}
                onPauseJob={pauseTtsJob}
                onRebuildAudiobook={rebuildAudiobook}
                onResumeJob={resumeTtsJob}
                onRetryJob={retryTtsJob}
                onToggleAutoBuild={toggleAudiobookAutoBuild}
                onUpdateAudioSettings={updateAudioSettings}
              />
            ) : (
              <AudioDashboardPane
                audioStatus={libraryAudioStatus}
                books={books}
                jobs={audioJobs}
                loading={audioLoading}
                models={runtimeModels}
                voices={voices}
                t={t}
                onCancelJob={cancelTtsJob}
                onCreateVoiceFromDesignPrompt={createVoiceFromDesignPrompt}
                onCreateVoiceFromReference={createVoiceFromReference}
                onDeleteVoice={deleteVoice}
                onOpenBook={openBookAudio}
                onSelectVoiceReferenceAudio={selectVoiceReferenceAudio}
                onUpdateVoice={updateVoice}
              />
            )}
          </div>
        ) : activeView === "models" ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <ModelManagerPane
              diagnostics={diagnostics}
              downloadJobs={modelDownloadJobs}
              huggingFaceTokenStatus={huggingFaceTokenStatus}
              loading={modelManagementLoading}
              models={runtimeModels}
              operations={runtimeOperations}
              sidecars={runtimeSidecars}
              t={t}
              onDeleteModel={deleteModel}
              onDownloadModel={downloadModel}
              onInstallModel={installRecommendedModel}
              onInstallModelFromPath={installModelFromPath}
              onInstallSidecar={installSidecar}
              onRefresh={refreshModelManagement}
              onSaveHuggingFaceToken={saveHuggingFaceToken}
              onUninstallSidecar={uninstallSidecar}
            />
          </div>
        ) : (
          <div className={cn("grid min-h-0 flex-1 grid-cols-1 overflow-hidden", !cleanReading && "lg:grid-cols-[minmax(0,1fr)_340px]")}>
            <ReaderPane
              activeAnnotationId={activeAnnotationId}
              annotationFocusTick={annotationFocusTick}
              annotations={annotations}
              book={selectedBook}
              chapter={currentChapter}
              chapterIndex={chapterIndex}
              cleanReading={cleanReading}
              canReturn={returnChapterIndex !== null}
              preferences={settings.reader}
              t={t}
              onCreateAnnotation={createAnnotation}
              onDeleteAnnotation={deleteAnnotation}
              onFocusAnnotation={(annotation) => setActiveAnnotationId(annotation.id)}
              onJumpToAnnotation={jumpToAnnotation}
              onNext={() => changeChapter(1)}
              onPrevious={() => changeChapter(-1)}
              onReturn={returnToPreviousPosition}
              onSavePosition={saveReadingPosition}
              onToggleClean={() => setCleanReading((current) => !current)}
              onUpdateAnnotationColor={updateAnnotationColor}
            />

            {!cleanReading ? (
              <InspectorPane
                activeTab={inspectorTab}
                activeAnnotationId={activeAnnotationId}
                annotations={annotations}
                book={selectedBook}
                chapterIndex={chapterIndex}
                exportContent={exportContent}
                preferences={settings.reader}
                t={t}
                onChangePreference={updateReaderPreference}
                onChangeTab={setInspectorTab}
                onDeleteAnnotation={deleteAnnotation}
                onExportNotes={exportNotes}
                onJumpToAnnotation={jumpToAnnotation}
                onJumpToChapter={jumpToChapter}
              />
            ) : null}
          </div>
        )}

        {activeView === "settings" ? (
          <SettingsDialog
            settings={settings}
            saved={settingsSaved}
            t={t}
            onClose={() => setActiveView("reader")}
            onSave={saveSettings}
            onUpdate={updateSettings}
          />
        ) : null}
      </div>
    </main>
  )
}
