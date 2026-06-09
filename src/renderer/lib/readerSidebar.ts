// Reader sidebar (inspector) layout chrome. Width/collapsed state is pure view
// chrome, so it lives in localStorage instead of the reader-preferences contract
// — no DB round-trip or migration for something that never leaves the renderer.

const STORAGE_KEY = "dreamreader.reader.sidebar"

export const READER_SIDEBAR_MIN_WIDTH = 280
export const READER_SIDEBAR_MAX_WIDTH = 560
export const READER_SIDEBAR_DEFAULT_WIDTH = 340

export type ReaderSidebarState = {
  width: number
  collapsed: boolean
}

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return READER_SIDEBAR_DEFAULT_WIDTH
  }
  return Math.round(Math.min(Math.max(width, READER_SIDEBAR_MIN_WIDTH), READER_SIDEBAR_MAX_WIDTH))
}

export function loadReaderSidebarState(): ReaderSidebarState {
  const fallback: ReaderSidebarState = { width: READER_SIDEBAR_DEFAULT_WIDTH, collapsed: false }
  if (typeof window === "undefined" || !window.localStorage) {
    return fallback
  }

  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (!stored) {
    return fallback
  }

  try {
    const parsed = JSON.parse(stored) as Partial<ReaderSidebarState>
    return {
      width: clampSidebarWidth(Number(parsed.width)),
      collapsed: Boolean(parsed.collapsed)
    }
  } catch {
    return fallback
  }
}

export function saveReaderSidebarState(state: ReaderSidebarState): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}
