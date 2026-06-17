import {
  Bookmark,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Highlighter,
  Maximize2,
  MessageSquareText,
  Minimize2,
  Trash2,
  Undo2
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactElement } from "react"
import type { TranslationFn } from "@renderer/app/types"
import {
  anchorForPage,
  applyColumnStyles,
  closestParagraphElement,
  columnIndexOfElement,
  readVisibleTextAnchor,
  restoreToTextAnchor,
  textOffsetWithin,
  type ColumnAnchor,
  type PageLayout
} from "@renderer/components/reader/readerDom"
import { findAnnotationRanges, findOverlappingAnnotations, resolveAnnotationPlacements, type AnnotationPlacement } from "@renderer/lib/annotations"
import {
  clampPageIndex,
  pageClipWidth,
  pageCountForColumns,
  pageIndexForColumn,
  pageProgress,
  pageTranslateX,
  totalColumns
} from "@renderer/lib/pagination"
import { colorOptions, fontStackByFamily, inlineHighlightClasses, swatchClasses } from "@renderer/lib/readerOptions"
import { clamp, cn } from "@renderer/lib/utils"
import type {
  Annotation,
  AnnotationKind,
  BookDetails,
  HighlightColor,
  ReaderLocator,
  ReaderPreferences
} from "@renderer/types"

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

type ReaderDisplayBlock =
  | {
      blockIndex: number
      paragraphIndex: number
      text: string
      type: "paragraph"
    }
  | {
      alt?: string
      blockIndex: number
      src: string
      type: "image"
    }

type CreateAnnotationDraft = {
  anchorParagraphIndex?: number
  anchorTextOffset?: number
  chapterId: string
  color: HighlightColor
  excerpt: string
  kind: AnnotationKind
  note: string
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

export function ReaderPane({
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
  t: TranslationFn
  onCreateAnnotation: (draft: CreateAnnotationDraft) => Promise<void> | void
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
  const readerBlocks = useMemo(() => buildReaderDisplayBlocks(chapter), [chapter])
  const paragraphs = useMemo(() => readerBlocks.filter(isParagraphBlock).map((block) => block.text), [readerBlocks])
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
                    {readerBlocks.map((block) =>
                      block.type === "paragraph" ? (
                        <p
                          key={`${chapter.id}-${block.blockIndex}`}
                          data-paragraph-index={block.paragraphIndex}
                          data-readable-block
                          style={{ marginTop: block.blockIndex === 0 ? 0 : paginatedParagraphSpacing }}
                        >
                          {renderParagraphWithAnnotations(block.text, block.paragraphIndex, chapterAnnotations, annotationPlacements, activeAnnotationId, openAnnotationMenu)}
                        </p>
                      ) : (
                        <ReaderImageBlock
                          key={`${chapter.id}-${block.blockIndex}`}
                          block={block}
                          marginTop={block.blockIndex === 0 ? 0 : paginatedParagraphSpacing}
                          maxHeight={pageLayout.pageHeight ? Math.max(160, pageLayout.pageHeight * 0.82) : undefined}
                        />
                      )
                    )}
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
                    {readerBlocks.map((block) =>
                      block.type === "paragraph" ? (
                        <p
                          key={`${chapter.id}-${block.blockIndex}`}
                          className="break-inside-avoid"
                          data-paragraph-index={block.paragraphIndex}
                          data-readable-block
                          style={{ marginTop: block.blockIndex === 0 ? 0 : `${preferences.paragraphSpacing}em` }}
                        >
                          {renderParagraphWithAnnotations(block.text, block.paragraphIndex, chapterAnnotations, annotationPlacements, activeAnnotationId, openAnnotationMenu)}
                        </p>
                      ) : (
                        <ReaderImageBlock
                          key={`${chapter.id}-${block.blockIndex}`}
                          block={block}
                          marginTop={block.blockIndex === 0 ? 0 : `${preferences.paragraphSpacing}em`}
                        />
                      )
                    )}
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

function buildReaderDisplayBlocks(chapter: BookDetails["chapters"][number] | null): ReaderDisplayBlock[] {
  const sourceBlocks = chapter?.blocks?.length
    ? chapter.blocks
    : chapter?.text
      .split(/\n{2,}/)
      .map((paragraph) => ({ type: "paragraph" as const, text: paragraph.trim() }))
      .filter((block) => block.text) ?? []
  let paragraphIndex = 0

  return sourceBlocks.map((block, blockIndex) => {
    if (block.type === "image") {
      return { ...block, blockIndex }
    }
    return {
      ...block,
      blockIndex,
      paragraphIndex: paragraphIndex++
    }
  })
}

function isParagraphBlock(block: ReaderDisplayBlock): block is Extract<ReaderDisplayBlock, { type: "paragraph" }> {
  return block.type === "paragraph"
}

function ReaderImageBlock({
  block,
  marginTop,
  maxHeight
}: {
  block: Extract<ReaderDisplayBlock, { type: "image" }>
  marginTop: number | string
  maxHeight?: number
}) {
  return (
    <figure className="break-inside-avoid" data-readable-block style={{ breakInside: "avoid", marginTop }}>
      <img
        alt={block.alt ?? ""}
        className="mx-auto block max-w-full rounded-sm object-contain"
        loading="lazy"
        src={block.src}
        style={{ maxHeight }}
      />
    </figure>
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
  t: TranslationFn
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
  t: TranslationFn
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
