// Pure geometry for horizontal (CSS multi-column) pagination.
//
// The reader lays text out into equal-width columns that flow left-to-right
// (column-fill: auto + a fixed page height). A "page" shows `columnsPerPage`
// columns; paging advances by translating the column track horizontally by an
// exact multiple of the column step, so the browser guarantees no line is ever
// split and no word is repeated or skipped between pages.
//
// These helpers are deterministic and DOM-free so they can be unit-tested: they
// depend only on measured widths, never on prior navigation.

// Distance from the left edge of one column to the left edge of the next.
export function columnStep(columnWidth: number, columnGap: number): number {
  return Math.max(columnWidth + columnGap, 1)
}

// Width of the visible page: the columns the reader sees, excluding the trailing
// inter-column gap that is hidden by the viewport clip.
export function pageClipWidth(columnWidth: number, columnGap: number, columnsPerPage: number): number {
  return columnsPerPage * columnWidth + (columnsPerPage - 1) * columnGap
}

// Number of columns the laid-out content spans, recovered from its scrollWidth.
// scrollWidth = n*columnWidth + (n-1)*columnGap = n*step - columnGap, so
// n = (scrollWidth + columnGap) / step.
export function totalColumns(scrollWidth: number, columnWidth: number, columnGap: number): number {
  const step = columnStep(columnWidth, columnGap)
  return Math.max(1, Math.round((scrollWidth + columnGap) / step))
}

// Number of pages, each showing `columnsPerPage` columns.
export function pageCountForColumns(columns: number, columnsPerPage: number): number {
  return Math.max(1, Math.ceil(Math.max(columns, 1) / Math.max(columnsPerPage, 1)))
}

// The page that contains the given (zero-based) column index.
export function pageIndexForColumn(column: number, columnsPerPage: number): number {
  return Math.floor(Math.max(column, 0) / Math.max(columnsPerPage, 1))
}

// translateX magnitude (px) that brings the given page's first column to the
// left edge of the viewport. Always an exact multiple of the column step, which
// is what keeps paging gapless and free of overlap.
export function pageTranslateX(
  pageIndex: number,
  columnsPerPage: number,
  columnWidth: number,
  columnGap: number
): number {
  return Math.max(0, pageIndex) * columnsPerPage * columnStep(columnWidth, columnGap)
}

export function clampPageIndex(pageIndex: number, pageCount: number): number {
  if (pageCount <= 1) {
    return 0
  }
  return Math.min(Math.max(pageIndex, 0), pageCount - 1)
}

// Per-chapter reading progress for a page. Reaches 100% only on the last page,
// and is never 100% on an earlier page of a multi-page chapter — this is what
// prevents the "marks 100% while still near the start" regression, regardless of
// how tall the window is.
export function pageProgress(pageIndex: number, pageCount: number): number {
  if (pageCount <= 1) {
    return 100
  }
  const safeIndex = clampPageIndex(pageIndex, pageCount)
  const value = Math.round(((safeIndex + 1) / pageCount) * 100)
  return Math.min(100, Math.max(0, value))
}
