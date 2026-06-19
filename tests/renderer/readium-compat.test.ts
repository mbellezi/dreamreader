import { describe, expect, it } from "vitest"
import { Link, Locator, LocatorLocations } from "@readium/shared"
import {
  enrichReadiumLocatorProgression,
  ensureReadiumPositionForLink,
  goToReadiumLocator,
  normalizeReadiumLocator,
  readiumLocatorProgress,
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

  it("strips undefined values from serialized locators before IPC", () => {
    const locator = new Locator({
      href: "dreamreader://publication/book/resource/OEBPS/chapter.xhtml",
      type: "application/xhtml+xml",
      locations: new LocatorLocations({
        progression: 0.25,
        otherLocations: new Map([
          ["cssSelector", undefined],
          ["partialCfi", "/4/2"]
        ])
      })
    })

    const serialized = serializeReadiumLocator(locator)

    expect(hasUndefined(serialized)).toBe(false)
    expect(serialized).toMatchObject({
      locations: {
        partialCfi: "/4/2",
        progression: 0.25
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

  it("reads saved publication progression before resource progression", () => {
    expect(readiumLocatorProgress({
      href: "dreamreader://publication/book/resource/OEBPS/chapter.xhtml",
      locations: {
        progression: 0.9,
        totalProgression: 0.42
      }
    })).toBe(0.42)
  })

  it("interpolates publication progression within the current reading-order item", () => {
    const locator = new Locator({
      href: "dreamreader://publication/book/resource/OEBPS/chapter-2.xhtml",
      type: "application/xhtml+xml",
      locations: new LocatorLocations({
        position: 2,
        progression: 0.5,
        totalProgression: 0.25
      })
    })
    const positions = [
      new Locator({
        href: "dreamreader://publication/book/resource/OEBPS/chapter-1.xhtml",
        type: "application/xhtml+xml",
        locations: new LocatorLocations({
          position: 1,
          progression: 0,
          totalProgression: 0
        })
      }),
      new Locator({
        href: "dreamreader://publication/book/resource/OEBPS/chapter-2.xhtml",
        type: "application/xhtml+xml",
        locations: new LocatorLocations({
          position: 2,
          progression: 0,
          totalProgression: 0.25
        })
      }),
      new Locator({
        href: "dreamreader://publication/book/resource/OEBPS/chapter-3.xhtml",
        type: "application/xhtml+xml",
        locations: new LocatorLocations({
          position: 3,
          progression: 0,
          totalProgression: 0.5
        })
      })
    ]

    const enriched = enrichReadiumLocatorProgression(locator, positions)

    expect(enriched.locations.totalProgression).toBe(0.375)
  })

  it("navigates to serialized locators through the active Readium navigator", async () => {
    const calls: Locator[] = []
    const navigator: Parameters<typeof goToReadiumLocator>[0] = {
      go(locator, _animated, cb) {
        calls.push(locator)
        cb(true)
      }
    }

    await expect(goToReadiumLocator(navigator, {
      href: "dreamreader://publication/book/resource/OEBPS/chapter.xhtml",
      type: "application/xhtml+xml",
      locations: { progression: 0.5 }
    })).resolves.toBe(true)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toBeInstanceOf(Locator)
    expect(calls[0]?.locations).toBeInstanceOf(LocatorLocations)
  })
})

function hasUndefined(value: unknown): boolean {
  if (value === undefined) {
    return true
  }
  if (Array.isArray(value)) {
    return value.some(hasUndefined)
  }
  if (value && typeof value === "object") {
    return Object.values(value).some(hasUndefined)
  }
  return false
}
