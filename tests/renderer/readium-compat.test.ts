import { describe, expect, it } from "vitest"
import { Link, Locator, LocatorLocations } from "@readium/shared"
import {
  ensureReadiumPositionForLink,
  normalizeReadiumLocator,
  serializeReadiumLocator
} from "../../src/renderer/lib/readium-compat"

describe("readium compatibility helpers", () => {
  it("normalizes Thorium-created locators with plain location objects", () => {
    const locator = new Locator({
      href: "dreamreader://publication/book/resource/OEBPS/cover.xhtml",
      type: "application/xhtml+xml",
      locations: { position: 1, progression: 0 } as LocatorLocations
    })

    expect(() => locator.serialize()).toThrow(/serialize/)

    const normalized = normalizeReadiumLocator(locator)
    expect(normalized.locations).toBeInstanceOf(LocatorLocations)
    expect(serializeReadiumLocator(locator)).toMatchObject({
      href: "dreamreader://publication/book/resource/OEBPS/cover.xhtml",
      type: "application/xhtml+xml",
      locations: {
        position: 1,
        progression: 0
      }
    })
  })

  it("keeps TOC locators navigable even when the link has no media type", () => {
    const locator = new Link({
      href: "dreamreader://publication/book/resource/OEBPS/chapter.xhtml#start"
    }).locator

    const normalized = normalizeReadiumLocator(locator)
    expect(normalized.href).toBe("dreamreader://publication/book/resource/OEBPS/chapter.xhtml")
    expect(normalized.type).toBe("")
    expect(normalized.locations.fragments).toEqual(["start"])
    expect(() => normalized.serialize()).not.toThrow()
  })

  it("adds a fallback position when Thorium asks for a reading-order link missing from positions", () => {
    const cover = new Locator({
      href: "dreamreader://publication/book/resource/OEBPS/cover.xhtml",
      type: "application/xhtml+xml",
      locations: { position: 1 } as LocatorLocations
    })
    const chapter = new Link({
      href: "dreamreader://publication/book/resource/OEBPS/chapter.xhtml",
      type: "application/xhtml+xml",
      title: "Chapter"
    })

    const positions = ensureReadiumPositionForLink([cover], chapter)

    expect(positions).toHaveLength(2)
    expect(positions[0]?.locations).toBeInstanceOf(LocatorLocations)
    expect(positions[1]).toMatchObject({
      href: "dreamreader://publication/book/resource/OEBPS/chapter.xhtml",
      type: "application/xhtml+xml",
      title: "Chapter"
    })
    expect(positions[1]?.locations).toBeInstanceOf(LocatorLocations)
  })
})
