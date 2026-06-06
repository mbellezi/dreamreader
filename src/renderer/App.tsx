import {
  Bookmark,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Download,
  FileText,
  Grid2X2,
  Highlighter,
  Library,
  List,
  Loader2,
  Maximize2,
  MessageSquareText,
  Minimize2,
  PanelRight,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  TextAlignJustify,
  TextAlignStart,
  Trash2,
  Type,
  Undo2
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactElement } from "react"
import { translate } from "@renderer/i18n"
import { dreamreaderClient } from "@renderer/lib/dreamreader"
import { clamp, cn, formatAuthors } from "@renderer/lib/utils"
import type {
  Annotation,
  AnnotationKind,
  AppSettings,
  AppearanceTheme,
  BookDetails,
  BookSummary,
  HighlightColor,
  Locale,
  ReaderFontFamily,
  ReaderLocator,
  ReaderPreferences
} from "@renderer/types"

type AppView = "library" | "reader" | "settings"
type LibraryMode = "grid" | "list"
type InspectorTab = "summary" | "annotations" | "preferences"
type ReaderSelection = {
  overlappingAnnotationIds: string[]
  text: string
  x: number
  y: number
}
type AnnotationMenuState = {
  annotation: Annotation
  x: number
  y: number
}
type PageEdgeHint = "previous" | "next"
type TextLineBox = {
  bottom: number
  top: number
}
type LibraryStatus = {
  tone: "info" | "success" | "warning" | "error"
  message: string
}

const READING_SETTLE_MS = 12000

const themeOptions: AppearanceTheme[] = ["light", "dark", "sepia", "contrast"]
const colorOptions: HighlightColor[] = ["yellow", "green", "blue", "rose", "purple"]
const fontFamilyOptions: Array<{ value: ReaderFontFamily; labelKey: string; stack: string }> = [
  { value: "georgia", labelKey: "reader.font.georgia", stack: 'Georgia, Cambria, "Times New Roman", serif' },
  { value: "palatino", labelKey: "reader.font.palatino", stack: 'Palatino, "Palatino Linotype", "Book Antiqua", serif' },
  { value: "charter", labelKey: "reader.font.charter", stack: 'Charter, "Iowan Old Style", "Athelas", Georgia, serif' },
  { value: "system-serif", labelKey: "reader.font.systemSerif", stack: 'ui-serif, Georgia, Cambria, "Times New Roman", serif' },
  { value: "system-sans", labelKey: "reader.font.systemSans", stack: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }
]

const fontStackByFamily = Object.fromEntries(fontFamilyOptions.map((option) => [option.value, option.stack])) as Record<ReaderFontFamily, string>

const swatchClasses: Record<HighlightColor, string> = {
  yellow: "bg-yellow-300",
  green: "bg-emerald-300",
  blue: "bg-sky-300",
  rose: "bg-rose-300",
  purple: "bg-violet-300"
}

const inlineHighlightClasses: Record<HighlightColor, string> = {
  yellow: "bg-yellow-200/55 text-inherit",
  green: "bg-emerald-200/55 text-inherit",
  blue: "bg-sky-200/55 text-inherit",
  rose: "bg-rose-200/55 text-inherit",
  purple: "bg-violet-200/55 text-inherit"
}

const themePreviewClasses: Record<AppearanceTheme, string> = {
  light: "bg-white",
  dark: "bg-neutral-950",
  sepia: "bg-[#f3e6cc]",
  contrast: "bg-black ring-2 ring-yellow-300"
}

