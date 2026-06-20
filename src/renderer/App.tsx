import { BookOpen, Headphones, Library, Loader2, Settings } from "lucide-react"
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react"
import { NavButton } from "@renderer/components/common/Controls"
import { StudioPane } from "@renderer/components/audio/StudioPane"
import { BookStudioPane } from "@renderer/components/audio/BookStudioPane"
import { EnginesPane } from "@renderer/components/models/EnginesPane"
import { SettingsDialog } from "@renderer/components/settings/SettingsDialog"
import { ThoriumLibraryPane } from "@renderer/components/thorium/ThoriumLibraryPane"
import { ThoriumReaderPane } from "@renderer/components/thorium/ThoriumReaderPane"
import { translate } from "@renderer/i18n"
import { dreamreaderClient } from "@renderer/lib/dreamreader"
import { effectiveInstallBackend } from "@renderer/lib/installBackends"
import {
  errorCode,
  libraryImportStatusForError,
  libraryImportStatusForResult
} from "@renderer/lib/appState"
import { cn } from "@renderer/lib/utils"
import type {
  AppView,
  LibraryStatus,
  LibraryStatusDescriptor
} from "@renderer/app/types"
import type {
  AppSettings,
  AudioSettings,
  BookDetails,
  BookSummary,
  ReaderLocator,
  RuntimeDiagnostic,
  RuntimeInstallBackend,
  RuntimeModel,
  RuntimeOperationJob,
  RuntimeSidecar,
  TtsJob,
  VoiceProfile,
  AudiobookBuildJob,
  AudiobookExport,
  LibraryAudioStatus,
  HuggingFaceTokenStatus,
  ModelDownloadJob
} from "@renderer/types"

