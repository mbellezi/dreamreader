import { EpubNavigator } from "@readium/navigator"
import type { BasicTextSelection } from "@readium/navigator-html-injectables"
import { Link, Locator, LocatorLocations, LocatorText } from "@readium/shared"

const epubNavigationPatchKey = "__dreamreaderEpubNavigationPatch"
const epubPositionProgressionBridgeKey = "__dreamreaderPositionProgressionBridge"
const epubSelectionBridgeKey = "__dreamreaderTextSelectionBridge"

export type ReadiumTextSelectionHandler = (
  selection: BasicTextSelection,
  navigator: ReadiumEpubNavigator
) => void

const textSelectionHandlers = new Set<ReadiumTextSelectionHandler>()
const navigatorHandlers = new Set<(navigator: EpubNavigatorInternals | null) => void>()
let activeNavigator: EpubNavigatorInternals | null = null

type EpubNavigatorPrototype = {
  [epubNavigationPatchKey]?: boolean
  go(this: EpubNavigatorInternals, locator: Locator, animated: boolean, cb: (ok: boolean) => void): void
  load(this: EpubNavigatorInternals): Promise<unknown>
  destroy(this: EpubNavigatorInternals): Promise<unknown>
}

export type ReadiumEpubNavigator = EpubNavigatorInternals
export type ReadiumDecoration = {
  id: string
  locator: Locator
  style: {
    type?: "highlight" | "underline" | "outline" | "textColor" | "mask"
    tint?: string
    isActive?: boolean
    enforceContrast?: boolean
  }
  extras?: Record<string, unknown>
}
export type ReadiumDecorationObserver = {
  onDecorationActivated(event: {
    decoration: ReadiumDecoration
    group: string
    point?: { x: number; y: number }
    rect?: { top: number; left: number; width: number; height: number }
  }): boolean
}

type EpubNavigatorInternals = {
  [epubSelectionBridgeKey]?: boolean
  [epubPositionProgressionBridgeKey]?: boolean
  currentLocation?: Locator
  go(locator: Locator, animated: boolean, cb: (ok: boolean) => void): void
  listeners?: {
    positionChanged?: (locator: Locator) => void
    textSelected?: (selection: BasicTextSelection) => void
  }
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
  _cframes?: Array<{
    iframe?: HTMLIFrameElement
  } | undefined>
  applyDecorations?(decorations: ReadiumDecoration[], group: string): void
  registerDecorationObserver?(group: string, observer: ReadiumDecorationObserver): void
  unregisterDecorationObserver?(observer: ReadiumDecorationObserver): void
}

