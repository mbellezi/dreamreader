import { describe, expect, it } from "vitest"
import { buildSaveLocatorRequest, type RendererLocator } from "../../src/preload/locator"
import { SaveReadingPositionInputSchema } from "../../src/shared/contracts"

const base = {
  bookId: "book-1",
  chapterId: "chapter-1.xhtml",
  progress: 42,
  updatedAt: "2026-06-06T12:00:00.000Z"
}

function hasUndefined(value: Record<string, unknown>): boolean {
  return Object.values(value).some((item) => item === undefined)
}

describe("buildSaveLocatorRequest", () => {
  it("produces a request the IPC contract accepts in continuous mode", () => {
    // Continuous positions leave pageCount/pageIndex undefined.
    const locator: RendererLocator = {
      ...base,
      anchorParagraphIndex: 4,
      anchorText: "era uma vez",
      anchorTextOffset: 12,
      readingFlow: "continuous",
      scrollProgress: 0.42,
      scrollTop: 1234
    }

    const request = buildSaveLocatorRequest(locator)
    expect(SaveReadingPositionInputSchema.safeParse(request).success).toBe(true)
    expect(hasUndefined(request.locator.text)).toBe(false)
    expect(hasUndefined(request.locator.locations)).toBe(false)
  })

  it("produces a request the IPC contract accepts in paginated mode", () => {
    // Paginated positions leave anchorText/anchorTextOffset and scroll undefined.
    const locator: RendererLocator = {
      ...base,
      anchorParagraphIndex: 7,
      pageCount: 10,
      pageIndex: 3,
      readingFlow: "paginated"
    }

    const request = buildSaveLocatorRequest(locator)
    expect(SaveReadingPositionInputSchema.safeParse(request).success).toBe(true)
    expect(hasUndefined(request.locator.text)).toBe(false)
    expect(hasUndefined(request.locator.locations)).toBe(false)
    expect(request.locator.locations.pageIndex).toBe(3)
    expect(request.locator.text.anchorParagraphIndex).toBe(7)
  })

  it("mirrors progress into progression as a 0..1 fraction", () => {
    const request = buildSaveLocatorRequest({ ...base, progress: 50 })
    expect(request.progression).toBe(0.5)
    expect(request.locator.locations.progression).toBe(0.5)
  })
})
