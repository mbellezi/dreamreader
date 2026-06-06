import type { ReaderLocator } from "@renderer/types"
import { columnIndexForOffset } from "@renderer/lib/pagination"
import { clamp } from "@renderer/lib/utils"

// A layout-independent reading anchor: the paragraph at the top-left of the
// current page, plus how many columns into that paragraph the page starts.
// Survives reflow (resize / font change) so the reader stays on the same text.
export type ColumnAnchor = {
  paragraphIndex: number
  columnWithin: number
}

export type PageLayout = {
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

export function readVisibleTextAnchor(article: HTMLElement, topInset: number): { paragraphIndex: number; text: string; textOffset: number } | undefined {
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

export function restoreToTextAnchor(article: HTMLElement, locator: ReaderLocator, topInset: number): boolean {
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
export function applyColumnStyles(content: HTMLElement, layout: PageLayout): void {
  content.style.height = `${layout.pageHeight}px`
  content.style.width = `${layout.clipWidth}px`
  content.style.columnWidth = `${layout.columnWidth}px`
  content.style.columnGap = `${layout.columnGap}px`
  content.style.columnFill = "auto"
}

// Which column (zero-based) an element's first fragment sits in. Measured
// relative to the content box so the current translateX cancels out, giving the
// element's intrinsic column even while the track is shifted for paging.
export function columnIndexOfElement(content: HTMLElement, element: HTMLElement, layout: PageLayout): number {
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
export function anchorForPage(content: HTMLElement, pageIndex: number, layout: PageLayout): ColumnAnchor | undefined {
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

export function closestParagraphElement(node: Node, article: HTMLElement): HTMLElement | null {
  const element = node.nodeType === Node.ELEMENT_NODE
    ? (node as HTMLElement)
    : node.parentNode instanceof HTMLElement
      ? node.parentNode
      : null
  const paragraph = element?.closest<HTMLElement>("[data-paragraph-index]")
  return paragraph && article.contains(paragraph) ? paragraph : null
}

export function textOffsetWithin(container: HTMLElement, targetNode: Node, targetOffset: number): number {
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
