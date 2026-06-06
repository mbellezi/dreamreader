import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Grid2X2,
  Heart,
  Highlighter,
  Languages,
  Library,
  List,
  Loader2,
  Moon,
  Palette,
  PanelRight,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Star,
  Sun,
  Trash2
} from "lucide-react"
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react"
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
  ReaderPreferences
} from "@renderer/types"

type AppView = "library" | "reader" | "settings"
type LibraryMode = "grid" | "list"
type InspectorTab = "summary" | "annotations" | "preferences"

const themeOptions: AppearanceTheme[] = ["light", "dark", "sepia", "contrast"]
const colorOptions: HighlightColor[] = ["yellow", "green", "blue", "rose"]
const kindOptions: AnnotationKind[] = ["highlight", "note", "favorite"]

const emptyAnnotation = {
  excerpt: "",
  note: "",
  kind: "highlight" as AnnotationKind,
  color: "yellow" as HighlightColor
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
  const [annotationDraft, setAnnotationDraft] = useState(emptyAnnotation)
  const [exportContent, setExportContent] = useState("")
  const [settingsSaved, setSettingsSaved] = useState(false)

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
        dreamreaderClient.listBooks({ search })
      ])
      setSettings(nextSettings)
      setBooks(nextBooks)

      if (!selectedBook && nextBooks[0]) {
        const firstBook = await dreamreaderClient.getBook(nextBooks[0].id)
        setSelectedBook(firstBook)
        setAnnotations(firstBook ? await dreamreaderClient.listAnnotations(firstBook.id) : [])
      }
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [search, selectedBook])

  useEffect(() => {
    void loadInitialData()
  }, [loadInitialData])

  useEffect(() => {
    if (!selectedBook || !selectedBook.chapters.length) {
      return
    }

    const safeChapterIndex = clamp(chapterIndex, 0, selectedBook.chapters.length - 1)
    if (safeChapterIndex !== chapterIndex) {
      setChapterIndex(safeChapterIndex)
      return
    }

    const chapter = selectedBook.chapters[safeChapterIndex]
    const progress = Math.round(((safeChapterIndex + 1) / selectedBook.chapters.length) * 100)
    void dreamreaderClient.saveProgress({
      bookId: selectedBook.id,
      chapterId: chapter.id,
      progress,
      updatedAt: new Date().toISOString()
    })
    void refreshBooks()
  }, [chapterIndex, refreshBooks, selectedBook])

  const filteredCount = books.length
  const currentChapter = selectedBook?.chapters[chapterIndex] ?? null
  const bridgeLabel = dreamreaderClient.hasBridge() ? t("app.connection.bridge") : t("app.connection.fallback")

  const updateSearch = async (value: string) => {
    setSearch(value)
    await refreshBooks(value)
  }

  const selectBook = async (bookId: string) => {
    const book = await dreamreaderClient.getBook(bookId)
    setSelectedBook(book)
    setChapterIndex(0)
    setExportContent("")
    setActiveView("reader")
    setInspectorTab("summary")
    setAnnotations(book ? await dreamreaderClient.listAnnotations(book.id) : [])
  }

  const importBooks = async () => {
    const importedBooks = await dreamreaderClient.importBooks()
    setBooks(importedBooks)
  }

  const changeChapter = (direction: -1 | 1) => {
    if (!selectedBook || !selectedBook.chapters.length) {
      return
    }

    setChapterIndex((index) => clamp(index + direction, 0, selectedBook.chapters.length - 1))
  }

  const jumpToChapter = (index: number) => {
    if (!selectedBook?.chapters.length) {
      return
    }
    setChapterIndex(clamp(index, 0, selectedBook.chapters.length - 1))
    setActiveView("reader")
  }

  const saveAnnotation = async () => {
    if (!selectedBook || !currentChapter || !annotationDraft.excerpt.trim()) {
      return
    }

    const annotation = await dreamreaderClient.createAnnotation({
      bookId: selectedBook.id,
      chapterId: currentChapter.id,
      kind: annotationDraft.kind,
      color: annotationDraft.color,
      excerpt: annotationDraft.excerpt.trim(),
      note: annotationDraft.note.trim()
    })
    setAnnotations((current) => [annotation, ...current])
    setAnnotationDraft(emptyAnnotation)
    setInspectorTab("annotations")
  }

  const deleteAnnotation = async (annotationId: string) => {
    await dreamreaderClient.deleteAnnotation(annotationId)
    setAnnotations((current) => current.filter((annotation) => annotation.id !== annotationId))
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

  const updateReaderPreference = <Key extends keyof ReaderPreferences>(key: Key, value: ReaderPreferences[Key]) => {
    if (!settings) {
      return
    }

    updateSettings({
      ...settings,
      reader: {
        ...settings.reader,
        [key]: value
      }
    })
  }

  const saveSettings = async () => {
    if (!settings) {
      return
    }

    const saved = await dreamreaderClient.saveSettings(settings)
    setSettings(saved)
    setSettingsSaved(true)
  }

  const shellClass = cn("min-h-screen bg-background text-foreground", settings?.appearance && `theme-${settings.appearance}`)

  if (loading || !settings) {
    return (
      <main className={shellClass}>
        <div className="flex min-h-screen items-center justify-center">
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
        <div className="flex min-h-screen items-center justify-center px-6">
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
      <div className="flex min-h-screen flex-col">
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

        {activeView === "library" ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <LibraryPane
              expanded
              books={books}
              count={filteredCount}
              mode={libraryMode}
              search={search}
              selectedBookId={selectedBook?.id}
              t={t}
              onImport={importBooks}
              onModeChange={setLibraryMode}
              onSearchChange={updateSearch}
              onSelectBook={selectBook}
            />
          </div>
        ) : (
          <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_340px]">
            <ReaderPane
              book={selectedBook}
              chapter={currentChapter}
              chapterIndex={chapterIndex}
              preferences={settings.reader}
              t={t}
              onAddFavorite={() =>
                setAnnotationDraft((current) => ({
                  ...current,
                  kind: "favorite",
                  excerpt: currentChapter?.text.split(".")[0] ?? ""
                }))
              }
              onAddHighlight={() =>
                setAnnotationDraft((current) => ({
                  ...current,
                  kind: "highlight",
                  excerpt: currentChapter?.text.split(".")[0] ?? ""
                }))
              }
              onNext={() => changeChapter(1)}
              onPrevious={() => changeChapter(-1)}
            />

            <InspectorPane
              activeTab={inspectorTab}
              annotationDraft={annotationDraft}
              annotations={annotations}
              book={selectedBook}
              chapterIndex={chapterIndex}
              exportContent={exportContent}
              preferences={settings.reader}
              t={t}
              onChangeDraft={setAnnotationDraft}
              onChangePreference={updateReaderPreference}
              onChangeTab={setInspectorTab}
              onDeleteAnnotation={deleteAnnotation}
              onExportNotes={exportNotes}
              onJumpToChapter={jumpToChapter}
              onSaveAnnotation={saveAnnotation}
            />
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
  mode,
  search,
  selectedBookId,
  t,
  onImport,
  onModeChange,
  onSearchChange,
  onSelectBook
}: {
  expanded?: boolean
  books: BookSummary[]
  count: number
  mode: LibraryMode
  search: string
  selectedBookId?: string
  t: (key: string, values?: Record<string, string | number>) => string
  onImport: () => void
  onModeChange: (mode: LibraryMode) => void
  onSearchChange: (value: string) => void
  onSelectBook: (bookId: string) => void
}) {
  return (
    <aside className={cn("flex min-h-[420px] flex-col bg-sidebar", expanded ? "h-full" : "border-r")}>
      <div className="border-b p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t("library.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("library.subtitle", { count })}</p>
          </div>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
            onClick={onImport}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("library.import")}
          </button>
        </div>

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
              ? "grid content-start gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              : "grid content-start gap-3 sm:grid-cols-2 lg:grid-cols-1"),
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
  return (
    <button
      className={cn(
        "w-full rounded-md border bg-card p-3 text-left shadow-sm transition hover:border-primary/50",
        selected && "border-primary ring-2 ring-primary/15",
        mode === "list" && "flex items-center gap-3"
      )}
      onClick={onSelect}
    >
      <div
        className={cn("flex shrink-0 items-end rounded-sm p-2 text-primary-foreground shadow-inner", mode === "grid" ? "mb-3 h-28 w-full" : "h-20 w-14")}
        style={{ backgroundColor: book.coverColor }}
      >
        <FileText className="h-5 w-5" aria-hidden="true" />
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
  book,
  chapter,
  chapterIndex,
  preferences,
  t,
  onAddFavorite,
  onAddHighlight,
  onNext,
  onPrevious
}: {
  book: BookDetails | null
  chapter: BookDetails["chapters"][number] | null
  chapterIndex: number
  preferences: ReaderPreferences
  t: (key: string, values?: Record<string, string | number>) => string
  onAddFavorite: () => void
  onAddHighlight: () => void
  onNext: () => void
  onPrevious: () => void
}) {
  const progress = book?.chapters.length ? Math.round(((chapterIndex + 1) / book.chapters.length) * 100) : 0
  const paragraphs = useMemo(() => chapter?.text.split("\n\n") ?? [], [chapter])

  return (
    <section className={cn("min-h-[520px] overflow-hidden bg-reader", `reader-${preferences.theme}`)}>
      {book && chapter ? (
        <div className="flex h-full flex-col">
          <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background/85 px-4">
            <button className="inline-flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-sm" onClick={onPrevious} disabled={chapterIndex === 0}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t("reader.previous")}</span>
            </button>
            <div className="min-w-0 text-center">
              <p className="truncate text-sm font-medium">{book.title}</p>
              <p className="text-xs text-muted-foreground">{t("reader.chapterProgress", { current: chapterIndex + 1, total: book.chapters.length })}</p>
            </div>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-sm"
              onClick={onNext}
              disabled={chapterIndex >= book.chapters.length - 1}
            >
              <span className="hidden sm:inline">{t("reader.next")}</span>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="h-1 bg-muted">
            <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
          </div>

          <article className="min-h-0 flex-1 overflow-auto px-5 py-8">
            <div
              className="mx-auto"
              style={{
                maxWidth: preferences.columnWidth,
                fontSize: preferences.fontScale,
                lineHeight: preferences.lineHeight,
                hyphens: preferences.hyphenation ? "auto" : "manual"
              }}
            >
              <div className="mb-8">
                <p className="mb-2 text-sm text-muted-foreground">{t("reader.bookProgress", { progress })}</p>
                <h2 className="text-3xl font-semibold tracking-normal">{chapter.title}</h2>
              </div>
              <div className="reader-copy space-y-6">
                {paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </div>
          </article>

          <div className="flex h-14 shrink-0 items-center justify-center gap-2 border-t bg-background/85 px-4">
            <button className="inline-flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-sm" onClick={onAddHighlight}>
              <Highlighter className="h-4 w-4" aria-hidden="true" />
              {t("reader.highlight")}
            </button>
            <button className="inline-flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-sm" onClick={onAddFavorite}>
              <Heart className="h-4 w-4" aria-hidden="true" />
              {t("reader.favorite")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex h-full min-h-[520px] items-center justify-center p-6">
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

function InspectorPane({
  activeTab,
  annotationDraft,
  annotations,
  book,
  chapterIndex,
  exportContent,
  preferences,
  t,
  onChangeDraft,
  onChangePreference,
  onChangeTab,
  onDeleteAnnotation,
  onExportNotes,
  onJumpToChapter,
  onSaveAnnotation
}: {
  activeTab: InspectorTab
  annotationDraft: typeof emptyAnnotation
  annotations: Annotation[]
  book: BookDetails | null
  chapterIndex: number
  exportContent: string
  preferences: ReaderPreferences
  t: (key: string, values?: Record<string, string | number>) => string
  onChangeDraft: (draft: typeof emptyAnnotation) => void
  onChangePreference: <Key extends keyof ReaderPreferences>(key: Key, value: ReaderPreferences[Key]) => void
  onChangeTab: (tab: InspectorTab) => void
  onDeleteAnnotation: (annotationId: string) => void
  onExportNotes: () => void
  onJumpToChapter: (index: number) => void
  onSaveAnnotation: () => void
}) {
  return (
    <aside className="flex min-h-[420px] flex-col border-l bg-sidebar">
      <div className="grid grid-cols-3 border-b p-2">
        <IconToggle active={activeTab === "summary"} icon={PanelRight} label={t("reader.summary")} onClick={() => onChangeTab("summary")} />
        <IconToggle active={activeTab === "annotations"} icon={Highlighter} label={t("reader.annotations")} onClick={() => onChangeTab("annotations")} />
        <IconToggle active={activeTab === "preferences"} icon={SlidersHorizontal} label={t("reader.preferences")} onClick={() => onChangeTab("preferences")} />
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {activeTab === "summary" ? (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">{t("reader.summary")}</h2>
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
        ) : null}

        {activeTab === "annotations" ? (
          <div className="space-y-4">
            <div className="space-y-3 rounded-md border bg-card p-3">
              <h2 className="text-sm font-semibold">{t("reader.note")}</h2>
              <div className="grid grid-cols-2 gap-2">
                <SelectField
                  label={t("reader.annotations")}
                  value={annotationDraft.kind}
                  onChange={(value) => onChangeDraft({ ...annotationDraft, kind: value as AnnotationKind })}
                  options={kindOptions.map((kind) => ({ value: kind, label: t(`reader.kind.${kind}`) }))}
                />
                <SelectField
                  label={t("reader.theme")}
                  value={annotationDraft.color}
                  onChange={(value) => onChangeDraft({ ...annotationDraft, color: value as HighlightColor })}
                  options={colorOptions.map((color) => ({ value: color, label: t(`reader.color.${color}`) }))}
                />
              </div>
              <TextAreaField
                label={t("reader.annotationExcerpt")}
                placeholder={t("reader.annotationExcerptPlaceholder")}
                value={annotationDraft.excerpt}
                onChange={(value) => onChangeDraft({ ...annotationDraft, excerpt: value })}
              />
              <TextAreaField
                label={t("reader.annotationNote")}
                placeholder={t("reader.annotationNotePlaceholder")}
                value={annotationDraft.note}
                onChange={(value) => onChangeDraft({ ...annotationDraft, note: value })}
              />
              <button className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground" onClick={onSaveAnnotation}>
                <Star className="h-4 w-4" aria-hidden="true" />
                {t("reader.saveAnnotation")}
              </button>
            </div>

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
                annotations.map((annotation) => (
                  <div key={annotation.id} className={cn("rounded-md border bg-card p-3", `annotation-${annotation.color}`)}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-medium">{t(`reader.kind.${annotation.kind}`)}</span>
                      <button className="rounded-sm p-1 text-muted-foreground hover:text-destructive" title={t("reader.deleteAnnotation")} onClick={() => onDeleteAnnotation(annotation.id)}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                    <p className="mt-2 text-sm">{annotation.excerpt}</p>
                    {annotation.note ? <p className="mt-2 text-xs text-muted-foreground">{annotation.note}</p> : null}
                  </div>
                ))
              ) : (
                <p className="rounded-md border bg-card p-3 text-sm text-muted-foreground">{t("reader.emptyAnnotations")}</p>
              )}
            </div>
          </div>
        ) : null}

        {activeTab === "preferences" ? (
          <div className="space-y-5">
            <h2 className="text-sm font-semibold">{t("reader.preferences")}</h2>
            <SelectField
              label={t("reader.theme")}
              value={preferences.theme}
              onChange={(value) => onChangePreference("theme", value as AppearanceTheme)}
              options={themeOptions.map((theme) => ({ value: theme, label: t(`reader.theme.${theme}`) }))}
            />
            <SliderField
              label={t("reader.fontScale")}
              value={preferences.fontScale}
              min={14}
              max={24}
              onChange={(value) => onChangePreference("fontScale", value)}
            />
            <SliderField
              label={t("reader.columnWidth")}
              value={preferences.columnWidth}
              min={520}
              max={920}
              onChange={(value) => onChangePreference("columnWidth", value)}
            />
            <SliderField
              label={t("reader.lineHeight")}
              value={Math.round(preferences.lineHeight * 10)}
              min={14}
              max={22}
              onChange={(value) => onChangePreference("lineHeight", value / 10)}
            />
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

function TextAreaField({
  label,
  placeholder,
  value,
  onChange
}: {
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block text-sm">
      <span className="mb-2 block text-xs font-medium text-muted-foreground">{label}</span>
      <textarea
        className="h-20 w-full resize-none rounded-md border bg-background p-2 text-sm outline-none placeholder:text-muted-foreground"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
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
