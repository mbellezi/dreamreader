import {
  BookOpen,
  Check,
  Columns2,
  Download,
  Highlighter,
  List,
  ListFilter,
  PanelRight,
  PanelRightClose,
  SlidersHorizontal,
  Star,
  StickyNote,
  TextAlignJustify,
  TextAlignStart,
  Trash2,
  Type
} from "lucide-react"
import { useMemo, useState } from "react"
import { IconToggle, SegmentButton, SliderField } from "@renderer/components/common/Controls"
import type { InspectorTab, ReaderPreferenceChangeHandler, TranslationFn } from "@renderer/app/types"
import { fontFamilyOptions, swatchClasses, themeOptions, themePreviewClasses } from "@renderer/lib/readerOptions"
import { cn } from "@renderer/lib/utils"
import type { Annotation, BookDetails, ReaderPreferences } from "@renderer/types"

type AnnotationFilter = "all" | "note" | "favorite"

export function InspectorPane({
  activeTab,
  activeAnnotationId,
  annotations,
  book,
  chapterIndex,
  preferences,
  t,
  onChangePreference,
  onChangeTab,
  onCollapse,
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
  preferences: ReaderPreferences
  t: TranslationFn
  onChangePreference: ReaderPreferenceChangeHandler
  onChangeTab: (tab: InspectorTab) => void
  onCollapse: () => void
  onDeleteAnnotation: (annotationId: string) => void
  onExportNotes: () => void
  onJumpToAnnotation: (annotation: Annotation) => void
  onJumpToChapter: (index: number) => void
}) {
  const [annotationFilter, setAnnotationFilter] = useState<AnnotationFilter>("all")
  const filteredAnnotations = useMemo(
    () => annotationFilter === "all" ? annotations : annotations.filter((annotation) => annotation.kind === annotationFilter),
    [annotationFilter, annotations]
  )

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden border-l bg-sidebar">
      <div className="flex shrink-0 items-center gap-1 border-b p-2">
        <div className="grid flex-1 grid-cols-3 gap-1">
          <IconToggle active={activeTab === "summary"} icon={PanelRight} label={t("reader.summary")} onClick={() => onChangeTab("summary")} />
          <IconToggle active={activeTab === "annotations"} icon={Highlighter} label={t("reader.annotations")} onClick={() => onChangeTab("annotations")} />
          <IconToggle active={activeTab === "preferences"} icon={SlidersHorizontal} label={t("reader.preferences")} onClick={() => onChangeTab("preferences")} />
        </div>
        <button
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-card hover:text-foreground"
          title={t("reader.collapseSidebar")}
          aria-label={t("reader.collapseSidebar")}
          onClick={onCollapse}
        >
          <PanelRightClose className="h-4 w-4" aria-hidden="true" />
        </button>
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
              <div className="grid grid-cols-3 gap-1 rounded-md border bg-background p-1">
                {[
                  { value: "all" as const, icon: ListFilter, label: t("reader.annotationFilter.all") },
                  { value: "note" as const, icon: StickyNote, label: t("reader.annotationFilter.notes") },
                  { value: "favorite" as const, icon: Star, label: t("reader.annotationFilter.favorites") }
                ].map((filter) => {
                  const Icon = filter.icon
                  return (
                    <button
                      key={filter.value}
                      className={cn(
                        "inline-flex h-8 min-w-0 items-center justify-center gap-1 rounded-sm px-2 text-xs text-muted-foreground",
                        annotationFilter === filter.value && "bg-card text-foreground shadow-sm"
                      )}
                      title={filter.label}
                      aria-pressed={annotationFilter === filter.value}
                      onClick={() => setAnnotationFilter(filter.value)}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">{filter.label}</span>
                    </button>
                  )
                })}
              </div>

              <div className="space-y-2">
                {filteredAnnotations.length ? (
                  filteredAnnotations.map((annotation) => {
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
                  <p className="rounded-md border bg-card p-3 text-sm text-muted-foreground">{t(annotations.length ? "reader.emptyFilteredAnnotations" : "reader.emptyAnnotations")}</p>
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
