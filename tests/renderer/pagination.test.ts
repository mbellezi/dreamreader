import { describe, expect, it } from "vitest"
import {
  clampPageIndex,
  columnIndexForOffset,
  columnStep,
  pageClipWidth,
  pageCountForColumns,
  pageIndexForColumn,
  pageProgress,
  pageTranslateX,
  totalColumns,
} from "../../src/renderer/lib/pagination"

const COLUMN_WIDTH = 600
const COLUMN_GAP = 64
const STEP = COLUMN_WIDTH + COLUMN_GAP // 664

// scrollWidth a column track of `n` columns would report for the layout above.
function scrollWidthFor(columns: number): number {
  return columns * COLUMN_WIDTH + (columns - 1) * COLUMN_GAP
}

describe("columnStep", () => {
  it("is the column width plus the gap", () => {
    expect(columnStep(COLUMN_WIDTH, COLUMN_GAP)).toBe(STEP)
  })

  it("never collapses below 1px", () => {
    expect(columnStep(0, 0)).toBe(1)
  })
})

describe("pageClipWidth", () => {
  it("equals the column width for a single-column page (no visible gap)", () => {
    expect(pageClipWidth(COLUMN_WIDTH, COLUMN_GAP, 1)).toBe(COLUMN_WIDTH)
  })

  it("includes exactly one inter-column gap for a two-column page", () => {
    expect(pageClipWidth(COLUMN_WIDTH, COLUMN_GAP, 2)).toBe(2 * COLUMN_WIDTH + COLUMN_GAP)
  })
})

describe("totalColumns", () => {
  it("recovers the column count from a measured scrollWidth", () => {
    for (let columns = 1; columns <= 25; columns += 1) {
      expect(totalColumns(scrollWidthFor(columns), COLUMN_WIDTH, COLUMN_GAP)).toBe(columns)
    }
  })

  it("is at least one column even for empty content", () => {
    expect(totalColumns(0, COLUMN_WIDTH, COLUMN_GAP)).toBe(1)
  })

  it("tolerates sub-pixel rounding in the measured width", () => {
    expect(totalColumns(scrollWidthFor(7) + 0.4, COLUMN_WIDTH, COLUMN_GAP)).toBe(7)
    expect(totalColumns(scrollWidthFor(7) - 0.4, COLUMN_WIDTH, COLUMN_GAP)).toBe(7)
  })
})

describe("pageCountForColumns", () => {
  it("packs columns into pages of the given width, rounding up", () => {
    expect(pageCountForColumns(1, 1)).toBe(1)
    expect(pageCountForColumns(5, 1)).toBe(5)
    expect(pageCountForColumns(5, 2)).toBe(3)
    expect(pageCountForColumns(6, 2)).toBe(3)
    expect(pageCountForColumns(7, 2)).toBe(4)
  })

  it("always reports at least one page", () => {
    expect(pageCountForColumns(0, 2)).toBe(1)
  })
})

describe("pageIndexForColumn", () => {
  it("maps a column to the page that contains it", () => {
    // Two columns per page: columns 0,1 -> page 0; 2,3 -> page 1; 4 -> page 2.
    expect(pageIndexForColumn(0, 2)).toBe(0)
    expect(pageIndexForColumn(1, 2)).toBe(0)
    expect(pageIndexForColumn(2, 2)).toBe(1)
    expect(pageIndexForColumn(3, 2)).toBe(1)
    expect(pageIndexForColumn(4, 2)).toBe(2)
  })

  it("is the identity for single-column pages", () => {
    expect(pageIndexForColumn(7, 1)).toBe(7)
  })
})

describe("columnIndexForOffset", () => {
  it("keeps inline fragments in their column even when they start past the halfway point", () => {
    expect(columnIndexForOffset(COLUMN_WIDTH - 12, COLUMN_WIDTH, COLUMN_GAP)).toBe(0)
    expect(columnIndexForOffset(STEP + COLUMN_WIDTH - 12, COLUMN_WIDTH, COLUMN_GAP)).toBe(1)
    expect(pageIndexForColumn(columnIndexForOffset(STEP + COLUMN_WIDTH - 12, COLUMN_WIDTH, COLUMN_GAP), 2)).toBe(0)
  })

  it("tolerates a sub-pixel measurement just before the next column starts", () => {
    expect(columnIndexForOffset(STEP - 0.25, COLUMN_WIDTH, COLUMN_GAP)).toBe(1)
  })
})

describe("pageTranslateX", () => {
  it("is zero on the first page", () => {
    expect(pageTranslateX(0, 1, COLUMN_WIDTH, COLUMN_GAP)).toBe(0)
  })

  it("advances by exactly one column step per single-column page", () => {
    expect(pageTranslateX(1, 1, COLUMN_WIDTH, COLUMN_GAP)).toBe(STEP)
    expect(pageTranslateX(3, 1, COLUMN_WIDTH, COLUMN_GAP)).toBe(3 * STEP)
  })

  it("advances by two column steps per two-column page", () => {
    expect(pageTranslateX(2, 2, COLUMN_WIDTH, COLUMN_GAP)).toBe(2 * 2 * STEP)
  })

  it("lands a column exactly at the viewport's left edge (no drift across pages)", () => {
    // The first column shown on page p must sit at offset p*columnsPerPage*step,
    // i.e. the translate cancels that column's intrinsic position to zero.
    const columnsPerPage = 2
    for (let page = 0; page < 10; page += 1) {
      const firstColumnOnPage = page * columnsPerPage
      const intrinsicLeft = firstColumnOnPage * STEP
      const translate = pageTranslateX(page, columnsPerPage, COLUMN_WIDTH, COLUMN_GAP)
      expect(intrinsicLeft - translate).toBe(0)
    }
  })
})

describe("clampPageIndex", () => {
  it("keeps an index inside the valid range", () => {
    expect(clampPageIndex(-3, 5)).toBe(0)
    expect(clampPageIndex(2, 5)).toBe(2)
    expect(clampPageIndex(99, 5)).toBe(4)
  })

  it("collapses to the only page when there is a single page", () => {
    expect(clampPageIndex(4, 1)).toBe(0)
  })
})

describe("pageProgress", () => {
  it("reports 100% for a chapter that fits on one page", () => {
    expect(pageProgress(0, 1)).toBe(100)
  })

  it("never reports 100% before the last page of a multi-page chapter", () => {
    const pageCount = 8
    for (let index = 0; index < pageCount - 1; index += 1) {
      expect(pageProgress(index, pageCount)).toBeLessThan(100)
    }
  })

  it("reaches 100% only on the last page", () => {
    const pageCount = 8
    expect(pageProgress(pageCount - 1, pageCount)).toBe(100)
  })

  it("increases monotonically from the first to the last page", () => {
    const pageCount = 12
    let previous = -1
    for (let index = 0; index < pageCount; index += 1) {
      const value = pageProgress(index, pageCount)
      expect(value).toBeGreaterThan(previous)
      previous = value
    }
  })

  it("stays correct when the viewport grows and the chapter needs fewer pages", () => {
    // Same reading column, two layouts: a short window (more pages) and a tall
    // window (fewer pages). Progress must not jump to 100% in the tall layout
    // unless the reader is genuinely on the last page.
    const shortPages = 10
    const tallPages = 4
    // Reader is two-thirds through the chapter in both layouts.
    const shortIndex = Math.round((shortPages - 1) * (2 / 3))
    const tallIndex = Math.round((tallPages - 1) * (2 / 3))
    expect(pageProgress(shortIndex, shortPages)).toBeLessThan(100)
    expect(pageProgress(tallIndex, tallPages)).toBeLessThan(100)
  })
})
