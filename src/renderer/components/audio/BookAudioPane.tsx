import { ArrowLeft } from "lucide-react"
import { useEffect, useState, type ComponentProps } from "react"
import { SelectField } from "@renderer/components/common/Controls"
import { AudioPanel } from "@renderer/components/audio/AudioPanel"
import { clamp } from "@renderer/lib/utils"

type BookAudioPaneProps = Omit<ComponentProps<typeof AudioPanel>, "chapterIndex"> & {
  onBack: () => void
}

export function BookAudioPane({ onBack, ...audioProps }: BookAudioPaneProps) {
  const { book, t } = audioProps
  const chapters = book?.chapters ?? []
  const [chapterIndex, setChapterIndex] = useState(0)

  useEffect(() => {
    setChapterIndex((current) => clamp(current, 0, Math.max(chapters.length - 1, 0)))
  }, [chapters.length])

  const chapterOptions = chapters.map((chapter, index) => ({
    label: chapter.title,
    value: String(index)
  }))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-col gap-3 border-b bg-background/95 px-6 py-4">
        <div className="flex items-center gap-3">
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-sm"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{t("audioDashboard.back")}</span>
          </button>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold leading-tight">{book?.title ?? t("audioDashboard.title")}</h2>
            <p className="truncate text-xs text-muted-foreground">{t("audioDashboard.book.subtitle")}</p>
          </div>
        </div>
        {chapterOptions.length ? (
          <SelectField
            label={t("audioDashboard.book.chapterSelector")}
            options={chapterOptions}
            value={String(clamp(chapterIndex, 0, Math.max(chapterOptions.length - 1, 0)))}
            onChange={(value) => setChapterIndex(Number(value))}
          />
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        <div className="mx-auto w-full max-w-3xl">
          <AudioPanel {...audioProps} chapterIndex={chapterIndex} />
        </div>
      </div>
    </div>
  )
}
