import { describe, expect, it } from "vitest"
import {
  clampSidebarWidth,
  READER_SIDEBAR_DEFAULT_WIDTH,
  READER_SIDEBAR_MAX_WIDTH,
  READER_SIDEBAR_MIN_WIDTH
} from "../../src/renderer/lib/readerSidebar"

describe("clampSidebarWidth", () => {
  it("keeps a width inside the allowed range", () => {
    expect(clampSidebarWidth(400)).toBe(400)
  })

  it("clamps below the minimum", () => {
    expect(clampSidebarWidth(50)).toBe(READER_SIDEBAR_MIN_WIDTH)
  })

  it("clamps above the maximum", () => {
    expect(clampSidebarWidth(9999)).toBe(READER_SIDEBAR_MAX_WIDTH)
  })

  it("rounds fractional widths", () => {
    expect(clampSidebarWidth(380.6)).toBe(381)
  })

  it("falls back to the default for non-finite input", () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(READER_SIDEBAR_DEFAULT_WIDTH)
  })
})
