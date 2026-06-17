import { FileText, Grid2X2, List, Loader2, Plus, Search, Trash2 } from "lucide-react"
import { IconToggle } from "@renderer/components/common/Controls"
import type { LibraryMode, LibraryStatus, TranslationFn } from "@renderer/app/types"
import { cn, formatAuthors } from "@renderer/lib/utils"
import type { BookSummary } from "@renderer/types"

export function LibraryPane({
  expanded = false,
  books,
  count,
  importing,
  mode,
  search,
  selectedBookId,
  status,
  t,
  deletingBookId,
  onImport,
  onDeleteBook,
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
  t: TranslationFn
  deletingBookId?: string
  onImport: () => void
  onDeleteBook: (book: BookSummary) => void
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
            <BookCard
              key={book.id}
              book={book}
              deleting={deletingBookId === book.id}
              mode={mode}
              selected={book.id === selectedBookId}
              t={t}
              onDelete={() => onDeleteBook(book)}
              onSelect={() => onSelectBook(book.id)}
            />
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
  deleting,
  mode,
  selected,
  t,
  onDelete,
  onSelect
}: {
  book: BookSummary
  deleting: boolean
  mode: LibraryMode
  selected: boolean
  t: TranslationFn
  onDelete: () => void
  onSelect: () => void
}) {
  const deleteLabel = t("library.deleteBookNamed", { title: book.title })

  if (mode === "grid") {
    return (
      <div className="group relative w-full text-left">
        <button className="w-full text-left" title={t("library.openBook")} onClick={onSelect}>
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
        <button
          className="absolute right-1 top-1 inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/45 bg-background/90 text-muted-foreground opacity-0 shadow-sm transition hover:border-destructive/50 hover:text-destructive focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-destructive/30 group-hover:opacity-100"
          aria-label={deleteLabel}
          disabled={deleting}
          title={deleteLabel}
          onClick={onDelete}
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex w-full items-center gap-3 rounded-md border bg-card p-3 text-left shadow-sm transition hover:border-primary/50",
        selected && "border-primary ring-2 ring-primary/15"
      )}
    >
      <button className="flex min-w-0 flex-1 items-center gap-3 text-left" title={t("library.openBook")} onClick={onSelect}>
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
      <button
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition hover:border-destructive/50 hover:text-destructive focus:outline-none focus:ring-2 focus:ring-destructive/30"
        aria-label={deleteLabel}
        disabled={deleting}
        title={deleteLabel}
        onClick={onDelete}
      >
        {deleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  )
}