export function App(): ReactElement {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [books, setBooks] = useState<BookSummary[]>([])
  const [selectedBook, setSelectedBook] = useState<BookDetails | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
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
  const [returnChapterIndex, setReturnChapterIndex] = useState<number | null>(null)
  const stableChapterIndexRef = useRef<number | null>(null)
  const pendingSettingsSignatureRef = useRef("")
  const settingsSaveTimerRef = useRef<number | null>(null)

  const locale = settings?.locale ?? "pt-BR"
  const t = useCallback((key: string, values?: Record<string, string | number>) => translate(locale, key, values), [locale])

  const refreshBooks = useCallback(
    async (query = search) => {
      const nextBooks = await dreamreaderClient.listBooks({ search: query })
      setBooks(nextBooks)
    },
    [search]
  )

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

  const importBooks = async () => {
    setImporting(true)
    setLibraryStatus({ tone: "info", message: t("library.importing") })

    try {
      const result = await dreamreaderClient.importBooks()
      setBooks(result.books)

      if (result.importedCount > 0 && result.skipped.length === 0) {
        setLibraryStatus({
          tone: "success",
          message: t("library.importSuccess", { count: result.importedCount })
        })
        return
      }

      if (result.importedCount > 0 && result.skipped.length > 0) {
        setLibraryStatus({
          tone: "warning",
          message: t("library.importPartial", {
            imported: result.importedCount,
            skipped: result.skipped.length
          })
        })
        return
      }

      if (result.skipped.length > 0) {
        setLibraryStatus({
          tone: result.skipped.every((item) => item.reason === "duplicate") ? "info" : "error",
          message: t(`library.importSkipped.${result.skipped[0].reason}`, { count: result.skipped.length })
        })
        return
      }

      setLibraryStatus({ tone: "info", message: t("library.importNoSelection") })
    } catch (caught) {
      const code = errorCode(caught)
      setLibraryStatus({
        tone: "error",
        message: code === "library_import_requires_app_bridge" ? t("library.importUnavailable") : t("library.importFailed")
      })
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
        ) : (
          <div className={cn("grid min-h-0 flex-1 grid-cols-1 overflow-hidden", !cleanReading && "lg:grid-cols-[minmax(0,1fr)_340px]")}>
            <ReaderPane
              activeAnnotationId={activeAnnotationId}
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

function NavButton({
  active,
  icon: Icon,
  label,
  onClick
}: {
  active: boolean
  icon: typeof Library
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-sm px-3 text-sm text-muted-foreground transition",
        active && "bg-background text-foreground shadow-sm"
      )}
      title={label}
      onClick={onClick}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

function LibraryPane({
  expanded = false,
  books,
  count,
  importing,
  mode,
  search,
  selectedBookId,
  status,
  t,
  onImport,
  onModeChange,
  onSearchChange,
  onSelectBook
}: {
  expanded?: boolean
  books: BookSummary[]
  count: number
  importing: boolean
  mode: LibraryMode
  search: string
  selectedBookId?: string
  status: LibraryStatus | null
  t: (key: string, values?: Record<string, string | number>) => string
  onImport: () => void
  onModeChange: (mode: LibraryMode) => void
  onSearchChange: (value: string) => void
  onSelectBook: (bookId: string) => void
}) {
  return (
    <aside className={cn("flex h-full min-h-0 flex-col overflow-hidden bg-sidebar", expanded ? "" : "border-r")}>
      <div className="shrink-0 border-b p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t("library.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("library.subtitle", { count })}</p>
          </div>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
            disabled={importing}
            onClick={onImport}
          >
            {importing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
            {importing ? t("library.importingShort") : t("library.import")}
          </button>
        </div>

        {status ? (
          <div
            className={cn(
              "mt-3 rounded-md border px-3 py-2 text-sm",
              status.tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-900",
              status.tone === "warning" && "border-amber-200 bg-amber-50 text-amber-900",
              status.tone === "error" && "border-rose-200 bg-rose-50 text-rose-900",
              status.tone === "info" && "border-border bg-background text-muted-foreground"
            )}
          >
            {status.message}
          </div>
        ) : null}

        <label className="mt-4 block text-xs font-medium text-muted-foreground" htmlFor="library-search">
          {t("library.searchLabel")}
        </label>
        <div className="mt-2 flex h-10 items-center gap-2 rounded-md border bg-background px-3">
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input
            id="library-search"
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder={t("library.searchPlaceholder")}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>

        <div className="mt-3 flex items-center gap-1 rounded-md border bg-background p-1">
          <IconToggle active={mode === "grid"} icon={Grid2X2} label={t("library.grid")} onClick={() => onModeChange("grid")} />
          <IconToggle active={mode === "list"} icon={List} label={t("library.list")} onClick={() => onModeChange("list")} />
        </div>
      </div>

      <div
        className={cn(
          "min-h-0 flex-1 overflow-auto p-3",
          mode === "grid" &&
            (expanded
              ? "grid content-start justify-start gap-x-7 gap-y-9 [grid-template-columns:repeat(auto-fill,minmax(118px,150px))]"
              : "grid content-start justify-center gap-5 [grid-template-columns:minmax(112px,140px)]"),
          mode === "list" && "space-y-2",
          expanded && mode === "list" && "mx-auto w-full max-w-5xl"
        )}
      >
        {books.length ? (
          books.map((book) => (
            <BookCard key={book.id} book={book} mode={mode} selected={book.id === selectedBookId} t={t} onSelect={() => onSelectBook(book.id)} />
          ))
        ) : (
          <div className="rounded-md border bg-card p-4">
            <h3 className="text-sm font-medium">{t("library.emptyTitle")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t("library.emptyBody")}</p>
          </div>
        )}
      </div>
    </aside>
  )
}

function BookCard({
  book,
  mode,
  selected,
  t,
  onSelect
}: {
  book: BookSummary
  mode: LibraryMode
  selected: boolean
  t: (key: string, values?: Record<string, string | number>) => string
  onSelect: () => void
}) {
  if (mode === "grid") {
    return (
      <button className="group w-full text-left" title={t("library.openBook")} onClick={onSelect}>
        <div
          className={cn(
            "relative aspect-[2/3] w-full overflow-hidden rounded-[3px] bg-card shadow-[0_14px_30px_rgba(15,23,42,0.22)] ring-1 ring-black/10 transition group-hover:-translate-y-0.5 group-hover:ring-primary/45",
            selected && "ring-2 ring-primary"
          )}
          style={{ backgroundColor: book.coverColor }}
        >
          {book.coverImageUrl ? (
            <img className="h-full w-full object-cover" src={book.coverImageUrl} alt="" />
          ) : (
            <div className="flex h-full flex-col justify-between p-3 text-primary-foreground">
              <FileText className="h-5 w-5" aria-hidden="true" />
              <div>
                <p className="line-clamp-4 text-sm font-semibold leading-tight">{book.title}</p>
                <p className="mt-2 line-clamp-2 text-[11px] leading-tight opacity-80">{formatAuthors(book.authors)}</p>
              </div>
            </div>
          )}
          {book.progress > 0 ? (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-black/20">
              <div className="h-full bg-primary" style={{ width: `${book.progress}%` }} />
            </div>
          ) : null}
        </div>
        <div className="mt-2 min-w-0">
          <h3 className="truncate text-sm font-semibold leading-tight">{book.title}</h3>
          <p className="truncate text-xs text-muted-foreground">{formatAuthors(book.authors)}</p>
        </div>
      </button>
    )
  }

  return (
    <button
      className={cn(
        "flex w-full items-center gap-3 rounded-md border bg-card p-3 text-left shadow-sm transition hover:border-primary/50",
        selected && "border-primary ring-2 ring-primary/15"
      )}
      onClick={onSelect}
    >
      <div
        className={cn(
          "flex shrink-0 items-end overflow-hidden rounded-sm text-primary-foreground shadow-inner",
          "h-24 w-16",
          !book.coverImageUrl && "p-2"
        )}
        style={{ backgroundColor: book.coverColor }}
      >
        {book.coverImageUrl ? (
          <img className="h-full w-full object-contain" src={book.coverImageUrl} alt="" />
        ) : (
          <FileText className="h-5 w-5" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{book.title}</h3>
            <p className="truncate text-xs text-muted-foreground">{formatAuthors(book.authors)}</p>
          </div>
          <span className="rounded-sm border px-1.5 py-0.5 text-[11px] text-muted-foreground">{t(`library.format.${book.format}`)}</span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${book.progress}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{t("library.progress", { progress: book.progress })}</span>
          <span>{t(`library.status.${book.status}`)}</span>
        </div>
      </div>
    </button>
  )
}

function ReaderPane({
  activeAnnotationId,
  annotations,
  book,
  canReturn,
  chapter,
  chapterIndex,
  cleanReading,
  preferences,
  t,
  onCreateAnnotation,
  onDeleteAnnotation,
  onFocusAnnotation,
  onJumpToAnnotation,
  onNext,
  onPrevious,
  onReturn,
  onSavePosition,
  onToggleClean,
  onUpdateAnnotationColor
}: {
  activeAnnotationId: string | null
  annotations: Annotation[]
  book: BookDetails | null
  canReturn: boolean
  chapter: BookDetails["chapters"][number] | null
  chapterIndex: number
  cleanReading: boolean
  preferences: ReaderPreferences
  t: (key: string, values?: Record<string, string | number>) => string
  onCreateAnnotation: (draft: { chapterId: string; color: HighlightColor; excerpt: string; kind: AnnotationKind; note: string }) => Promise<void> | void
  onDeleteAnnotation: (annotationId: string) => Promise<void> | void
  onFocusAnnotation: (annotation: Annotation) => void
  onJumpToAnnotation: (annotation: Annotation) => void
  onNext: () => void
  onPrevious: () => void
  onReturn: () => void
  onSavePosition: (locator: ReaderLocator) => Promise<void> | void
  onToggleClean: () => void
  onUpdateAnnotationColor: (annotationId: string, color: HighlightColor) => Promise<void> | void
}) {
  const articleRef = useRef<HTMLElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const isRestoringPositionRef = useRef(false)
  const lastSavedPositionRef = useRef("")
  const latestPositionRef = useRef<ReaderLocator | undefined>(undefined)
  const knownLastPageCountRef = useRef<number | null>(null)
  const pageCountRef = useRef(1)
  const pageIndexRef = useRef(0)
  const pageOffsetRef = useRef(0)
  const pageOffsetsRef = useRef<number[]>([0])
  const savePositionTimerRef = useRef<number | null>(null)
  const [annotationMenu, setAnnotationMenu] = useState<AnnotationMenuState | null>(null)
  const [pageEdgeHint, setPageEdgeHint] = useState<PageEdgeHint | null>(null)
  const [pageCount, setPageCount] = useState(1)
  const [pageClipHeight, setPageClipHeight] = useState<number | null>(null)
  const [pageIndex, setPageIndex] = useState(0)
  const [pageOffset, setPageOffset] = useState(0)
  const [pageStep, setPageStep] = useState(1)
  const [paginatedBottomPadding, setPaginatedBottomPadding] = useState(28)
  const [selection, setSelection] = useState<ReaderSelection | null>(null)
  const [noteDraft, setNoteDraft] = useState("")
  const [selectedColor, setSelectedColor] = useState<HighlightColor>("yellow")
  const progress = book?.chapters.length ? Math.round(((chapterIndex + 1) / book.chapters.length) * 100) : 0
  const paragraphs = useMemo(
    () => chapter?.text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean) ?? [],
    [chapter]
  )
  const chapterAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.chapterId === chapter?.id),
    [annotations, chapter?.id]
  )
  const readerFontFamily = fontStackByFamily[preferences.fontFamily] ?? fontStackByFamily.georgia
  const contentMaxWidth = preferences.columnCount === 2 ? preferences.columnWidth * 2 + 72 : preferences.columnWidth
  const isPaginated = preferences.readingFlow === "paginated"
  const readerVerticalPadding = cleanReading ? 36 : 28
  const readerLineHeightPx = Math.max(preferences.fontScale * preferences.lineHeight, 1)
  const readerTopPadding = isPaginated ? readerLineHeightPx : readerVerticalPadding
  const paginatedParagraphSpacing = Math.max(1, Math.round(preferences.paragraphSpacing)) * readerLineHeightPx
  const readerAnchorInset = isPaginated ? readerTopPadding : 8
  const chapterTextProgress = isPaginated && contentRef.current
    ? visibleChapterProgressFor(
      contentRef.current,
      pageOffset,
      Math.max((pageClipHeight ?? readerTopPadding + pageStep) - readerTopPadding, 1)
    )
    : 0

  const setCurrentPage = useCallback((nextPageIndex: number, nextPageOffset = pageOffsetsRef.current[nextPageIndex] ?? 0) => {
    pageIndexRef.current = nextPageIndex
    pageOffsetRef.current = nextPageOffset
    setPageIndex(nextPageIndex)
    setPageOffset(nextPageOffset)
    if (!Number.isNaN(nextPageOffset)) {
      pageOffsetsRef.current[nextPageIndex] = nextPageOffset
    }
  }, [])

  const setStablePageCount = useCallback((nextPageCount: number, allowDecrease = false) => {
    const resolvedPageCount = allowDecrease
      ? nextPageCount
      : Math.max(pageCountRef.current, nextPageCount)

    pageCountRef.current = resolvedPageCount
    setPageCount(resolvedPageCount)
    return resolvedPageCount
  }, [])

  const pageStepFor = useCallback(
    (article: HTMLElement) => {
      const contentHeight = Math.max(article.clientHeight - readerTopPadding, readerLineHeightPx)
      const lineCount = Math.max(1, Math.floor(contentHeight / readerLineHeightPx))
      return Math.max(lineCount * readerLineHeightPx, 1)
    },
    [readerLineHeightPx, readerTopPadding]
  )

  const measurePages = useCallback(() => {
    const article = articleRef.current
    if (!article) {
      setPageCount(1)
      setPageClipHeight(null)
      return 1
    }

    const contentHeight = contentRef.current ? measureReadableContentHeight(contentRef.current) : 0
    const nextPageStep = isPaginated ? pageStepFor(article) : Math.max(article.clientHeight, 1)
    const readableHeight = Math.max(contentHeight, nextPageStep)
    const estimatedPageCount = isPaginated ? Math.max(1, Math.ceil(readableHeight / nextPageStep)) : 1
    const lockedPageCount = knownLastPageCountRef.current
    const nextPageCount = lockedPageCount ?? Math.max(estimatedPageCount, pageOffsetsRef.current.length, pageIndexRef.current + 1)
    const nextPageIndex = isPaginated ? clamp(pageIndexRef.current, 0, nextPageCount - 1) : 0
    const nextPageOffset = pageOffsetsRef.current[nextPageIndex] ?? 0
    const nextBottomPadding = isPaginated
      ? Math.max(article.clientHeight, readerLineHeightPx)
      : readerVerticalPadding

    setPageClipHeight(isPaginated && contentRef.current ? readerTopPadding + visiblePageHeightFor(contentRef.current, nextPageOffset, nextPageStep) : null)
    setPageStep(nextPageStep)
    const resolvedPageCount = setStablePageCount(nextPageCount, lockedPageCount !== null)
    setCurrentPage(nextPageIndex)
    setPaginatedBottomPadding(nextBottomPadding)
    return resolvedPageCount
  }, [isPaginated, pageStepFor, readerLineHeightPx, readerTopPadding, readerVerticalPadding, setCurrentPage, setStablePageCount])

  const saveCurrentPosition = useCallback(() => {
    const article = articleRef.current
    if (!book || !chapter || !article) {
      return
    }

    const anchor = readVisibleTextAnchor(article, readerAnchorInset)
    const nextPageCount = isPaginated ? measurePages() : pageCount
    const nextPageStep = isPaginated ? pageStepFor(article) : pageStep
    const nextPageIndex = isPaginated
      ? clamp(pageIndexRef.current, 0, nextPageCount - 1)
      : 0
    const virtualScrollTop = isPaginated ? pageOffsetRef.current : article.scrollTop
    const scrollableHeight = isPaginated
      ? Math.max((contentRef.current ? measureReadableContentHeight(contentRef.current) : 0) - nextPageStep, 0)
      : Math.max(article.scrollHeight - article.clientHeight, 0)
    const scrollProgress = scrollableHeight > 0 ? clamp(virtualScrollTop / scrollableHeight, 0, 1) : 0
    const progress = Math.round(((chapterIndex + scrollProgress) / Math.max(book.chapters.length, 1)) * 100)
    const locator: ReaderLocator = {
      anchorParagraphIndex: anchor?.paragraphIndex,
      anchorText: anchor?.text,
      anchorTextOffset: anchor?.textOffset,
      bookId: book.id,
      chapterId: chapter.id,
      pageCount: isPaginated ? nextPageCount : undefined,
      pageIndex: isPaginated ? nextPageIndex : undefined,
      progress: clamp(progress, 0, 100),
      readingFlow: preferences.readingFlow,
      scrollProgress,
      scrollTop: Math.round(virtualScrollTop),
      updatedAt: new Date().toISOString()
    }
    const signature = [
      locator.bookId,
      locator.chapterId,
      locator.readingFlow,
      locator.pageIndex ?? "",
      locator.pageCount ?? "",
      locator.scrollTop ?? 0,
      locator.anchorParagraphIndex ?? "",
      locator.anchorTextOffset ?? "",
      locator.anchorText ?? "",
      locator.progress
    ].join(":")

    if (signature === lastSavedPositionRef.current) {
      return
    }

    lastSavedPositionRef.current = signature
    latestPositionRef.current = locator
    void onSavePosition(locator)
  }, [book, chapter, chapterIndex, isPaginated, measurePages, onSavePosition, pageCount, pageStep, pageStepFor, preferences.readingFlow, readerAnchorInset])

  const schedulePositionSave = useCallback(
    (delay = 900) => {
      if (savePositionTimerRef.current) {
        window.clearTimeout(savePositionTimerRef.current)
      }
      savePositionTimerRef.current = window.setTimeout(saveCurrentPosition, delay)
    },
    [saveCurrentPosition]
  )

  const goToPage = useCallback(
    (nextPageIndex: number) => {
      const article = articleRef.current
      const content = contentRef.current
      if (!article || !content) {
        return
      }

      const nextPageCount = measurePages()
      const nextPageStep = pageStepFor(article)

      if (isPaginated && nextPageIndex > pageIndexRef.current) {
        const currentPageIndex = pageIndexRef.current
        const currentOffset = pageOffsetRef.current
        const existingOffset = pageOffsetsRef.current[nextPageIndex]
        const nextOffset = existingOffset ?? findNextPageOffset(content, currentOffset, nextPageStep)

        if (nextOffset === undefined || nextOffset <= currentOffset + 0.5) {
          knownLastPageCountRef.current = currentPageIndex + 1
          setStablePageCount(currentPageIndex + 1, true)
          setPageEdgeHint(null)
          return
        }

        const safePageIndex = currentPageIndex + 1
        const nextOffsets = pageOffsetsRef.current.slice(0, safePageIndex + 1)
        nextOffsets[safePageIndex] = nextOffset
        pageOffsetsRef.current = nextOffsets
        setCurrentPage(safePageIndex, nextOffset)
        setPageStep(nextPageStep)
        setPageClipHeight(readerTopPadding + visiblePageHeightFor(content, nextOffset, nextPageStep))
        setStablePageCount(Math.max(nextPageCount, safePageIndex + 1))
        article.scrollTo({ top: 0, left: 0, behavior: "auto" })
        schedulePositionSave(250)
        return
      }

      if (isPaginated && nextPageIndex < pageIndexRef.current) {
        const safePageIndex = Math.max(0, pageIndexRef.current - 1)
        const nextOffset = pageOffsetsRef.current[safePageIndex] ?? findPreviousPageOffset(content, pageOffsetRef.current, nextPageStep)
        pageOffsetsRef.current[safePageIndex] = nextOffset
        setCurrentPage(safePageIndex, nextOffset)
        setPageStep(nextPageStep)
        setPageClipHeight(readerTopPadding + visiblePageHeightFor(content, nextOffset, nextPageStep))
        article.scrollTo({ top: 0, left: 0, behavior: "auto" })
        schedulePositionSave(250)
        return
      }

      const safePageIndex = clamp(nextPageIndex, 0, nextPageCount - 1)
      const nextScrollTop = Math.min(safePageIndex * nextPageStep, Math.max(article.scrollHeight - article.clientHeight, 0))
      setCurrentPage(safePageIndex)
      setPageStep(nextPageStep)
      setPageClipHeight(isPaginated ? readerTopPadding + visiblePageHeightFor(content, pageOffsetsRef.current[safePageIndex] ?? 0, nextPageStep) : null)
      article.scrollTo({
        top: nextScrollTop,
        behavior: "auto"
      })
      schedulePositionSave(250)
    },
    [isPaginated, measurePages, pageStepFor, readerTopPadding, schedulePositionSave, setCurrentPage, setStablePageCount]
  )

  useEffect(() => {
    const article = articleRef.current
    if (!article) {
      return
    }

    const latestPosition = latestPositionRef.current?.chapterId === chapter?.id ? latestPositionRef.current : undefined
    const savedPosition = latestPosition ?? (book?.lastPosition?.chapterId === chapter?.id ? book?.lastPosition : undefined)
    isRestoringPositionRef.current = true
    lastSavedPositionRef.current = ""
    knownLastPageCountRef.current = null
    pageCountRef.current = 1
    pageOffsetsRef.current = [0]
    setAnnotationMenu(null)
    setPageCount(1)
    setSelection(null)
    setNoteDraft("")

    window.requestAnimationFrame(() => {
      const nextPageCount = measurePages()

      if (preferences.readingFlow === "paginated") {
        const nextPageStep = pageStepFor(article)
        const contentHeight = contentRef.current ? measureReadableContentHeight(contentRef.current) : 0
        const maxOffset = Math.max(contentHeight - nextPageStep, 0)
        const anchorOffset = savedPosition && contentRef.current
          ? offsetForTextAnchor(article, contentRef.current, savedPosition)
          : undefined
        const restoredOffset = clamp(
          anchorOffset ?? savedPosition?.scrollTop ?? ((savedPosition?.scrollProgress ?? 0) * maxOffset),
          0,
          maxOffset
        )
        const savedPageIndex = (
          savedPosition?.readingFlow === "paginated"
            ? savedPosition.pageIndex ?? 0
            : Math.floor(restoredOffset / nextPageStep)
        )
        const nextPageIndex = clamp(savedPageIndex, 0, nextPageCount - 1)
        pageOffsetsRef.current = [0]
        pageOffsetsRef.current[nextPageIndex] = restoredOffset
        setCurrentPage(nextPageIndex, restoredOffset)
        setPageStep(nextPageStep)
        if (contentRef.current) {
          setPageClipHeight(readerTopPadding + visiblePageHeightFor(contentRef.current, restoredOffset, nextPageStep))
        }
        article.scrollTo({ top: 0, left: 0 })
      } else {
        const restoredFromAnchor = savedPosition ? restoreToTextAnchor(article, savedPosition, readerAnchorInset) : false
        pageOffsetsRef.current = [0]
        setCurrentPage(0, 0)
        if (!restoredFromAnchor) {
          article.scrollTo({ top: savedPosition?.scrollTop ?? 0, left: 0 })
        }
      }

      window.setTimeout(() => {
        isRestoringPositionRef.current = false
      }, 150)
    })
  }, [book?.id, book?.lastPosition, chapter?.id, measurePages, pageStepFor, preferences.readingFlow, readerAnchorInset, readerTopPadding, setCurrentPage])

  useEffect(() => {
    measurePages()
    window.addEventListener("resize", measurePages)

    return () => window.removeEventListener("resize", measurePages)
  }, [
    chapter?.id,
    cleanReading,
    measurePages,
    preferences.columnCount,
    preferences.columnWidth,
    preferences.fontFamily,
    preferences.fontScale,
    preferences.lineHeight,
    preferences.margins,
    preferences.paragraphSpacing,
    preferences.readingFlow
  ])

  useEffect(() => {
    if (!book || !chapter) {
      return
    }

    const timer = window.setTimeout(saveCurrentPosition, READING_SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [book, chapter, saveCurrentPosition])

  useEffect(() => {
    return () => {
      if (savePositionTimerRef.current) {
        window.clearTimeout(savePositionTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!activeAnnotationId || !articleRef.current) {
      return
    }

    window.requestAnimationFrame(() => {
      const article = articleRef.current
      const annotationElement = article?.querySelector<HTMLElement>(`[data-annotation-id="${activeAnnotationId}"]`)
      if (!article || !annotationElement) {
        return
      }

      if (isPaginated && contentRef.current) {
        const nextPageCount = measurePages()
        const nextPageStep = pageStepFor(article)
        const nextOffset = offsetForElement(contentRef.current, annotationElement)
        const nextPageIndex = clamp(Math.floor(nextOffset / nextPageStep), 0, nextPageCount - 1)
        pageOffsetsRef.current[nextPageIndex] = nextOffset
        setCurrentPage(nextPageIndex, nextOffset)
        setPageStep(nextPageStep)
        setPageClipHeight(readerTopPadding + visiblePageHeightFor(contentRef.current, nextOffset, nextPageStep))
        article.scrollTo({ top: 0, left: 0 })
        return
      }

      annotationElement.scrollIntoView({
        block: "center",
        inline: "nearest"
      })
    })
  }, [activeAnnotationId, chapter?.id, isPaginated, measurePages, pageStepFor, readerTopPadding, setCurrentPage])

  const updateSelection = useCallback(() => {
    const selected = window.getSelection()

    if (!selected || selected.isCollapsed || !articleRef.current) {
      setSelection(null)
      return
    }

    const anchorNode = selected.anchorNode
    const focusNode = selected.focusNode
    if (!anchorNode || !focusNode || !articleRef.current.contains(anchorNode) || !articleRef.current.contains(focusNode)) {
      setSelection(null)
      return
    }

    const text = selected.toString().replace(/\s+/g, " ").trim()
    if (text.length < 2 || selected.rangeCount === 0) {
      setSelection(null)
      return
    }

    const rect = selected.getRangeAt(0).getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      setSelection(null)
      return
    }

    const overlappingAnnotations = findOverlappingAnnotations(text, chapterAnnotations, paragraphs)
    setAnnotationMenu(null)
    setSelection({
      overlappingAnnotationIds: overlappingAnnotations.map((annotation) => annotation.id),
      text,
      x: clamp(rect.left + rect.width / 2, 216, window.innerWidth - 216),
      y: Math.max(rect.top - 72, cleanReading ? 12 : 76)
    })
  }, [chapterAnnotations, cleanReading, paragraphs])

  const saveSelection = async (kind: AnnotationKind, color = selectedColor) => {
    if (!chapter || !selection) {
      return
    }

    await Promise.all(selection.overlappingAnnotationIds.map((annotationId) => onDeleteAnnotation(annotationId)))
    await onCreateAnnotation({
      chapterId: chapter.id,
      color,
      excerpt: selection.text,
      kind,
      note: kind === "note" ? noteDraft : ""
    })
    setSelection(null)
    setNoteDraft("")
    window.getSelection()?.removeAllRanges()
  }

  const openAnnotationMenu = (annotation: Annotation, x: number, y: number) => {
    setSelection(null)
    setAnnotationMenu({
      annotation,
      x: clamp(x, 165, window.innerWidth - 165),
      y: clamp(y, 12, window.innerHeight - 180)
    })
    onFocusAnnotation(annotation)
  }

  const handleReaderScroll = () => {
    setAnnotationMenu(null)
    setSelection(null)

    if (isRestoringPositionRef.current) {
      return
    }

    const article = articleRef.current
    if (article && isPaginated) {
      article.scrollTo({ top: 0, left: 0 })
      return
    }
    schedulePositionSave()
  }

  const handleReaderMouseMove = (event: MouseEvent<HTMLElement>) => {
    if (!isPaginated || !articleRef.current) {
      setPageEdgeHint(null)
      return
    }

    const rect = articleRef.current.getBoundingClientRect()
    const edgeSize = Math.min(112, rect.width * 0.18)
    const insideVerticalPageArea = event.clientY >= rect.top && event.clientY <= rect.bottom

    if (!insideVerticalPageArea) {
      setPageEdgeHint(null)
    } else if (event.clientX <= rect.left + edgeSize && pageIndex > 0) {
      setPageEdgeHint("previous")
    } else if (event.clientX >= rect.right - edgeSize && pageIndex < pageCount - 1) {
      setPageEdgeHint("next")
    } else {
      setPageEdgeHint(null)
    }
  }

  const handleReaderClick = (event: MouseEvent<HTMLElement>) => {
    if (!isPaginated || !articleRef.current) {
      return
    }

    const target = event.target as HTMLElement | null
    if (target?.closest("mark, button, input, textarea, select, [data-selection-toolbar]")) {
      return
    }

    const selected = window.getSelection()
    if (selected && !selected.isCollapsed) {
      return
    }

    const rect = articleRef.current.getBoundingClientRect()
    const edgeSize = Math.min(96, rect.width * 0.18)
    if (event.clientX <= rect.left + edgeSize) {
      goToPage(pageIndex - 1)
    } else if (event.clientX >= rect.right - edgeSize) {
      goToPage(pageIndex + 1)
    }
  }

  return (
    <section className={cn("h-full min-h-0 overflow-hidden bg-reader", `reader-${preferences.theme}`)}>
      {book && chapter ? (
        <div className="relative flex h-full flex-col" onMouseLeave={() => setPageEdgeHint(null)} onMouseMove={handleReaderMouseMove}>
          <div className={cn("shrink-0", cleanReading ? "h-10" : "h-14 border-b reader-surface")}>
            {!cleanReading ? (
              <div className="flex h-full items-center justify-between gap-3 px-4">
                <button className="reader-control inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm" title={t("reader.previous")} onClick={onPrevious} disabled={chapterIndex === 0}>
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{t("reader.previous")}</span>
                </button>
                <div className="min-w-0 text-center">
                  <p className="truncate text-sm font-medium">{book.title}</p>
                  <p className="reader-muted text-xs">{t("reader.chapterProgress", { current: chapterIndex + 1, total: book.chapters.length })}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button className="reader-control inline-flex h-9 w-9 items-center justify-center rounded-md border text-sm" title={t("reader.returnToPosition")} onClick={onReturn} disabled={!canReturn}>
                    <Undo2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button className="reader-control inline-flex h-9 w-9 items-center justify-center rounded-md border text-sm" title={t("reader.cleanMode")} onClick={onToggleClean}>
                    <Maximize2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    className="reader-control inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm"
                    title={t("reader.next")}
                    onClick={onNext}
                    disabled={chapterIndex >= book.chapters.length - 1}
                  >
                    <span className="hidden sm:inline">{t("reader.next")}</span>
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="reader-muted pointer-events-none grid h-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 pr-28 text-xs">
                <span className="max-w-[44vw] truncate">{chapter.title}</span>
                <span className="whitespace-nowrap">{t("reader.bookProgress", { progress })}</span>
              </div>
            )}
          </div>

          <div className="reader-progress-track h-1 shrink-0">
            <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden">
            <article
              ref={articleRef}
              className={cn("h-full min-h-0 w-full", isPaginated ? "overflow-hidden" : "overflow-auto")}
              style={{
                paddingBottom: isPaginated ? paginatedBottomPadding : readerVerticalPadding,
                paddingLeft: cleanReading ? Math.max(preferences.margins, 56) : preferences.margins,
                paddingRight: cleanReading ? Math.max(preferences.margins, 56) : preferences.margins,
                paddingTop: readerTopPadding
              }}
              onClick={handleReaderClick}
              onKeyUp={updateSelection}
              onMouseUp={updateSelection}
              onScroll={handleReaderScroll}
            >
              <div
                ref={contentRef}
                className="mx-auto"
                style={{
                  maxWidth: contentMaxWidth,
                  fontSize: preferences.fontScale,
                  lineHeight: preferences.lineHeight,
                  hyphens: preferences.hyphenation ? "auto" : "manual",
                  fontFamily: readerFontFamily,
                  textAlign: preferences.textAlign === "justify" ? "justify" : "start",
                  transform: isPaginated ? `translate3d(0, -${pageOffset}px, 0)` : undefined,
                  willChange: isPaginated ? "transform" : undefined
                }}
              >
                <div
                  className={cn(cleanReading && "text-center", !isPaginated && "mb-8")}
                  style={isPaginated ? { marginBottom: readerLineHeightPx * 2 } : undefined}
                >
                  {!cleanReading && !isPaginated ? <p className="reader-muted mb-2 text-sm">{t("reader.bookProgress", { progress })}</p> : null}
                  <h2
                    className={cn(cleanReading ? "reader-muted text-base font-medium" : "text-3xl font-semibold", "tracking-normal")}
                    data-readable-block
                    style={isPaginated ? { fontSize: preferences.fontScale, lineHeight: preferences.lineHeight } : undefined}
                  >
                    {chapter.title}
                  </h2>
                </div>
                <div
                  className="reader-copy"
                  style={{
                    columnCount: preferences.columnCount,
                    columnGap: preferences.columnCount === 2 ? 72 : undefined
                  }}
                >
                  {paragraphs.map((paragraph, index) => (
                    <p
                      key={`${chapter.id}-${index}`}
                      className="break-inside-avoid"
                      data-paragraph-index={index}
                      data-readable-block
                      style={{
                        marginTop: index === 0
                          ? 0
                          : isPaginated
                            ? paginatedParagraphSpacing
                            : `${preferences.paragraphSpacing}em`
                      }}
                    >
                      {renderParagraphWithAnnotations(paragraph, chapterAnnotations, activeAnnotationId, openAnnotationMenu)}
                    </p>
                  ))}
                </div>
              </div>
            </article>
            {isPaginated && pageClipHeight !== null ? (
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-reader"
                style={{ top: pageClipHeight }}
              />
            ) : null}
          </div>

          {isPaginated ? (
            <>
              {pageIndex > 0 ? (
                <button
                  className={cn(
                    "reader-floating-control pointer-events-none absolute left-3 top-1/2 z-20 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border opacity-0 shadow-sm backdrop-blur transition-opacity duration-200",
                    pageEdgeHint === "previous" && "pointer-events-auto opacity-100"
                  )}
                  title={t("reader.pagePrevious")}
                  onClick={() => goToPage(pageIndex - 1)}
                >
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                </button>
              ) : null}
              {pageIndex < pageCount - 1 ? (
                <button
                  className={cn(
                    "reader-floating-control pointer-events-none absolute right-3 top-1/2 z-20 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border opacity-0 shadow-sm backdrop-blur transition-opacity duration-200",
                    pageEdgeHint === "next" && "pointer-events-auto opacity-100"
                  )}
                  title={t("reader.pageNext")}
                  onClick={() => goToPage(pageIndex + 1)}
                >
                  <ChevronRight className="h-5 w-5" aria-hidden="true" />
                </button>
              ) : null}
            </>
          ) : null}

          {isPaginated ? (
            <div className="flex h-12 shrink-0 items-center justify-center">
              <div className="reader-floating-control reader-muted rounded-full px-2.5 py-1 text-[11px] backdrop-blur">
                {t("reader.chapterTextProgress", { progress: chapterTextProgress })}
              </div>
            </div>
          ) : null}

          {cleanReading ? (
            <div className="absolute right-4 top-1 z-20 flex items-center gap-2">
              <button className="reader-floating-control inline-flex h-9 w-9 items-center justify-center rounded-full border shadow-sm backdrop-blur" title={t("reader.returnToPosition")} onClick={onReturn} disabled={!canReturn}>
                <Undo2 className="h-4 w-4" aria-hidden="true" />
              </button>
              <button className="reader-floating-control inline-flex h-9 w-9 items-center justify-center rounded-full border shadow-sm backdrop-blur" title={t("reader.exitCleanMode")} onClick={onToggleClean}>
                <Minimize2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : null}

          {selection ? (
            <SelectionToolbar
              color={selectedColor}
              note={noteDraft}
              selection={selection}
              t={t}
              onChangeColor={setSelectedColor}
              onChangeNote={setNoteDraft}
              onSaveFavorite={() => saveSelection("favorite")}
              onSaveHighlight={(color) => saveSelection("highlight", color)}
              onSaveNote={() => saveSelection("note")}
            />
          ) : null}

          {annotationMenu ? (
            <AnnotationContextMenu
              annotation={annotationMenu.annotation}
              t={t}
              x={annotationMenu.x}
              y={annotationMenu.y}
              onChangeColor={async (color) => {
                await onUpdateAnnotationColor(annotationMenu.annotation.id, color)
                setAnnotationMenu(null)
              }}
              onDelete={async () => {
                await onDeleteAnnotation(annotationMenu.annotation.id)
                setAnnotationMenu(null)
              }}
            />
          ) : null}
        </div>
      ) : (
        <div className="flex h-full min-h-0 items-center justify-center p-6">
          <div className="max-w-sm text-center">
            <BookOpen className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-semibold">{t("reader.noBook")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("reader.noBookBody")}</p>
          </div>
        </div>
      )}
    </section>
  )
}

function SelectionToolbar({
  color,
  note,
  selection,
  t,
  onChangeColor,
  onChangeNote,
  onSaveFavorite,
  onSaveHighlight,
  onSaveNote
}: {
  color: HighlightColor
  note: string
  selection: ReaderSelection
  t: (key: string, values?: Record<string, string | number>) => string
  onChangeColor: (color: HighlightColor) => void
  onChangeNote: (note: string) => void
  onSaveFavorite: () => void
  onSaveHighlight: (color: HighlightColor) => void
  onSaveNote: () => void
}) {
  return (
    <div
      className="fixed z-50 w-[min(92vw,430px)] -translate-x-1/2 rounded-md border bg-card p-2 shadow-xl"
      data-selection-toolbar
      style={{ left: selection.x, top: selection.y }}
    >
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {colorOptions.map((option) => (
            <button
              key={option}
              className={cn(
                "h-7 w-7 rounded-full border border-black/15 ring-offset-2 ring-offset-card transition",
                swatchClasses[option],
                color === option && "ring-2 ring-primary"
              )}
              title={t(`reader.color.${option}`)}
              aria-label={t(`reader.color.${option}`)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onChangeColor(option)}
            />
          ))}
        </div>
        <button className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-background text-muted-foreground" title={t("reader.highlight")} onMouseDown={(event) => event.preventDefault()} onClick={() => onSaveHighlight(color)}>
          <Highlighter className="h-4 w-4" aria-hidden="true" />
        </button>
        <button className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-background text-muted-foreground" title={t("reader.favorite")} onMouseDown={(event) => event.preventDefault()} onClick={onSaveFavorite}>
          <Bookmark className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {selection.overlappingAnnotationIds.length ? (
        <p className="mt-2 rounded-sm bg-muted px-2 py-1 text-[11px] leading-tight text-muted-foreground">
          {t("reader.overlapReplace", { count: selection.overlappingAnnotationIds.length })}
        </p>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <input
          className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground"
          placeholder={t("reader.annotationNotePlaceholderShort")}
          value={note}
          onChange={(event) => onChangeNote(event.target.value)}
        />
        <button className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground" title={t("reader.note")} onMouseDown={(event) => event.preventDefault()} onClick={onSaveNote}>
          <MessageSquareText className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

function AnnotationContextMenu({
  annotation,
  t,
  x,
  y,
  onChangeColor,
  onDelete
}: {
  annotation: Annotation
  t: (key: string, values?: Record<string, string | number>) => string
  x: number
  y: number
  onChangeColor: (color: HighlightColor) => Promise<void> | void
  onDelete: () => Promise<void> | void
}) {
  return (
    <div
      className="fixed z-50 w-[min(88vw,330px)] -translate-x-1/2 rounded-md border bg-card p-2 shadow-xl"
      style={{ left: x, top: y }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium">{t(`reader.kind.${annotation.kind}`)}</span>
        <button className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-destructive" title={t("reader.deleteAnnotation")} onClick={onDelete}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-1">
        {colorOptions.map((option) => (
          <button
            key={option}
            className={cn(
              "h-7 w-7 rounded-full border border-black/15 ring-offset-2 ring-offset-card transition",
              swatchClasses[option],
              annotation.color === option && "ring-2 ring-primary"
            )}
            title={t(`reader.color.${option}`)}
            aria-label={t(`reader.color.${option}`)}
            onClick={() => onChangeColor(option)}
          />
        ))}
      </div>
      {annotation.note ? <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{annotation.note}</p> : null}
    </div>
  )
}

function renderParagraphWithAnnotations(
  paragraph: string,
  annotations: Annotation[],
  activeAnnotationId: string | null,
  onOpenAnnotationMenu: (annotation: Annotation, x: number, y: number) => void
) {
  const ranges = findAnnotationRanges(paragraph, annotations)

  if (!ranges.length) {
    return paragraph
  }

  const nodes: ReactElement[] = []
  let cursor = 0

  ranges.forEach(({ annotation, end, start }) => {
    if (start > cursor) {
      nodes.push(<span key={`text-${cursor}`}>{paragraph.slice(cursor, start)}</span>)
    }

    nodes.push(
      <mark
        key={annotation.id}
        className={cn(
          "box-decoration-clone cursor-pointer rounded-[2px] px-[0.08em] decoration-transparent transition",
          inlineHighlightClasses[annotation.color],
          annotation.id === activeAnnotationId && "brightness-95"
        )}
        data-annotation-id={annotation.id}
        title={annotation.note}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onOpenAnnotationMenu(annotation, event.clientX, Math.max(event.clientY - 64, 12))
        }}
      >
        {paragraph.slice(start, end)}
      </mark>
    )
    cursor = end
  })

  if (cursor < paragraph.length) {
    nodes.push(<span key={`text-${cursor}`}>{paragraph.slice(cursor)}</span>)
  }

  return nodes
}

function findAnnotationRanges(paragraph: string, annotations: Annotation[]): Array<{ annotation: Annotation; start: number; end: number }> {
  const lowerParagraph = paragraph.toLocaleLowerCase()
  const ranges = annotations
    .map((annotation) => {
      const quote = annotation.excerpt.trim()
      const start = quote ? lowerParagraph.indexOf(quote.toLocaleLowerCase()) : -1
      return start >= 0
        ? {
          annotation,
          start,
          end: start + quote.length
        }
        : null
    })
    .filter((range): range is { annotation: Annotation; start: number; end: number } => Boolean(range))
    .sort((first, second) => first.start - second.start || second.end - first.end)

  const accepted: Array<{ annotation: Annotation; start: number; end: number }> = []
  for (const range of ranges) {
    if (!accepted.some((item) => range.start < item.end && range.end > item.start)) {
      accepted.push(range)
    }
  }
  return accepted
}

function readVisibleTextAnchor(article: HTMLElement, topInset: number): { paragraphIndex: number; text: string; textOffset: number } | undefined {
  const articleRect = article.getBoundingClientRect()
  const range = caretRangeFromPoint(
    articleRect.left + Math.min(Math.max(articleRect.width * 0.35, 80), 220),
    articleRect.top + topInset + 8
  )
  const paragraphFromCaret = range ? closestParagraphElement(range.startContainer, article) : null

  if (paragraphFromCaret && range) {
    const paragraphIndex = Number(paragraphFromCaret.dataset.paragraphIndex)
    const textOffset = textOffsetWithin(paragraphFromCaret, range.startContainer, range.startOffset)
    const paragraphText = paragraphFromCaret.textContent ?? ""
    const safeOffset = clamp(textOffset, 0, paragraphText.length)
    return {
      paragraphIndex,
      text: paragraphText.slice(safeOffset, safeOffset + 160),
      textOffset: safeOffset
    }
  }

  const paragraph = Array.from(article.querySelectorAll<HTMLElement>("[data-paragraph-index]")).find((item) => {
    const rect = item.getBoundingClientRect()
    return rect.bottom > articleRect.top + topInset && rect.top < articleRect.bottom
  })

  if (!paragraph) {
    return undefined
  }

  const paragraphText = paragraph.textContent ?? ""
  return {
    paragraphIndex: Number(paragraph.dataset.paragraphIndex),
    text: paragraphText.slice(0, 160),
    textOffset: 0
  }
}

function restoreToTextAnchor(article: HTMLElement, locator: ReaderLocator, topInset: number): boolean {
  if (locator.anchorParagraphIndex === undefined) {
    return false
  }

  const paragraph = article.querySelector<HTMLElement>(`[data-paragraph-index="${locator.anchorParagraphIndex}"]`)
  if (!paragraph) {
    return false
  }

  const paragraphText = paragraph.textContent ?? ""
  const preferredOffset = clamp(locator.anchorTextOffset ?? 0, 0, paragraphText.length)
  const anchorOffset = locator.anchorText
    ? paragraphText.indexOf(locator.anchorText, Math.max(preferredOffset - 24, 0))
    : -1
  const textOffset = anchorOffset >= 0 ? anchorOffset : preferredOffset
  const range = rangeAtTextOffset(paragraph, textOffset)

  if (!range) {
    paragraph.scrollIntoView({ block: "start" })
    return true
  }

  const rangeRect = range.getBoundingClientRect()
  const articleRect = article.getBoundingClientRect()
  article.scrollTo({
    top: Math.max(0, article.scrollTop + rangeRect.top - articleRect.top - topInset),
    left: 0
  })
  return true
}

function offsetForTextAnchor(
  article: HTMLElement,
  content: HTMLElement,
  locator: ReaderLocator
): number | undefined {
  if (locator.anchorParagraphIndex === undefined) {
    return undefined
  }

  const paragraph = article.querySelector<HTMLElement>(`[data-paragraph-index="${locator.anchorParagraphIndex}"]`)
  if (!paragraph) {
    return undefined
  }

  const paragraphText = paragraph.textContent ?? ""
  const preferredOffset = clamp(locator.anchorTextOffset ?? 0, 0, paragraphText.length)
  const anchorOffset = locator.anchorText
    ? paragraphText.indexOf(locator.anchorText, Math.max(preferredOffset - 24, 0))
    : -1
  const textOffset = anchorOffset >= 0 ? anchorOffset : preferredOffset
  const range = rangeAtTextOffset(paragraph, textOffset)

  if (!range) {
    return offsetForElement(content, paragraph)
  }

  const contentRect = content.getBoundingClientRect()
  const rangeRect = range.getBoundingClientRect()
  return Math.max(0, rangeRect.top - contentRect.top)
}

function offsetForElement(content: HTMLElement, element: HTMLElement): number {
  const contentRect = content.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()
  return Math.max(0, elementRect.top - contentRect.top)
}

function measureReadableContentHeight(content: HTMLElement): number {
  const lines = collectTextLineBoxes(content)
  return Math.max(content.scrollHeight, lines.at(-1)?.bottom ?? 0)
}

function findNextPageOffset(content: HTMLElement, currentOffset: number, pageHeight: number): number | undefined {
  const lines = collectTextLineBoxes(content)
  return findNextPageOffsetFromLines(lines, currentOffset, pageHeight)
}

function findNextPageOffsetFromLines(lines: TextLineBox[], currentOffset: number, pageHeight: number): number | undefined {
  const pageBottom = currentOffset + pageHeight
  const nextLine = lines.find((line) => line.bottom > pageBottom + 0.5 && line.top > currentOffset + 0.5)
  return nextLine?.top
}

function findPreviousPageOffset(content: HTMLElement, currentOffset: number, pageHeight: number): number {
  const lines = collectTextLineBoxes(content)
  let previousOffset = 0

  for (const line of lines) {
    if (line.top >= currentOffset - 0.5) {
      break
    }

    const nextOffset = findNextPageOffsetFromLines(lines, line.top, pageHeight)
    if (nextOffset === undefined || nextOffset > currentOffset + 0.5) {
      break
    }

    previousOffset = line.top
  }

  return previousOffset
}

function visiblePageHeightFor(content: HTMLElement, currentOffset: number, pageHeight: number): number {
  const nextOffset = findNextPageOffset(content, currentOffset, pageHeight)
  if (nextOffset !== undefined && nextOffset < currentOffset + pageHeight) {
    return Math.max(1, nextOffset - currentOffset)
  }

  return pageHeight
}

function visibleChapterProgressFor(content: HTMLElement, currentOffset: number, visibleHeight: number): number {
  const contentHeight = measureReadableContentHeight(content)
  if (contentHeight <= 0) {
    return 0
  }

  return clamp(Math.round(((currentOffset + visibleHeight) / contentHeight) * 100), 0, 100)
}

function collectTextLineBoxes(content: HTMLElement): TextLineBox[] {
  const contentRect = content.getBoundingClientRect()
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
  const lines: TextLineBox[] = []
  let node = walker.nextNode()

  while (node) {
    const textLength = node.textContent?.length ?? 0
    if (textLength > 0 && node.textContent?.trim()) {
      const range = document.createRange()
      range.selectNodeContents(node)
      Array.from(range.getClientRects()).forEach((rect) => {
        if (rect.width <= 0 || rect.height <= 0) {
          return
        }

        const top = rect.top - contentRect.top
        const bottom = rect.bottom - contentRect.top
        const existingLine = lines.find((line) => Math.abs(line.top - top) < 1)

        if (existingLine) {
          existingLine.top = Math.min(existingLine.top, top)
          existingLine.bottom = Math.max(existingLine.bottom, bottom)
        } else {
          lines.push({ bottom, top })
        }
      })
      range.detach()
    }
    node = walker.nextNode()
  }

  return lines.sort((first, second) => first.top - second.top)
}

function caretRangeFromPoint(x: number, y: number): Range | null {
  const documentWithCaret = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offset: number; offsetNode: Node } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const range = documentWithCaret.caretRangeFromPoint?.(x, y)
  if (range) {
    return range
  }

  const position = documentWithCaret.caretPositionFromPoint?.(x, y)
  if (!position) {
    return null
  }

  const nextRange = document.createRange()
  nextRange.setStart(position.offsetNode, position.offset)
  nextRange.collapse(true)
  return nextRange
}

function closestParagraphElement(node: Node, article: HTMLElement): HTMLElement | null {
  const element = node.nodeType === Node.ELEMENT_NODE
    ? (node as HTMLElement)
    : node.parentNode instanceof HTMLElement
      ? node.parentNode
      : null
  const paragraph = element?.closest<HTMLElement>("[data-paragraph-index]")
  return paragraph && article.contains(paragraph) ? paragraph : null
}

function rangeAtTextOffset(container: HTMLElement, textOffset: number): Range | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let offset = textOffset
  let node = walker.nextNode()

  while (node) {
    const textLength = node.textContent?.length ?? 0
    if (offset <= textLength) {
      const range = document.createRange()
      range.setStart(node, offset)
      range.collapse(true)
      return range
    }
    offset -= textLength
    node = walker.nextNode()
  }

  return null
}

function textOffsetWithin(container: HTMLElement, targetNode: Node, targetOffset: number): number {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let offset = 0
  let node = walker.nextNode()

  while (node) {
    if (node === targetNode) {
      return offset + targetOffset
    }
    offset += node.textContent?.length ?? 0
    node = walker.nextNode()
  }

  return 0
}

function findOverlappingAnnotations(selectionText: string, annotations: Annotation[], paragraphs: string[]): Annotation[] {
  return annotations.filter((annotation) => textSelectionsOverlap(selectionText, annotation.excerpt, paragraphs))
}

function textSelectionsOverlap(selectionText: string, annotationText: string, paragraphs: string[]): boolean {
  const selected = normalizeTextSelection(selectionText)
  const annotated = normalizeTextSelection(annotationText)

  if (!selected || !annotated) {
    return false
  }

  if (selected.includes(annotated) || annotated.includes(selected)) {
    return true
  }

  return paragraphs.some((paragraph) => {
    const normalizedParagraph = normalizeTextSelection(paragraph)
    const selectedStart = normalizedParagraph.indexOf(selected)
    const annotatedStart = normalizedParagraph.indexOf(annotated)

    if (selectedStart < 0 || annotatedStart < 0) {
      return false
    }

    const selectedEnd = selectedStart + selected.length
    const annotatedEnd = annotatedStart + annotated.length
    return selectedStart < annotatedEnd && annotatedStart < selectedEnd
  })
}

function normalizeTextSelection(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase()
}

function InspectorPane({
  activeTab,
  activeAnnotationId,
  annotations,
  book,
  chapterIndex,
  exportContent,
  preferences,
  t,
  onChangePreference,
  onChangeTab,
  onDeleteAnnotation,
  onExportNotes,
  onJumpToAnnotation,
  onJumpToChapter,
}: {
  activeTab: InspectorTab
  activeAnnotationId: string | null
  annotations: Annotation[]
  book: BookDetails | null
  chapterIndex: number
  exportContent: string
  preferences: ReaderPreferences
  t: (key: string, values?: Record<string, string | number>) => string
  onChangePreference: <Key extends keyof ReaderPreferences>(key: Key, value: ReaderPreferences[Key]) => void
  onChangeTab: (tab: InspectorTab) => void
  onDeleteAnnotation: (annotationId: string) => void
  onExportNotes: () => void
  onJumpToAnnotation: (annotation: Annotation) => void
  onJumpToChapter: (index: number) => void
}) {
  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden border-l bg-sidebar">
      <div className="grid shrink-0 grid-cols-3 border-b p-2">
        <IconToggle active={activeTab === "summary"} icon={PanelRight} label={t("reader.summary")} onClick={() => onChangeTab("summary")} />
        <IconToggle active={activeTab === "annotations"} icon={Highlighter} label={t("reader.annotations")} onClick={() => onChangeTab("annotations")} />
        <IconToggle active={activeTab === "preferences"} icon={SlidersHorizontal} label={t("reader.preferences")} onClick={() => onChangeTab("preferences")} />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-4">
        {activeTab === "summary" ? (
          <div className="flex h-full min-h-0 flex-col">
            <h2 className="shrink-0 text-sm font-semibold">{t("reader.summary")}</h2>
            <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-auto pr-1">
              {book?.chapters.map((chapter, index) => (
                <button
                  key={chapter.id}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md border bg-card px-3 py-2 text-left text-sm",
                    index === chapterIndex && "border-primary text-primary"
                  )}
                  onClick={() => onJumpToChapter(index)}
                >
                  <span className="truncate">{chapter.title}</span>
                  {index === chapterIndex ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {activeTab === "annotations" ? (
          <div className="h-full min-h-0 overflow-auto pr-1">
            <div className="space-y-3">
              <button className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border bg-card px-3 text-sm" onClick={onExportNotes} disabled={!book}>
                <Download className="h-4 w-4" aria-hidden="true" />
                {t("reader.export")}
              </button>

              {exportContent ? (
                <div className="rounded-md border bg-card p-3">
                  <h3 className="text-sm font-semibold">{t("reader.exportReady")}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{t("reader.exportDescription")}</p>
                  <textarea className="mt-3 h-36 w-full resize-none rounded-md border bg-background p-2 text-xs outline-none" readOnly value={exportContent} />
                </div>
              ) : null}

              <div className="space-y-2">
                {annotations.length ? (
                  annotations.map((annotation) => {
                    const chapterTitle = book?.chapters.find((chapter) => chapter.id === annotation.chapterId)?.title

                    return (
                    <div key={annotation.id} className={cn("rounded-md border bg-card p-3", `annotation-${annotation.color}`, annotation.id === activeAnnotationId && "border-primary ring-2 ring-primary/15")}>
                      <div className="flex items-start justify-between gap-3">
                        <button className="min-w-0 flex-1 text-left" onClick={() => onJumpToAnnotation(annotation)}>
                          <span className="inline-flex items-center gap-2 text-xs font-medium">
                            <span className={cn("h-2.5 w-2.5 rounded-full", swatchClasses[annotation.color])} aria-hidden="true" />
                            {t(`reader.kind.${annotation.kind}`)}
                          </span>
                          {chapterTitle ? <span className="mt-1 block truncate text-xs text-muted-foreground">{chapterTitle}</span> : null}
                          <span className="mt-2 line-clamp-4 block text-sm">{annotation.excerpt}</span>
                          {annotation.note ? <span className="mt-2 block text-xs text-muted-foreground">{annotation.note}</span> : null}
                        </button>
                        <button className="rounded-sm p-1 text-muted-foreground hover:text-destructive" title={t("reader.deleteAnnotation")} onClick={() => onDeleteAnnotation(annotation.id)}>
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                    )
                  })
                ) : (
                  <p className="rounded-md border bg-card p-3 text-sm text-muted-foreground">{t("reader.emptyAnnotations")}</p>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "preferences" ? (
          <div className="h-full min-h-0 space-y-5 overflow-auto pr-1">
            <h2 className="text-sm font-semibold">{t("reader.preferences")}</h2>
            <div>
              <span className="mb-2 block text-xs font-medium text-muted-foreground">{t("reader.theme")}</span>
              <div className="grid grid-cols-4 gap-2">
                {themeOptions.map((theme) => (
                  <button
                    key={theme}
                    className={cn("flex h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-md border bg-card px-1 text-center text-[11px] leading-tight", preferences.theme === theme && "border-primary text-primary ring-2 ring-primary/15")}
                    onClick={() => onChangePreference("theme", theme)}
                  >
                    <span className={cn("h-5 w-5 rounded-full border", themePreviewClasses[theme])} aria-hidden="true" />
                    <span className="w-full overflow-hidden break-words">{t(`reader.theme.${theme}`)}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Type className="h-4 w-4" aria-hidden="true" />
                {t("reader.fontFamily")}
              </span>
              <div className="grid grid-cols-2 gap-2">
                {fontFamilyOptions.map((font) => (
                  <button
                    key={font.value}
                    className={cn("min-h-16 rounded-md border bg-card px-3 py-2 text-left", preferences.fontFamily === font.value && "border-primary text-primary ring-2 ring-primary/15")}
                    style={{ fontFamily: font.stack }}
                    onClick={() => onChangePreference("fontFamily", font.value)}
                  >
                    <span className="block text-2xl leading-none">Aa</span>
                    <span className="mt-1 block break-words text-xs font-medium leading-tight">{t(font.labelKey)}</span>
                  </button>
                ))}
              </div>
            </div>
            <SliderField
              label={t("reader.fontScale")}
              value={preferences.fontScale}
              min={14}
              max={30}
              onChange={(value) => onChangePreference("fontScale", value)}
            />
            <div>
              <span className="mb-2 block text-xs font-medium text-muted-foreground">{t("reader.readingFlow")}</span>
              <div className="grid grid-cols-2 gap-2">
                <SegmentButton
                  active={preferences.readingFlow === "continuous"}
                  icon={List}
                  label={t("reader.readingFlow.continuous")}
                  onClick={() => onChangePreference("readingFlow", "continuous")}
                />
                <SegmentButton
                  active={preferences.readingFlow === "paginated"}
                  icon={BookOpen}
                  label={t("reader.readingFlow.paginated")}
                  onClick={() => onChangePreference("readingFlow", "paginated")}
                />
              </div>
            </div>
            <div>
              <span className="mb-2 block text-xs font-medium text-muted-foreground">{t("reader.columns")}</span>
              <div className="grid grid-cols-2 gap-2">
                <SegmentButton active={preferences.columnCount === 1} icon={List} label={t("reader.columns.one")} onClick={() => onChangePreference("columnCount", 1)} />
                <SegmentButton active={preferences.columnCount === 2} icon={Columns2} label={t("reader.columns.two")} onClick={() => onChangePreference("columnCount", 2)} />
              </div>
            </div>
            <SliderField
              label={t("reader.columnWidth")}
              value={preferences.columnWidth}
              min={420}
              max={940}
              onChange={(value) => onChangePreference("columnWidth", value)}
            />
            <SliderField
              label={t("reader.lineHeight")}
              value={Math.round(preferences.lineHeight * 10)}
              min={14}
              max={24}
              onChange={(value) => onChangePreference("lineHeight", value / 10)}
            />
            <SliderField
              label={t("reader.paragraphSpacing")}
              value={Math.round(preferences.paragraphSpacing * 10)}
              min={6}
              max={20}
              onChange={(value) => onChangePreference("paragraphSpacing", value / 10)}
            />
            <SliderField
              label={t("reader.margins")}
              value={preferences.margins}
              min={12}
              max={96}
              onChange={(value) => onChangePreference("margins", value)}
            />
            <div>
              <span className="mb-2 block text-xs font-medium text-muted-foreground">{t("reader.align")}</span>
              <div className="grid grid-cols-2 gap-2">
                <SegmentButton active={preferences.textAlign === "start"} icon={TextAlignStart} label={t("reader.align.start")} onClick={() => onChangePreference("textAlign", "start")} />
                <SegmentButton active={preferences.textAlign === "justify"} icon={TextAlignJustify} label={t("reader.align.justify")} onClick={() => onChangePreference("textAlign", "justify")} />
              </div>
            </div>
            <label className="flex items-center justify-between rounded-md border bg-card p-3 text-sm">
              <span>{t("reader.hyphenation")}</span>
              <input
                className="h-4 w-4 accent-primary"
                type="checkbox"
                checked={preferences.hyphenation}
                onChange={(event) => onChangePreference("hyphenation", event.target.checked)}
              />
            </label>
          </div>
        ) : null}
      </div>
    </aside>
  )
}

function SettingsDialog({
  settings,
  saved,
  t,
  onClose,
  onSave,
  onUpdate
}: {
  settings: AppSettings
  saved: boolean
  t: (key: string, values?: Record<string, string | number>) => string
  onClose: () => void
  onSave: () => void
  onUpdate: (settings: AppSettings) => void
}) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/35 p-4">
      <section className="w-full max-w-xl rounded-md border bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t("settings.title")}</h2>
            {saved ? <p className="mt-1 text-sm text-primary">{t("settings.saved")}</p> : null}
          </div>
          <button className="rounded-md border bg-background px-3 py-2 text-sm" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <SelectField
            label={t("settings.language")}
            value={settings.locale}
            onChange={(value) => onUpdate({ ...settings, locale: value as Locale })}
            options={[
              { value: "pt-BR", label: t("settings.ptBR") },
              { value: "en", label: t("settings.en") }
            ]}
          />
          <SelectField
            label={t("settings.appearance")}
            value={settings.appearance}
            onChange={(value) => onUpdate({ ...settings, appearance: value as AppearanceTheme })}
            options={themeOptions.map((theme) => ({ value: theme, label: t(`reader.theme.${theme}`) }))}
          />
        </div>
        <div className="mt-5 rounded-md border bg-background p-4">
          <h3 className="text-sm font-semibold">{t("settings.readerDefaults")}</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <SliderField
              label={t("reader.fontScale")}
              value={settings.reader.fontScale}
              min={14}
              max={24}
              onChange={(value) => onUpdate({ ...settings, reader: { ...settings.reader, fontScale: value } })}
            />
            <SliderField
              label={t("reader.lineHeight")}
              value={Math.round(settings.reader.lineHeight * 10)}
              min={14}
              max={22}
              onChange={(value) => onUpdate({ ...settings, reader: { ...settings.reader, lineHeight: value / 10 } })}
            />
          </div>
        </div>
        <button className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground" onClick={onSave}>
          <Check className="h-4 w-4" aria-hidden="true" />
          {t("settings.save")}
        </button>
      </section>
    </div>
  )
}

function IconToggle({
  active,
  icon: Icon,
  label,
  onClick
}: {
  active: boolean
  icon: typeof Library
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={cn("inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-2 rounded-sm px-2 text-xs text-muted-foreground", active && "bg-card text-foreground shadow-sm")}
      title={label}
      onClick={onClick}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </button>
  )
}

function SegmentButton({
  active,
  icon: Icon,
  label,
  onClick
}: {
  active: boolean
  icon: typeof Library
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={cn("inline-flex h-12 min-w-0 items-center justify-center gap-2 rounded-md border bg-card px-2 text-center text-xs leading-tight text-muted-foreground", active && "border-primary text-primary ring-2 ring-primary/15")}
      onClick={onClick}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{label}</span>
    </button>
  )
}

function SelectField({
  label,
  options,
  value,
  onChange
}: {
  label: string
  options: Array<{ label: string; value: string }>
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block text-sm">
      <span className="mb-2 block text-xs font-medium text-muted-foreground">{label}</span>
      <select className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function SliderField({
  label,
  max,
  min,
  value,
  onChange
}: {
  label: string
  max: number
  min: number
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="block text-sm">
      <span className="mb-2 flex items-center justify-between gap-3 text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        <span>{value}</span>
      </span>
      <input className="w-full accent-primary" type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  )
}

function initialChapterIndex(book: BookDetails | null): number {
  const lastChapterId = book?.lastPosition?.chapterId ?? book?.lastChapterId
  if (!book?.chapters.length || !lastChapterId) {
    return 0
  }

  const index = book.chapters.findIndex((chapter) => chapter.id === lastChapterId)
  return index >= 0 ? index : 0
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined
}