export function App(): ReactElement {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [books, setBooks] = useState<BookSummary[]>([])
  const [selectedBook, setSelectedBook] = useState<BookDetails | null>(null)
  const [audioJobs, setAudioJobs] = useState<TtsJob[]>([])
  const [audiobookExport, setAudiobookExport] = useState<AudiobookExport | null>(null)
  const [audiobookBuildJob, setAudiobookBuildJob] = useState<AudiobookBuildJob | null>(null)
  const [audioLoading, setAudioLoading] = useState(false)
  const [modelManagementLoading, setModelManagementLoading] = useState(false)
  const [libraryAudioStatus, setLibraryAudioStatus] = useState<LibraryAudioStatus[]>([])
  const [audioBook, setAudioBook] = useState<BookDetails | null>(null)
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostic[]>([])
  const [runtimeModels, setRuntimeModels] = useState<RuntimeModel[]>([])
  const [modelDownloadJobs, setModelDownloadJobs] = useState<ModelDownloadJob[]>([])
  const [runtimeOperations, setRuntimeOperations] = useState<RuntimeOperationJob[]>([])
  const [runtimeSidecars, setRuntimeSidecars] = useState<RuntimeSidecar[]>([])
  const [installBackend, setInstallBackend] = useState<RuntimeInstallBackend>("auto")
  const [huggingFaceTokenStatus, setHuggingFaceTokenStatus] = useState<HuggingFaceTokenStatus>({ configured: false })
  const [voices, setVoices] = useState<VoiceProfile[]>([])
  const [activeView, setActiveView] = useState<AppView>("library")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [importing, setImporting] = useState(false)
  const [deletingBookId, setDeletingBookId] = useState<string | undefined>()
  const [libraryStatus, setLibraryStatus] = useState<LibraryStatus | null>(null)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const pendingSettingsSignatureRef = useRef("")
  const settingsSaveTimerRef = useRef<number | null>(null)
  const modelManagementRefreshIdRef = useRef(0)

  const locale = settings?.locale ?? "pt-BR"
  const t = useCallback((key: string, values?: Record<string, string | number>) => translate(locale, key, values), [locale])
  const selectedInstallBackend = effectiveInstallBackend(diagnostics, installBackend)
  const translateLibraryStatus = useCallback(
    (status: LibraryStatusDescriptor): LibraryStatus => {
      const translatedValues = Object.fromEntries(
        Object.entries(status.valueKeys ?? {}).map(([key, valueKey]) => [key, t(valueKey)])
      )
      return {
        tone: status.tone,
        message: t(status.messageKey, { ...status.values, ...translatedValues })
      }
    },
    [t]
  )

  const refreshBooks = useCallback(
    async (query = search) => {
      const nextBooks = await dreamreaderClient.listBooks({ search: query })
      setBooks(nextBooks)
      return nextBooks
    },
    [search]
  )

  const refreshAudioState = useCallback(async (bookId: string) => {
    const [nextJobs, nextExport, nextBuildJob, nextModels, nextVoices] = await Promise.all([
      dreamreaderClient.listTtsJobs({ bookId }),
      dreamreaderClient.getAudiobookExport(bookId),
      dreamreaderClient.getAudiobookBuildJob(bookId),
      dreamreaderClient.listModels(),
      dreamreaderClient.listCompatibleVoices()
    ])
    setAudioJobs(nextJobs)
    setAudiobookExport(nextExport)
    setAudiobookBuildJob(nextBuildJob)
    setRuntimeModels(nextModels)
    setVoices(nextVoices)
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
        const firstBook = await dreamreaderClient.getReaderBook(nextBooks[0].id)
        setSelectedBook(firstBook)
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

  const filteredCount = books.length
  const bridgeLabel = dreamreaderClient.hasBridge() ? t("app.connection.bridge") : t("app.connection.fallback")

  const updateSearch = async (value: string) => {
    setSearch(value)
    await refreshBooks(value)
  }

  const selectBook = async (bookId: string) => {
    const book = await dreamreaderClient.getReaderBook(bookId)
    setSelectedBook(book)
    setActiveView("reader")
  }

  const handleReaderPositionSaved = useCallback((locator: ReaderLocator) => {
    setSelectedBook((current) => current?.id === locator.bookId
      ? {
        ...current,
        lastChapterId: locator.chapterId,
        lastPosition: locator,
        progress: locator.progress,
        status: locator.progress >= 100 ? "finished" : "reading",
        updatedAt: locator.updatedAt
      }
      : current)
    setBooks((current) => current.map((book) => book.id === locator.bookId
      ? {
        ...book,
        progress: locator.progress,
        status: locator.progress >= 100 ? "finished" : "reading",
        updatedAt: locator.updatedAt
      }
      : book))
  }, [])

  useEffect(() => {
    if (activeView !== "audio") {
      return
    }

    const hasActiveJob = audioJobs.some((job) => !["completed", "failed", "cancelled", "paused"].includes(job.status))
    const hasActiveBuildJob = audiobookBuildJob ? ["queued", "building", "validating"].includes(audiobookBuildJob.status) : false
    if (!hasActiveJob && !hasActiveBuildJob) {
      return
    }

    const interval = window.setInterval(() => {
      void refreshActiveAudioView()
    }, 800)
    return () => window.clearInterval(interval)
  }, [activeView, audioJobs, audiobookBuildJob, refreshActiveAudioView])

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

  const deleteBook = async (book: BookSummary) => {
    const confirmed = window.confirm(t("library.deleteConfirm", { title: book.title }))
    if (!confirmed) {
      return
    }

    setDeletingBookId(book.id)
    setLibraryStatus({ tone: "info", message: t("library.deleting", { title: book.title }) })
    try {
      await dreamreaderClient.deleteBook(book.id)
      setBooks((current) => current.filter((item) => item.id !== book.id))
      if (selectedBook?.id === book.id) {
        setSelectedBook(null)
      }
      if (audioBook?.id === book.id) {
        setAudioBook(null)
        setAudioJobs([])
        setAudiobookExport(null)
        setAudiobookBuildJob(null)
      }
      const refreshedBooks = await refreshBooks()
      if (refreshedBooks.some((item) => item.id === book.id)) {
        throw Object.assign(new Error("Book is still present after deletion"), { code: "book_delete_still_present" })
      }
      setLibraryStatus({ tone: "success", message: t("library.deleteSuccess", { title: book.title }) })
    } catch (caught) {
      setLibraryStatus({
        tone: "error",
        message: t(errorCode(caught) === "book_has_active_audio_jobs" ? "library.deleteActiveAudio" : "library.deleteFailed", {
          title: book.title
        })
      })
    } finally {
      setDeletingBookId(undefined)
    }
  }

  const openAudioDashboard = () => {
    setActiveView("audio")
    setAudioBook(null)
    setAudiobookBuildJob(null)
    void refreshAudioDashboard()
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
    setAudiobookBuildJob(null)
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
    paragraphLimit?: number
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

  const cancelQueuedTtsJobs = async (jobIds: string[]) => {
    if (!jobIds.length) {
      return
    }

    setAudioLoading(true)
    try {
      await Promise.all(jobIds.map((jobId) => dreamreaderClient.cancelTtsJob(jobId)))
      await refreshActiveAudioView()
    } finally {
      setAudioLoading(false)
    }
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

  const clearAllTerminalTtsJobs = async () => {
    const terminalBookIds = [...new Set(
      audioJobs.filter((job) => ["completed", "failed", "cancelled"].includes(job.status)).map((job) => job.bookId)
    )]
    for (const bookId of terminalBookIds) {
      await dreamreaderClient.clearTerminalTtsJobs(bookId)
    }
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
    setAudiobookBuildJob(optimisticAudiobookBuildJob(audioBook.id, audiobookExport?.id))
    try {
      setAudiobookExport(await dreamreaderClient.rebuildAudiobook(audioBook.id))
      await refreshAudioState(audioBook.id)
    } finally {
      setAudioLoading(false)
    }
  }

  const saveAudiobook = async () => {
    if (!audioBook) {
      return
    }

    setAudioLoading(true)
    try {
      await dreamreaderClient.saveAudiobook(audioBook.id)
    } finally {
      setAudioLoading(false)
    }
  }

  const deleteAudiobookExport = async () => {
    if (!audioBook) {
      return
    }
    const confirmed = window.confirm(t("audio.deleteM4bConfirm"))
    if (!confirmed) {
      return
    }

    setAudioLoading(true)
    try {
      setAudiobookExport(await dreamreaderClient.deleteAudiobookExport(audioBook.id))
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

  const clearAllChapterAudio = async (chapterHrefs: string[]) => {
    if (!audioBook || !chapterHrefs.length) {
      return
    }

    setAudioLoading(true)
    try {
      for (const chapterHref of chapterHrefs) {
        await dreamreaderClient.clearChapterAudio({
          bookId: audioBook.id,
          chapterHref
        })
      }
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

  const generateVoiceDesignPreview = async (input: {
    engineId: string
    language: string
    prompt: string
    referenceVoiceProfileId?: string
    sampleText: string
  }) => {
    setAudioLoading(true)
    try {
      return await dreamreaderClient.generateVoiceDesignPreview(input)
    } finally {
      setAudioLoading(false)
    }
  }

  const commitVoiceDesignPreview = async (input: { previewId: string; name: string }) => {
    setAudioLoading(true)
    try {
      const voice = await dreamreaderClient.commitVoiceDesignPreview(input)
      await refreshActiveAudioView()
      return voice
    } finally {
      setAudioLoading(false)
    }
  }

  const discardVoiceDesignPreview = async (previewId: string) => {
    await dreamreaderClient.discardVoiceDesignPreview(previewId)
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

  const exportVoice = async (voiceProfileId: string) => {
    setAudioLoading(true)
    try {
      await dreamreaderClient.exportVoice(voiceProfileId)
    } finally {
      setAudioLoading(false)
    }
  }

  const importVoices = async () => {
    setAudioLoading(true)
    try {
      await dreamreaderClient.importVoices()
      await refreshActiveAudioView()
    } finally {
      setAudioLoading(false)
    }
  }

  const previewVoice = async (voiceProfileId: string, engineId: string) => dreamreaderClient.previewVoice(voiceProfileId, engineId)

  const listPronunciation = (bookId?: string) => dreamreaderClient.listPronunciationEntries(bookId)

  const createPronunciation = async (input: { bookId?: string; pattern: string; replacement: string; scope: "global" | "book" }) => {
    if (!input.pattern.trim() || !input.replacement.trim()) {
      return
    }
    await dreamreaderClient.createPronunciationEntry({
      bookId: input.scope === "book" ? input.bookId : undefined,
      matchKind: "word",
      pattern: input.pattern.trim(),
      replacement: input.replacement.trim(),
      scope: input.scope
    })
  }

  const deletePronunciation = (id: string) => dreamreaderClient.deletePronunciationEntry(id)

  const downloadModel = async (modelId: string) => {
    await dreamreaderClient.downloadModel(modelId)
    await refreshModelManagement()
    if (audioBook) {
      await refreshAudioState(audioBook.id)
    }
  }

  const installRecommendedModel = async (modelId: string) => {
    await dreamreaderClient.installRecommendedModel(modelId, selectedInstallBackend)
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
    await dreamreaderClient.installSidecar(sidecarId, selectedInstallBackend)
    await refreshModelManagement()
  }

  const uninstallSidecar = async (sidecarId: string) => {
    await dreamreaderClient.uninstallSidecar(sidecarId)
    await refreshModelManagement()
  }

  const installEngine = async (modelId: string) => {
    const model = runtimeModels.find((m) => m.id === modelId)
    const sidecar = runtimeSidecars.find((s) => (model?.engineId ? s.modelEngineIds.includes(model.engineId) : false))
    if (sidecar && sidecar.status !== "available") {
      await dreamreaderClient.installSidecar(sidecar.id, selectedInstallBackend)
    }
    if (model) {
      if (model.metadata.huggingFaceRepo && model.metadata.localFolder) {
        await dreamreaderClient.installRecommendedModel(modelId, selectedInstallBackend)
      } else if (model.canDownload) {
        await dreamreaderClient.downloadModel(modelId)
      }
    }
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

  const updateSettingsAndScheduleSave = (nextSettings: AppSettings) => {
    updateSettings(nextSettings)
    scheduleSettingsSave(nextSettings)
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
            <NavButton icon={Settings} label={t("nav.settings")} active={activeView === "settings"} onClick={() => setActiveView("settings")} />
          </nav>
        </header>

        {activeView === "library" ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <ThoriumLibraryPane
              books={books}
              count={filteredCount}
              importing={importing}
              search={search}
              selectedBookId={selectedBook?.id}
              status={libraryStatus}
              t={t}
              deletingBookId={deletingBookId}
              onDeleteBook={deleteBook}
              onImport={importBooks}
              onSearchChange={updateSearch}
              onSelectBook={selectBook}
            />
          </div>
        ) : activeView === "audio" ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            {audioBook ? (
              <BookStudioPane
                audiobook={audiobookExport}
                audiobookBuildJob={audiobookBuildJob}
                book={audioBook}
                jobs={audioJobs}
                loading={audioLoading}
                audioSettings={settings.audio}
                models={runtimeModels}
                t={t}
                voices={voices}
                onBack={closeBookAudio}
                onCancelQueuedJobs={cancelQueuedTtsJobs}
                onClearAllChapterAudio={clearAllChapterAudio}
                onCancelJob={cancelTtsJob}
                onClearChapterAudio={clearChapterAudio}
                onClearTerminalJobs={clearTerminalTtsJobs}
                onGenerateChapter={generateChapterAudio}
                onGenerateChapters={generateChapters}
                onListSegments={listTtsSegments}
                onPauseJob={pauseTtsJob}
                onRebuildAudiobook={rebuildAudiobook}
                onDeleteAudiobookExport={deleteAudiobookExport}
                onSaveAudiobook={saveAudiobook}
                onResumeJob={resumeTtsJob}
                onRetryJob={retryTtsJob}
                onToggleAutoBuild={toggleAudiobookAutoBuild}
                onUpdateAudioSettings={updateAudioSettings}
              />
            ) : (
              <StudioPane
                audioStatus={libraryAudioStatus}
                audioSettings={settings.audio}
                books={books}
                enginesContent={
                  <EnginesPane
                    diagnostics={diagnostics}
                    downloadJobs={modelDownloadJobs}
                    huggingFaceTokenStatus={huggingFaceTokenStatus}
                    installBackend={selectedInstallBackend}
                    loading={modelManagementLoading}
                    models={runtimeModels}
                    operations={runtimeOperations}
                    sidecars={runtimeSidecars}
                    voices={voices}
                    t={t}
                    onDeleteModel={deleteModel}
                    onDownloadModel={downloadModel}
                    onInstallModel={installRecommendedModel}
                    onInstallModelFromPath={installModelFromPath}
                    onInstallSidecar={installSidecar}
                    onInstallEngine={installEngine}
                    onRefresh={refreshModelManagement}
                    onSaveHuggingFaceToken={saveHuggingFaceToken}
                    onSelectInstallBackend={setInstallBackend}
                    onUninstallSidecar={uninstallSidecar}
                  />
                }
                jobs={audioJobs}
                loading={audioLoading}
                models={runtimeModels}
                voices={voices}
                t={t}
                onCancelJob={cancelTtsJob}
                onClearFinished={clearAllTerminalTtsJobs}
                onCommitVoiceDesignPreview={commitVoiceDesignPreview}
                onCreatePronunciation={createPronunciation}
                onCreateVoiceFromReference={createVoiceFromReference}
                onDeletePronunciation={deletePronunciation}
                onDeleteVoice={deleteVoice}
                onDiscardVoiceDesignPreview={discardVoiceDesignPreview}
                onExportVoice={exportVoice}
                onGenerateVoiceDesignPreview={generateVoiceDesignPreview}
                onImportVoices={importVoices}
                onListPronunciation={listPronunciation}
                onOpenBook={openBookAudio}
                onPauseJob={pauseTtsJob}
                onPreviewVoice={previewVoice}
                onResumeJob={resumeTtsJob}
                onRetryJob={retryTtsJob}
                onSelectVoiceReferenceAudio={selectVoiceReferenceAudio}
                onUpdateAudioSettings={updateAudioSettings}
                onUpdateVoice={updateVoice}
              />
            )}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden">
            <ThoriumReaderPane book={selectedBook} locale={locale} t={t} onPositionSaved={handleReaderPositionSaved} />
          </div>
        )}

        {activeView === "settings" ? (
          <SettingsDialog
            settings={settings}
            saved={settingsSaved}
            t={t}
            onClose={() => setActiveView("reader")}
            onSave={saveSettings}
            onUpdate={updateSettingsAndScheduleSave}
          />
        ) : null}
      </div>
    </main>
  )
}

function optimisticAudiobookBuildJob(bookId: string, audiobookExportId = "pending"): AudiobookBuildJob {
  const now = new Date().toISOString()
  return {
    id: `pending-${bookId}`,
    bookId,
    audiobookExportId,
    status: "queued",
    progress: 0,
    reason: "manual_rebuild",
    createdAt: now,
    updatedAt: now
  }
}
