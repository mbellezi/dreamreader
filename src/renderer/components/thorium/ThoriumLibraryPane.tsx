import { BookOpen, Loader2, Plus, Search, Trash2 } from "lucide-react"
import type { LibraryStatus, TranslationFn } from "@renderer/app/types"
import { cn, formatAuthors } from "@renderer/lib/utils"
import type { BookSummary } from "@renderer/types"

type ThoriumLibraryPaneProps = {
  books: BookSummary[]
  count: number
  deletingBookId?: string
  importing: boolean
  search: string
  selectedBookId?: string
  status: LibraryStatus | null
  t: TranslationFn
  onDeleteBook: (book: BookSummary) => void
  onImport: () => void
  onSearchChange: (value: string) => void
  onSelectBook: (bookId: string) => void
}

export function ThoriumLibraryPane({
  books,
  count,
  deletingBookId,
  importing,
  search,
  selectedBookId,
  status,
  t,
  onDeleteBook,
  onImport,
  onSearchChange,
  onSelectBook
}: ThoriumLibraryPaneProps) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
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
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        {books.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]">
            {books.map((book) => (
              <article
                key={book.id}
                className={cn(
                  "group relative rounded-md border bg-card shadow-sm transition hover:border-primary/60 hover:shadow-md focus-within:ring-2 focus-within:ring-primary/30",
                  book.id === selectedBookId && "border-primary ring-2 ring-primary/15"
                )}
              >
                <button
                  className="grid min-h-40 w-full cursor-pointer grid-cols-[6.5rem_minmax(0,1fr)] gap-3 rounded-md p-3 text-left focus:outline-none"
                  type="button"
                  onClick={() => onSelectBook(book.id)}
                  onDoubleClick={() => onSelectBook(book.id)}
                >
                  <span
                    className="relative block aspect-[2/3] w-full overflow-hidden rounded-[3px] bg-muted shadow-[0_10px_24px_rgba(15,23,42,0.20)] ring-1 ring-black/10"
                    style={{ backgroundColor: book.coverColor }}
                  >
                    {book.coverImageUrl ? (
                      <img className="h-full w-full object-cover" src={book.coverImageUrl} alt="" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <BookOpen className="h-8 w-8" aria-hidden="true" />
                      </span>
                    )}
                    {book.progress > 0 ? (
                      <span className="absolute inset-x-0 bottom-0 h-1 bg-black/20">
                        <span className="block h-full bg-primary" style={{ width: `${book.progress}%` }} />
                      </span>
                    ) : null}
                  </span>
                  <span className="flex min-w-0 flex-col gap-2 pr-8">
                    <span className="line-clamp-3 text-sm font-semibold leading-snug">{book.title}</span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">{formatAuthors(book.authors)}</span>
                    <span className="mt-auto inline-flex w-fit rounded-sm bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
                      {book.format.toUpperCase()}
                    </span>
                  </span>
                </button>
                <button
                  className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/45 bg-background/90 text-muted-foreground opacity-0 shadow-sm transition hover:border-destructive/50 hover:text-destructive focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-destructive/30 group-focus-within:opacity-100 group-hover:opacity-100"
                  type="button"
                  aria-label={t("library.deleteBookNamed", { title: book.title })}
                  disabled={deletingBookId === book.id}
                  title={t("library.deleteBookNamed", { title: book.title })}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onDeleteBook(book)
                  }}
                >
                  {deletingBookId === book.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-md border bg-card p-4">
            <h3 className="text-sm font-medium">{t("library.emptyTitle")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t("library.emptyBody")}</p>
          </div>
        )}
      </div>
    </section>
  )
}