export function installReadiumEpubNavigationPatch(): void {
  const prototype = EpubNavigator.prototype as unknown as EpubNavigatorPrototype
  if (prototype[epubNavigationPatchKey]) {
    return
  }

  const originalLoad = prototype.load
  const originalGo = prototype.go
  const originalDestroy = prototype.destroy

  prototype.load = async function patchedLoad(this: EpubNavigatorInternals) {
    installPositionProgressionBridge(this)
    installTextSelectionBridge(this)
    normalizeNavigatorPositions(this)
    const result = await originalLoad.call(this)
    normalizeNavigatorPositions(this)
    if (this.currentLocation) {
      this.currentLocation = normalizeReadiumLocator(this.currentLocation)
    }
    activeNavigator = this
    notifyNavigatorHandlers(this)
    return result
  }

  prototype.destroy = async function patchedDestroy(this: EpubNavigatorInternals) {
    if (activeNavigator === this) {
      activeNavigator = null
      notifyNavigatorHandlers(null)
    }
    return originalDestroy.call(this)
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

export function subscribeReadiumTextSelection(handler: ReadiumTextSelectionHandler): () => void {
  textSelectionHandlers.add(handler)
  return () => {
    textSelectionHandlers.delete(handler)
  }
}

export function subscribeReadiumEpubNavigator(handler: (navigator: EpubNavigatorInternals | null) => void): () => void {
  navigatorHandlers.add(handler)
  handler(activeNavigator)
  return () => {
    navigatorHandlers.delete(handler)
  }
}

export function serializeReadiumLocator(locator: Locator): Record<string, unknown> {
  return stripUndefinedValues(normalizeReadiumLocator(locator).serialize()) as Record<string, unknown>
}

export function goToReadiumLocator(navigator: EpubNavigatorInternals, input: Locator | Record<string, unknown>): Promise<boolean> {
  const locator = input instanceof Locator ? input : Locator.deserialize(input)
  if (!locator) {
    return Promise.resolve(false)
  }

  return new Promise((resolve) => {
    navigator.go(normalizeReadiumLocator(locator), false, resolve)
  })
}

export function readiumLocatorProgress(locator: Locator | Record<string, unknown> | undefined): number {
  const serialized = locator instanceof Locator ? serializeReadiumLocator(locator) : locator
  const locations = serialized?.locations && typeof serialized.locations === "object" && !Array.isArray(serialized.locations)
    ? serialized.locations as Record<string, unknown>
    : {}
  return normalizedProgress(locations.totalProgression ?? locations.progression)
}

export function serializeReadiumTextSelection(
  selection: BasicTextSelection,
  navigator: EpubNavigatorInternals
): Record<string, unknown> | null {
  const baseLocator = selection.locator ?? navigator.currentLocation
  if (!baseLocator) {
    return null
  }

  const normalizedLocator = normalizeReadiumLocator(baseLocator)
  const range = findSelectionRange(selection, navigator)
  const context = range ? textContextFromRange(range, selection.text) : undefined

  return stripUndefinedValues(normalizeReadiumLocator(new Locator({
    href: normalizedLocator.href,
    type: normalizedLocator.type,
    title: normalizedLocator.title,
    locations: normalizedLocator.locations,
    text: new LocatorText({
      highlight: selection.text,
      before: context?.before,
      after: context?.after
    })
  })).serialize()) as Record<string, unknown>
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

export function enrichReadiumLocatorProgression(locator: Locator, positions: Locator[] | undefined): Locator {
  const normalizedLocator = normalizeReadiumLocator(locator)
  const resourceProgression = normalizedProgress(normalizedLocator.locations.progression)
  const normalizedPositions = (positions ?? []).map(normalizeReadiumLocator)
  let startIndex = -1
  for (let index = normalizedPositions.length - 1; index >= 0; index -= 1) {
    const position = normalizedPositions[index]
    if (position.href === normalizedLocator.href && normalizedProgress(position.locations.progression) <= resourceProgression) {
      startIndex = index
      break
    }
  }

  if (startIndex < 0) {
    return normalizedLocator
  }

  const startPosition = normalizedPositions[startIndex]
  const nextPosition = normalizedPositions[startIndex + 1]
  const startTotalProgression = normalizedProgress(startPosition.locations.totalProgression)
  const endTotalProgression = nextPosition
    ? normalizedProgress(nextPosition.locations.totalProgression)
    : 1
  const startResourceProgression = normalizedProgress(startPosition.locations.progression)
  const endResourceProgression = nextPosition?.href === normalizedLocator.href
    ? normalizedProgress(nextPosition.locations.progression)
    : 1
  const segmentSize = Math.max(endResourceProgression - startResourceProgression, 0)
  const segmentProgression = segmentSize > 0
    ? Math.min(Math.max((resourceProgression - startResourceProgression) / segmentSize, 0), 1)
    : 0
  const totalProgression = startTotalProgression + segmentProgression * (endTotalProgression - startTotalProgression)

  return normalizeReadiumLocator(normalizedLocator.copyWithLocations({
    totalProgression: normalizedProgress(totalProgression)
  }))
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

function installTextSelectionBridge(navigator: EpubNavigatorInternals): void {
  if (navigator[epubSelectionBridgeKey]) {
    return
  }
  const listeners = navigator.listeners
  const originalTextSelected = listeners?.textSelected
  if (!listeners || !originalTextSelected) {
    return
  }

  listeners.textSelected = (selection) => {
    originalTextSelected(selection)
    for (const handler of textSelectionHandlers) {
      handler(selection, navigator)
    }
  }
  navigator[epubSelectionBridgeKey] = true
}

function installPositionProgressionBridge(navigator: EpubNavigatorInternals): void {
  if (navigator[epubPositionProgressionBridgeKey]) {
    return
  }
  const listeners = navigator.listeners
  const originalPositionChanged = listeners?.positionChanged
  if (!listeners || !originalPositionChanged) {
    return
  }

  listeners.positionChanged = (locator) => {
    const enrichedLocator = enrichReadiumLocatorProgression(locator, navigator.positions)
    navigator.currentLocation = enrichedLocator
    originalPositionChanged(enrichedLocator)
  }
  navigator[epubPositionProgressionBridgeKey] = true
}

function notifyNavigatorHandlers(navigator: EpubNavigatorInternals | null): void {
  for (const handler of navigatorHandlers) {
    handler(navigator)
  }
}

function normalizeNavigatorPositions(navigator: EpubNavigatorInternals): void {
  if (Array.isArray(navigator.positions)) {
    navigator.positions = navigator.positions.map(normalizeReadiumLocator)
  }
}

function findSelectionRange(selection: BasicTextSelection, navigator: EpubNavigatorInternals): Range | undefined {
  const frame = (navigator._cframes ?? [])
    .map((candidate) => candidate?.iframe)
    .find((iframe) => iframe?.contentWindow?.location.href === selection.targetFrameSrc)
  const selected = frame?.contentWindow?.getSelection()

  if (!selected?.rangeCount) {
    return undefined
  }

  const range = selected.getRangeAt(0)
  return range.toString() === selection.text ? range.cloneRange() : undefined
}

function textContextFromRange(range: Range, selectedText: string): { before?: string; after?: string } {
  const root = range.commonAncestorContainer.ownerDocument?.body
  if (!root) {
    return {}
  }

  const beforeRange = root.ownerDocument.createRange()
  beforeRange.selectNodeContents(root)
  beforeRange.setEnd(range.startContainer, range.startOffset)

  const afterRange = root.ownerDocument.createRange()
  afterRange.selectNodeContents(root)
  afterRange.setStart(range.endContainer, range.endOffset)

  const before = beforeRange.toString().slice(-64)
  const after = afterRange.toString().slice(0, Math.max(64, selectedText.length))
  beforeRange.detach()
  afterRange.detach()

  return {
    before: before || undefined,
    after: after || undefined
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

function normalizedProgress(value: unknown): number {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) {
    return 0
  }
  return Math.min(Math.max(numberValue, 0), 1)
}

function stripUndefinedValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripUndefinedValues).filter((item) => item !== undefined)
  }

  if (!value || typeof value !== "object") {
    return value
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .flatMap(([key, child]) => {
        const cleanChild = stripUndefinedValues(child)
        return cleanChild === undefined ? [] : [[key, cleanChild]]
      })
  )
}
