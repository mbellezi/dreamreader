import { Loader2, Plus, Trash2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { SelectField } from "@renderer/components/common/Controls"
import type { TranslationFn } from "@renderer/app/types"
import type { BookSummary, PronunciationEntry } from "@renderer/types"

const GLOBAL_SCOPE_VALUE = ""

export function PronunciationManager({
  books,
  loading,
  t,
  onListPronunciation,
  onCreatePronunciation,
  onDeletePronunciation
}: {
  books: BookSummary[]
  loading: boolean
  t: TranslationFn
  onListPronunciation: (bookId?: string) => Promise<PronunciationEntry[]>
  onCreatePronunciation: (input: { bookId?: string; pattern: string; replacement: string; scope: "global" | "book" }) => Promise<void>
  onDeletePronunciation: (id: string) => Promise<void>
}) {
  const [selectedBookId, setSelectedBookId] = useState<string>(GLOBAL_SCOPE_VALUE)
  const [entries, setEntries] = useState<PronunciationEntry[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [pattern, setPattern] = useState("")
  const [replacement, setReplacement] = useState("")

  const bookId = selectedBookId || undefined
  const scope: "global" | "book" = selectedBookId ? "book" : "global"

  const refresh = useCallback(async () => {
    setListLoading(true)
    try {
      setEntries(await onListPronunciation(bookId))
    } finally {
      setListLoading(false)
    }
  }, [bookId, onListPronunciation])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const scopeOptions = [
    { label: t("pronunciation.global"), value: GLOBAL_SCOPE_VALUE },
    ...books.map((book) => ({ label: book.title, value: book.id }))
  ]

  const canAdd = Boolean(pattern.trim()) && Boolean(replacement.trim()) && !loading

  const handleAdd = async () => {
    if (!canAdd) {
      return
    }
    await onCreatePronunciation({ bookId, pattern, replacement, scope })
    setPattern("")
    setReplacement("")
    await refresh()
  }

  const handleDelete = async (id: string) => {
    await onDeletePronunciation(id)
    await refresh()
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("audio.pronunciation")}</h3>
        {listLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" /> : null}
      </div>

      <div className="rounded-md border bg-card p-3">
        <div className="grid grid-cols-1 gap-2">
          <SelectField
            label={t("pronunciation.scopeSelector")}
            options={scopeOptions}
            value={selectedBookId}
            onChange={setSelectedBookId}
          />
          <input
            className="h-9 rounded-md border bg-background px-3 text-sm outline-none"
            placeholder={t("audio.pronunciation.pattern")}
            value={pattern}
            onChange={(event) => setPattern(event.target.value)}
          />
          <input
            className="h-9 rounded-md border bg-background px-3 text-sm outline-none"
            placeholder={t("audio.pronunciation.replacement")}
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
          />
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm disabled:opacity-50"
            disabled={!canAdd}
            onClick={() => void handleAdd()}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("audio.pronunciation.add")}
          </button>
        </div>
      </div>

      {entries.length ? (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between gap-3 rounded-md border bg-card p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {entry.pattern} → {entry.replacement}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{t(`audio.pronunciation.scope.${entry.scope}`)}</p>
              </div>
              <button
                className="shrink-0 rounded-sm p-1 text-muted-foreground hover:text-destructive"
                title={t("audio.pronunciation.delete")}
                onClick={() => void handleDelete(entry.id)}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-md border bg-card p-3 text-sm text-muted-foreground">{t("audio.pronunciation.empty")}</p>
      )}
    </section>
  )
}
