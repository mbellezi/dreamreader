import { EpubNavigator } from "@readium/navigator"
import { Link, Locator, LocatorLocations, LocatorText } from "@readium/shared"

const epubNavigationPatchKey = "__dreamreaderEpubNavigationPatch"

type EpubNavigatorPrototype = {
  [epubNavigationPatchKey]?: boolean
  go(this: EpubNavigatorInternals, locator: Locator, animated: boolean, cb: (ok: boolean) => void): void
  load(this: EpubNavigatorInternals): Promise<unknown>
}

type EpubNavigatorInternals = {
  currentLocation?: Locator
  positions?: Locator[]
  pub?: {
    manifest?: {
      locatorFromLink(link: Link): Locator | undefined
    }
    readingOrder?: {
      findIndexWithHref(href: string): number
      findWithHref(href: string): Link | undefined
    }
  }
}

export function installReadiumEpubNavigationPatch(): void {
  const prototype = EpubNavigator.prototype as unknown as EpubNavigatorPrototype
  if (prototype[epubNavigationPatchKey]) {
    return
  }

  const originalLoad = prototype.load
  const originalGo = prototype.go

  prototype.load = async function patchedLoad(this: EpubNavigatorInternals) {
    normalizeNavigatorPositions(this)
    const result = await originalLoad.call(this)
    normalizeNavigatorPositions(this)
    if (this.currentLocation) {
      this.currentLocation = normalizeReadiumLocator(this.currentLocation)
    }
    return result
  }

  prototype.go = function patchedGo(
    this: EpubNavigatorInternals,
    locator: Locator,
    animated: boolean,
    cb: (ok: boolean) => void
  ) {
    const normalizedLocator = normalizeReadiumLocator(locator)
    normalizeNavigatorPositions(this)

    const link = this.pub?.readingOrder?.findWithHref(normalizedLocator.href.split("#")[0])
    if (link) {
      const index = this.pub?.readingOrder?.findIndexWithHref(link.href)
      const fallback = this.pub?.manifest?.locatorFromLink(link) ?? readiumPositionLocatorFromLink(link, index)
      this.positions = ensureReadiumPositionForLink(this.positions, link, fallback)
    }

    return originalGo.call(this, normalizedLocator, animated, cb)
  }

  Object.defineProperty(prototype, epubNavigationPatchKey, {
    configurable: false,
    enumerable: false,
    value: true
  })
}

export function serializeReadiumLocator(locator: Locator): Record<string, unknown> {
  return normalizeReadiumLocator(locator).serialize() as Record<string, unknown>
}

export function normalizeReadiumLocator(locator: Locator): Locator {
  return new Locator({
    href: locator.href,
    type: locator.type,
    title: locator.title,
    locations: normalizeReadiumLocations(locator.locations),
    text: normalizeReadiumText(locator.text)
  })
}

export function ensureReadiumPositionForLink(
  positions: Locator[] | undefined,
  link: Link,
  fallback: Locator = readiumPositionLocatorFromLink(link)
): Locator[] {
  const normalizedPositions = (positions ?? []).map(normalizeReadiumLocator)
  return normalizedPositions.some((position) => position.href === link.href)
    ? normalizedPositions
    : [...normalizedPositions, normalizeReadiumLocator(fallback)]
}

function normalizeNavigatorPositions(navigator: EpubNavigatorInternals): void {
  if (Array.isArray(navigator.positions)) {
    navigator.positions = navigator.positions.map(normalizeReadiumLocator)
  }
}

function normalizeReadiumLocations(locations: Locator["locations"]): LocatorLocations {
  return locations instanceof LocatorLocations
    ? locations
    : LocatorLocations.deserialize(locations) ?? new LocatorLocations({})
}

function normalizeReadiumText(text: Locator["text"]): LocatorText | undefined {
  return !text || text instanceof LocatorText
    ? text
    : LocatorText.deserialize(text)
}

function readiumPositionLocatorFromLink(link: Link, readingOrderIndex = -1): Locator {
  return new Locator({
    href: link.href,
    type: link.type ?? "application/xhtml+xml",
    title: link.title,
    locations: new LocatorLocations({
      position: readingOrderIndex >= 0 ? readingOrderIndex + 1 : undefined,
      progression: 0
    })
  })
}
