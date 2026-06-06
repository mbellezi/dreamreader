export type RendererLocator = {
  anchorParagraphIndex?: number
  anchorText?: string
  anchorTextOffset?: number
  bookId: string
  chapterId: string
  pageCount?: number
  pageIndex?: number
  progress: number
  readingFlow?: string
  scrollProgress?: number
  scrollTop?: number
  updatedAt: string
}

export type SaveLocatorRequest = {
  bookId: string
  locator: {
    href: string
    text: Record<string, unknown>
    locations: Record<string, unknown>
  }
  chapterHref: string
  progression: number
}

// Maps a renderer reading position into the canonical save-locator request.
// Drops undefined-valued keys: the locator's nested text/locations cross IPC as
// a JSON object contract, which rejects undefined values — leaving them in makes
// every save fail validation and the position is silently never persisted.
export function buildSaveLocatorRequest(locator: RendererLocator): SaveLocatorRequest {
  const progression = locator.progress / 100
  return {
    bookId: locator.bookId,
    locator: {
      href: locator.chapterId,
      text: compact({
        anchorParagraphIndex: locator.anchorParagraphIndex,
        anchorText: locator.anchorText,
        anchorTextOffset: locator.anchorTextOffset
      }),
      locations: compact({
        pageCount: locator.pageCount,
        pageIndex: locator.pageIndex,
        progression,
        readingFlow: locator.readingFlow,
        scrollProgress: locator.scrollProgress,
        scrollTop: locator.scrollTop
      })
    },
    chapterHref: locator.chapterId,
    progression
  }
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>
}
