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
import {
  clampPageIndex,
  columnIndexForOffset,
  pageClipWidth,
  pageCountForColumns,
  pageIndexForColumn,
  pageProgress,
  pageTranslateX,
  totalColumns
} from "@renderer/lib/pagination"
import { findAnnotationRanges, findOverlappingAnnotations, resolveAnnotationPlacements, type AnnotationPlacement } from "@renderer/lib/annotations"
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
  anchorParagraphIndex?: number
  anchorTextOffset?: number
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
// A layout-independent reading anchor: the paragraph at the top-left of the
// current page, plus how many columns into that paragraph the page starts.
// Survives reflow (resize / font change) so the reader stays on the same text.
type ColumnAnchor = {
  paragraphIndex: number
  columnWithin: number
}
type PageLayout = {
  pageHeight: number
  clipWidth: number
  columnWidth: number
  columnGap: number
  columnsPerPage: number
  // Empty horizontal gutter (px) on each side of the page's visible columns,
  // measured from the article edge. When wide enough it becomes the clickable
  // page-turn zone; otherwise the click falls back to the text's outer thirds.
  sideMargin: number
}
type LibraryStatus = {
  tone: "info" | "success" | "warning" | "error"
  message: string
}

const READING_SETTLE_MS = 12000
// Inter-column gap for paginated reading. For a two-column page the gap is
// visible between the two columns; for a single-column page it only spaces the
// (clipped) next page, so the value is cosmetic there.
const PAGINATED_COLUMN_GAP_DOUBLE = 72
const PAGINATED_COLUMN_GAP_SINGLE = 64
const MIN_PAGINATED_COLUMN_WIDTH = 200
// Below this, the side gutter is too thin to be a comfortable click target, so
// paginated paging falls back to clicking the text's outer thirds instead.
const MIN_SIDE_MARGIN_FOR_BUTTON = 56

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
  const [annotationFocusTick, setAnnotationFocusTick] = useState(0)
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
  annotationFocusTick,
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
  annotationFocusTick: number
  annotations: Annotation[]
  book: BookDetails | null
  canReturn: boolean
  chapter: BookDetails["chapters"][number] | null
  chapterIndex: number
  cleanReading: boolean
  preferences: ReaderPreferences
  t: (key: string, values?: Record<string, string | number>) => string
  onCreateAnnotation: (draft: { anchorParagraphIndex?: number; anchorTextOffset?: number; chapterId: string; color: HighlightColor; excerpt: string; kind: AnnotationKind; note: string }) => Promise<void> | void
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
  const pageIndexRef = useRef(0)
  const columnAnchorRef = useRef<ColumnAnchor | undefined>(undefined)
  const savePositionTimerRef = useRef<number | null>(null)
  const [annotationMenu, setAnnotationMenu] = useState<AnnotationMenuState | null>(null)
  const [pageEdgeHint, setPageEdgeHint] = useState<PageEdgeHint | null>(null)
  const [pageCount, setPageCount] = useState(1)
  const [pageIndex, setPageIndex] = useState(0)
  const [pageLayout, setPageLayout] = useState<PageLayout>({
    pageHeight: 0,
    clipWidth: 0,
    columnWidth: preferences.columnWidth,
    columnGap: PAGINATED_COLUMN_GAP_SINGLE,
    columnsPerPage: 1,
    sideMargin: 0
  })
  const [pageTranslate, setPageTranslate] = useState(0)
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
  // Resolve every chapter annotation to exactly one location (paragraph + range)
  // so a highlight renders once, on its precise occurrence, rather than matching
  // its text in every paragraph.
  const annotationPlacements = useMemo(
    () => resolveAnnotationPlacements(chapterAnnotations, paragraphs),
    [chapterAnnotations, paragraphs]
  )
  const readerFontFamily = fontStackByFamily[preferences.fontFamily] ?? fontStackByFamily.georgia
  const contentMaxWidth = preferences.columnCount === 2 ? preferences.columnWidth * 2 + 72 : preferences.columnWidth
  const isPaginated = preferences.readingFlow === "paginated"
  const readerVerticalPadding = cleanReading ? 36 : 28
  const readerLineHeightPx = Math.max(preferences.fontScale * preferences.lineHeight, 1)
  const readerTopPadding = isPaginated ? readerLineHeightPx : readerVerticalPadding
  const paginatedParagraphSpacing = Math.max(1, Math.round(preferences.paragraphSpacing)) * readerLineHeightPx
  const readerAnchorInset = isPaginated ? readerTopPadding : 8
  const readerHorizontalPadding = cleanReading ? Math.max(preferences.margins, 56) : preferences.margins
  const chapterTextProgress = isPaginated ? pageProgress(pageIndex, pageCount) : 0
  // When the page has wide enough side gutters, those whole areas become the
  // page-turn buttons; otherwise we fall back to clicking the text's outer thirds.
  const hasSideMargins = isPaginated && pageLayout.sideMargin >= MIN_SIDE_MARGIN_FOR_BUTTON

  // Geometry of one page for the current viewport + preferences. Pure: depends
  // only on the article box and reader settings, never on prior navigation.
  const computeLayout = useCallback(
    (article: HTMLElement): PageLayout => {
      const columnsPerPage = preferences.columnCount === 2 ? 2 : 1
      const columnGap = columnsPerPage === 2 ? PAGINATED_COLUMN_GAP_DOUBLE : PAGINATED_COLUMN_GAP_SINGLE
      const availableWidth = Math.max(article.clientWidth - readerHorizontalPadding * 2, MIN_PAGINATED_COLUMN_WIDTH)
      const fittedColumnWidth = (availableWidth - (columnsPerPage - 1) * columnGap) / columnsPerPage
      const columnWidth = Math.max(1, Math.min(preferences.columnWidth, fittedColumnWidth))
      const clipWidth = pageClipWidth(columnWidth, columnGap, columnsPerPage)
      const pageHeight = Math.max(article.clientHeight - readerTopPadding - readerVerticalPadding, readerLineHeightPx)
      // The clip is centered (mx-auto) inside the padded content box, so the
      // empty gutter from the article edge is the padding plus half the leftover.
      const contentBoxWidth = Math.max(article.clientWidth - readerHorizontalPadding * 2, 0)
      const sideMargin = readerHorizontalPadding + Math.max(0, (contentBoxWidth - clipWidth) / 2)
      return { pageHeight, clipWidth, columnWidth, columnGap, columnsPerPage, sideMargin }
    },
    [preferences.columnCount, preferences.columnWidth, readerHorizontalPadding, readerLineHeightPx, readerTopPadding, readerVerticalPadding]
  )

  // Commit a resolved page: update refs (used synchronously by save/measure),
  // the layout, the horizontal translate, and the React state that renders them.
  const applyPage = useCallback((layout: PageLayout, nextPageCount: number, nextPageIndex: number) => {
    pageIndexRef.current = nextPageIndex
    setPageLayout(layout)
    setPageCount(nextPageCount)
    setPageIndex(nextPageIndex)
    setPageTranslate(pageTranslateX(nextPageIndex, layout.columnsPerPage, layout.columnWidth, layout.columnGap))
  }, [])

  const measurePages = useCallback(() => {
    const article = articleRef.current
    const content = contentRef.current
    if (!article) {
      setPageCount(1)
      return 1
    }

    if (!isPaginated || !content) {
      setPageCount(1)
      return 1
    }

    const layout = computeLayout(article)
    // Apply the measuring styles before reading scrollWidth so the column track
    // reflects the new viewport; React will re-render the same values.
    applyColumnStyles(content, layout)
    const columns = totalColumns(content.scrollWidth, layout.columnWidth, layout.columnGap)
    const nextPageCount = pageCountForColumns(columns, layout.columnsPerPage)

    // Re-anchor: keep the same paragraph (and column within it) on screen across
    // the reflow instead of trusting the old page index.
    let nextPageIndex = clampPageIndex(pageIndexRef.current, nextPageCount)
    const anchor = columnAnchorRef.current
    if (anchor) {
      const paragraph = content.querySelector<HTMLElement>(`[data-paragraph-index="${anchor.paragraphIndex}"]`)
      if (paragraph) {
        const targetColumn = columnIndexOfElement(content, paragraph, layout) + anchor.columnWithin
        nextPageIndex = clampPageIndex(pageIndexForColumn(targetColumn, layout.columnsPerPage), nextPageCount)
      }
    }

    applyPage(layout, nextPageCount, nextPageIndex)
    columnAnchorRef.current = anchorForPage(content, nextPageIndex, layout)
    return nextPageCount
  }, [applyPage, computeLayout, isPaginated])

  const saveCurrentPosition = useCallback(() => {
    const article = articleRef.current
    if (!book || !chapter || !article) {
      return
    }

    // In paginated mode the column anchor is the source of truth for which
    // paragraph sits at the page's top-left; the caret heuristic is unreliable
    // across columns. In continuous mode, read the paragraph under the viewport top.
    const anchor = isPaginated
      ? columnAnchorRef.current
        ? { paragraphIndex: columnAnchorRef.current.paragraphIndex, text: undefined, textOffset: undefined }
        : undefined
      : readVisibleTextAnchor(article, readerAnchorInset)
    const nextPageCount = isPaginated ? Math.max(pageCount, 1) : pageCount
    const nextPageIndex = isPaginated ? clampPageIndex(pageIndexRef.current, nextPageCount) : 0
    const scrollProgress = isPaginated
      ? pageProgress(nextPageIndex, nextPageCount) / 100
      : (() => {
          const scrollableHeight = Math.max(article.scrollHeight - article.clientHeight, 0)
          return scrollableHeight > 0 ? clamp(article.scrollTop / scrollableHeight, 0, 1) : 0
        })()
    const scrollTopValue = isPaginated ? pageTranslate : article.scrollTop
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
      scrollTop: Math.round(scrollTopValue),
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
  }, [book, chapter, chapterIndex, isPaginated, onSavePosition, pageCount, pageTranslate, preferences.readingFlow, readerAnchorInset])

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
      if (!article || !content || !isPaginated) {
        return
      }

      const layout = computeLayout(article)
      applyColumnStyles(content, layout)
      const columns = totalColumns(content.scrollWidth, layout.columnWidth, layout.columnGap)
      const count = pageCountForColumns(columns, layout.columnsPerPage)
      const safePageIndex = clampPageIndex(nextPageIndex, count)

      applyPage(layout, count, safePageIndex)
      columnAnchorRef.current = anchorForPage(content, safePageIndex, layout)
      setPageEdgeHint(null)
      article.scrollTo({ top: 0, left: 0, behavior: "auto" })
      schedulePositionSave(250)
    },
    [applyPage, computeLayout, isPaginated, schedulePositionSave]
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
    columnAnchorRef.current = undefined
    setAnnotationMenu(null)
    setPageCount(1)
    setSelection(null)
    setNoteDraft("")

    window.requestAnimationFrame(() => {
      const content = contentRef.current

      if (preferences.readingFlow === "paginated" && content) {
        const layout = computeLayout(article)
        applyColumnStyles(content, layout)
        const columns = totalColumns(content.scrollWidth, layout.columnWidth, layout.columnGap)
        const count = pageCountForColumns(columns, layout.columnsPerPage)

        let nextPageIndex = 0
        if (savedPosition?.anchorParagraphIndex !== undefined) {
          const paragraph = content.querySelector<HTMLElement>(`[data-paragraph-index="${savedPosition.anchorParagraphIndex}"]`)
          if (paragraph) {
            nextPageIndex = clampPageIndex(pageIndexForColumn(columnIndexOfElement(content, paragraph, layout), layout.columnsPerPage), count)
          }
        } else if (savedPosition?.readingFlow === "paginated" && savedPosition.pageIndex !== undefined) {
          // Remap a stored page index proportionally — the saved layout may have
          // had a different page count (e.g. saved on a shorter window).
          const savedCount = Math.max(savedPosition.pageCount ?? count, 1)
          const fraction = savedCount > 1 ? savedPosition.pageIndex / (savedCount - 1) : 0
          nextPageIndex = clampPageIndex(Math.round(fraction * (count - 1)), count)
        } else if (savedPosition?.scrollProgress !== undefined) {
          nextPageIndex = clampPageIndex(Math.round(savedPosition.scrollProgress * (count - 1)), count)
        }

        applyPage(layout, count, nextPageIndex)
        columnAnchorRef.current = anchorForPage(content, nextPageIndex, layout)
        article.scrollTo({ top: 0, left: 0 })
      } else {
        measurePages()
        const restoredFromAnchor = savedPosition ? restoreToTextAnchor(article, savedPosition, readerAnchorInset) : false
        if (!restoredFromAnchor) {
          article.scrollTo({ top: savedPosition?.scrollTop ?? 0, left: 0 })
        }
      }

      window.setTimeout(() => {
        isRestoringPositionRef.current = false
      }, 150)
    })
  }, [applyPage, book?.id, book?.lastPosition, chapter?.id, computeLayout, measurePages, preferences.readingFlow, readerAnchorInset])

  useEffect(() => {
    const article = articleRef.current
    measurePages()
    // Don't let a reflow re-anchor while a position restore is mid-flight.
    const remeasure = () => {
      if (isRestoringPositionRef.current) {
        return
      }
      measurePages()
    }
    window.addEventListener("resize", remeasure)

    let observer: ResizeObserver | undefined
    if (article && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(remeasure)
      observer.observe(article)
    }

    return () => {
      window.removeEventListener("resize", remeasure)
      observer?.disconnect()
    }
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
        const content = contentRef.current
        const layout = computeLayout(article)
        applyColumnStyles(content, layout)
        const columns = totalColumns(content.scrollWidth, layout.columnWidth, layout.columnGap)
        const count = pageCountForColumns(columns, layout.columnsPerPage)
        const nextPageIndex = clampPageIndex(pageIndexForColumn(columnIndexOfElement(content, annotationElement, layout), layout.columnsPerPage), count)
        applyPage(layout, count, nextPageIndex)
        columnAnchorRef.current = anchorForPage(content, nextPageIndex, layout)
        article.scrollTo({ top: 0, left: 0 })
        return
      }

      annotationElement.scrollIntoView({
        block: "center",
        inline: "nearest"
      })
    })
  }, [activeAnnotationId, annotationFocusTick, applyPage, chapter?.id, computeLayout, isPaginated])

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

    const range = selected.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      setSelection(null)
      return
    }

    // Anchor the selection to its start paragraph + character offset so a
    // highlight resolves to this exact occurrence, even for repeated words.
    const startParagraph = closestParagraphElement(range.startContainer, articleRef.current)
    const anchorParagraphIndex = startParagraph ? Number(startParagraph.dataset.paragraphIndex) : undefined
    const anchorTextOffset = startParagraph
      ? textOffsetWithin(startParagraph, range.startContainer, range.startOffset)
      : undefined
    const anchorTextEnd = startParagraph && startParagraph.contains(range.endContainer)
      ? textOffsetWithin(startParagraph, range.endContainer, range.endOffset)
      : (anchorTextOffset ?? 0) + text.length

    const overlappingAnnotations = findOverlappingAnnotations(
      {
        paragraphIndex: Number.isFinite(anchorParagraphIndex) ? anchorParagraphIndex : undefined,
        start: anchorTextOffset ?? 0,
        end: anchorTextEnd
      },
      chapterAnnotations,
      paragraphs
    )
    setAnnotationMenu(null)
    setSelection({
      anchorParagraphIndex: Number.isFinite(anchorParagraphIndex) ? anchorParagraphIndex : undefined,
      anchorTextOffset,
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
      anchorParagraphIndex: selection.anchorParagraphIndex,
      anchorTextOffset: selection.anchorTextOffset,
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
    // With wide side gutters the margin overlay buttons own the hover affordance,
    // so the floating-arrow hint stays off to avoid a duplicate control.
    if (!isPaginated || !articleRef.current || hasSideMargins) {
      setPageEdgeHint(null)
      return
    }

    const rect = articleRef.current.getBoundingClientRect()
    const edgeSize = rect.width / 3
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
    // With wide side gutters the margin overlay buttons handle paging, so the
    // article click is reserved for selection/annotation only.
    if (!isPaginated || !articleRef.current || hasSideMargins) {
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
    const edgeSize = rect.width / 3
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
                paddingBottom: readerVerticalPadding,
                paddingLeft: readerHorizontalPadding,
                paddingRight: readerHorizontalPadding,
                paddingTop: readerTopPadding
              }}
              onClick={handleReaderClick}
              onKeyUp={updateSelection}
              onMouseUp={updateSelection}
              onScroll={handleReaderScroll}
            >
              {isPaginated ? (
                <div
                  className="relative mx-auto overflow-hidden"
                  style={{ width: pageLayout.clipWidth || undefined, height: pageLayout.pageHeight || undefined }}
                >
                  <div
                    ref={contentRef}
                    style={{
                      height: pageLayout.pageHeight || undefined,
                      width: pageLayout.clipWidth || undefined,
                      columnWidth: pageLayout.columnWidth,
                      columnGap: pageLayout.columnGap,
                      columnFill: "auto",
                      fontSize: preferences.fontScale,
                      lineHeight: preferences.lineHeight,
                      hyphens: preferences.hyphenation ? "auto" : "manual",
                      fontFamily: readerFontFamily,
                      textAlign: preferences.textAlign === "justify" ? "justify" : "start",
                      transform: `translate3d(${-pageTranslate}px, 0, 0)`,
                      willChange: "transform"
                    }}
                  >
                    <h2
                      className={cn(cleanReading ? "reader-muted text-base font-medium" : "text-2xl font-semibold", "tracking-normal")}
                      data-readable-block
                      style={{ fontSize: preferences.fontScale, lineHeight: preferences.lineHeight, marginBottom: readerLineHeightPx }}
                    >
                      {chapter.title}
                    </h2>
                    {paragraphs.map((paragraph, index) => (
                      <p
                        key={`${chapter.id}-${index}`}
                        data-paragraph-index={index}
                        data-readable-block
                        style={{ marginTop: index === 0 ? 0 : paginatedParagraphSpacing }}
                      >
                        {renderParagraphWithAnnotations(paragraph, index, chapterAnnotations, annotationPlacements, activeAnnotationId, openAnnotationMenu)}
                      </p>
                    ))}
                  </div>
                </div>
              ) : (
                <div
                  ref={contentRef}
                  className="mx-auto"
                  style={{
                    maxWidth: contentMaxWidth,
                    fontSize: preferences.fontScale,
                    lineHeight: preferences.lineHeight,
                    hyphens: preferences.hyphenation ? "auto" : "manual",
                    fontFamily: readerFontFamily,
                    textAlign: preferences.textAlign === "justify" ? "justify" : "start"
                  }}
                >
                  <div className={cn(cleanReading && "text-center", "mb-8")}>
                    {!cleanReading ? <p className="reader-muted mb-2 text-sm">{t("reader.bookProgress", { progress })}</p> : null}
                    <h2
                      className={cn(cleanReading ? "reader-muted text-base font-medium" : "text-3xl font-semibold", "tracking-normal")}
                      data-readable-block
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
                        style={{ marginTop: index === 0 ? 0 : `${preferences.paragraphSpacing}em` }}
                      >
                        {renderParagraphWithAnnotations(paragraph, index, chapterAnnotations, annotationPlacements, activeAnnotationId, openAnnotationMenu)}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </article>

            {hasSideMargins ? (
              <>
                <button
                  aria-disabled={pageIndex <= 0}
                  aria-label={t("reader.pagePrevious")}
                  className={cn(
                    "group absolute inset-y-0 left-0 z-10 flex select-none items-center justify-center",
                    pageIndex > 0 && "reader-page-zone"
                  )}
                  style={{ width: pageLayout.sideMargin }}
                  title={t("reader.pagePrevious")}
                  onClick={() => {
                    if (pageIndex > 0) {
                      goToPage(pageIndex - 1)
                    }
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                >
                  <ChevronLeft
                    className={cn("h-6 w-6 opacity-0 transition-opacity duration-200", pageIndex > 0 && "group-hover:opacity-70")}
                    aria-hidden="true"
                  />
                </button>
                <button
                  aria-disabled={pageIndex >= pageCount - 1}
                  aria-label={t("reader.pageNext")}
                  className={cn(
                    "group absolute inset-y-0 right-0 z-10 flex select-none items-center justify-center",
                    pageIndex < pageCount - 1 && "reader-page-zone"
                  )}
                  style={{ width: pageLayout.sideMargin }}
                  title={t("reader.pageNext")}
                  onClick={() => {
                    if (pageIndex < pageCount - 1) {
                      goToPage(pageIndex + 1)
                    }
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                >
                  <ChevronRight
                    className={cn("h-6 w-6 opacity-0 transition-opacity duration-200", pageIndex < pageCount - 1 && "group-hover:opacity-70")}
                    aria-hidden="true"
                  />
                </button>
              </>
            ) : null}
          </div>

          {isPaginated && !hasSideMargins ? (
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
  paragraphIndex: number,
  annotations: Annotation[],
  placements: Map<string, AnnotationPlacement>,
  activeAnnotationId: string | null,
  onOpenAnnotationMenu: (annotation: Annotation, x: number, y: number) => void
) {
  const ranges = findAnnotationRanges(paragraphIndex, annotations, placements)

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

// Imperatively apply the column track styles so a subsequent scrollWidth read
// reflects the new layout in the same frame. React re-renders the same values
// from `pageLayout`, so this never fights the declarative styles.
function applyColumnStyles(content: HTMLElement, layout: PageLayout): void {
  content.style.height = `${layout.pageHeight}px`
  content.style.width = `${layout.clipWidth}px`
  content.style.columnWidth = `${layout.columnWidth}px`
  content.style.columnGap = `${layout.columnGap}px`
  content.style.columnFill = "auto"
}

// Which column (zero-based) an element's first fragment sits in. Measured
// relative to the content box so the current translateX cancels out, giving the
// element's intrinsic column even while the track is shifted for paging.
function columnIndexOfElement(content: HTMLElement, element: HTMLElement, layout: PageLayout): number {
  const contentRect = content.getBoundingClientRect()
  const rects = element.getClientRects()
  if (rects.length === 0) {
    return 0
  }

  let leftMost = Infinity
  for (const rect of rects) {
    leftMost = Math.min(leftMost, rect.left)
  }
  return columnIndexForOffset(leftMost - contentRect.left, layout.columnWidth, layout.columnGap)
}

// The paragraph anchor for the column at the left edge of the given page. Used
// to keep the reader on the same text across a reflow.
function anchorForPage(content: HTMLElement, pageIndex: number, layout: PageLayout): ColumnAnchor | undefined {
  const leftColumn = pageIndex * layout.columnsPerPage
  const paragraphs = Array.from(content.querySelectorAll<HTMLElement>("[data-paragraph-index]"))
  let chosen: HTMLElement | undefined
  let chosenFirstColumn = 0

  for (const paragraph of paragraphs) {
    const firstColumn = columnIndexOfElement(content, paragraph, layout)
    if (firstColumn <= leftColumn) {
      chosen = paragraph
      chosenFirstColumn = firstColumn
    } else {
      break
    }
  }

  if (!chosen) {
    return undefined
  }

  return {
    paragraphIndex: Number(chosen.dataset.paragraphIndex),
    columnWithin: Math.max(0, leftColumn - chosenFirstColumn)
  }
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
                    <div key={annotation.id} className={cn("rounded-md border bg-card p-3", `annotation-${annotation.color}`, annotation.id === activeAnnotationId && "bg-primary/5")}>
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
