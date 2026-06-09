import { Trash2, Wand2 } from "lucide-react"
import { ChapterStatusBadge } from "@renderer/components/audio/ChapterStatusBadge"
import type { TranslationFn } from "@renderer/app/types"
import type { ChapterAudioStatus } from "@renderer/lib/chapterStatus"
import { cn } from "@renderer/lib/utils"
import type { AudiobookChapter, Chapter } from "@renderer/types"

export function ChapterRow({
  chapter,
  status,
  manifestChapter,
  active,
  selected,
  canGenerate,
  loading,
  hasActiveJob,
  hasGeneration,
  t,
  onSelect,
  onToggleSelected,
  onGenerate,
  onClear
}: {
  chapter: Chapter
  status: ChapterAudioStatus
  manifestChapter?: AudiobookChapter
  active: boolean
  selected: boolean
  canGenerate: boolean
  loading: boolean
  hasActiveJob: boolean
  hasGeneration: boolean
  t: TranslationFn
  onSelect: () => void
  onToggleSelected: (checked: boolean) => void
  onGenerate: () => void
  onClear: () => void
}) {
  return (
    <div
      className={cn(
        "rounded-md border bg-card p-3 transition",
        active ? "border-primary ring-2 ring-primary/15" : "hover:border-muted-foreground/40"
      )}
    >
      <div className="flex items-center gap-3">
        <input
          className="h-4 w-4 shrink-0 accent-primary"
          type="checkbox"
          aria-label={chapter.title}
          checked={selected}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onToggleSelected(event.target.checked)}
        />
        <button
          className="min-w-0 flex-1 text-left"
          type="button"
          onClick={onSelect}
        >
          <p className="truncate text-sm font-medium">{chapter.title}</p>
        </button>
        <ChapterStatusBadge status={status} t={t} />
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            disabled={!canGenerate || hasActiveJob || loading}
            title={status.kind === "ready" ? t("audio.regenerate") : t("audio.generate")}
            onClick={onGenerate}
          >
            <Wand2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="hidden sm:inline">{status.kind === "ready" ? t("audio.regenerate") : t("audio.generate")}</span>
          </button>
          {hasGeneration ? (
            <button
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-background text-muted-foreground hover:text-destructive disabled:opacity-50"
              disabled={hasActiveJob || loading}
              title={t("audio.clearChapterGeneration")}
              onClick={onClear}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {status.kind === "generating" || status.kind === "queued" ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary" style={{ width: `${Math.round((status.progress ?? 0) * 100)}%` }} />
        </div>
      ) : null}

      {status.kind === "ready" && manifestChapter ? (
        <audio
          className="mt-2 w-full"
          controls
          preload="none"
          src={`dreamreader://asset/${encodeURIComponent(manifestChapter.audioAssetId)}`}
        />
      ) : null}
    </div>
  )
}
