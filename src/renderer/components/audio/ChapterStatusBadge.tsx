import type { TranslationFn } from "@renderer/app/types"
import type { ChapterAudioStatus } from "@renderer/lib/chapterStatus"
import { formatDuration } from "@renderer/lib/formatDuration"
import { cn } from "@renderer/lib/utils"

export function ChapterStatusBadge({ status, t }: { status: ChapterAudioStatus; t: TranslationFn }) {
  const label =
    status.kind === "ready"
      ? t("studio.chapter.status.ready", { duration: formatDuration(status.durationMs ?? 0) })
      : status.kind === "generating"
        ? t("studio.chapter.status.generating", { percent: Math.round((status.progress ?? 0) * 100) })
        : status.kind === "queued"
          ? t("studio.chapter.status.queued")
          : status.kind === "failed"
            ? t("studio.chapter.status.failed")
            : t("studio.chapter.status.none")

  return (
    <span
      className={cn(
        "shrink-0 whitespace-nowrap rounded-sm px-2 py-1 text-[11px] font-medium",
        status.kind === "ready" && "bg-primary/10 text-primary",
        status.kind === "generating" && "bg-amber-500/10 text-amber-600",
        status.kind === "queued" && "bg-muted text-muted-foreground",
        status.kind === "failed" && "bg-destructive/10 text-destructive",
        status.kind === "none" && "bg-muted text-muted-foreground"
      )}
    >
      {label}
    </span>
  )
}
