import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react"
import { Locator } from "@readium/shared"
import {
  StatefulGlobalPreferencesProvider,
  StatefulReaderWrapper,
  ThStoreProvider,
  usePublication,
  type PositionStorage
} from "@edrlab/thorium-web/reader"
import { defaultPreferences, ThProgressionFormat, type ThPreferences } from "@edrlab/thorium-web/core/preferences"
import type { TranslationFn } from "@renderer/app/types"
import { dreamreaderClient } from "@renderer/lib/dreamreader"
import { installReadiumEpubNavigationPatch, readiumLocatorProgress, serializeReadiumLocator } from "@renderer/lib/readium-compat"
import type { BookDetails, Locale, ReaderLocator } from "@renderer/types"
import { ThoriumAnnotationsBridge } from "./ThoriumAnnotationsBridge"

type ReaderFooterColors = {
  backgroundColor: string | null
  hoverColor: string | null
  textColor: string | null
}

type RgbColor = {
  a: number
  b: number
  g: number
  r: number
}

const thoriumI18nLoadPath = "./locales/{{lng}}/{{ns}}.json"
const thoriumReaderStorageKey = "dreamreader.thorium.reader"
const thoriumReaderPreferences: ThPreferences = {
  ...defaultPreferences,
  theming: {
    ...defaultPreferences.theming,
    progression: {
      ...defaultPreferences.theming.progression,
      format: {
        ...defaultPreferences.theming.progression?.format,
        reflow: {
          default: {
            variants: [ThProgressionFormat.overallProgression, ThProgressionFormat.resourceProgression],
            displayInImmersive: true,
            displayInFullscreen: true
          },
          breakpoints: {
            compact: {
              variants: [ThProgressionFormat.overallProgression, ThProgressionFormat.resourceProgression],
              displayInImmersive: true,
              displayInFullscreen: true
            }
          }
        }
      }
    }
  }
}

installReadiumEpubNavigationPatch()

type ThoriumReaderPaneProps = {
  book: BookDetails | null
  locale: Locale
  onPositionSaved?: (locator: ReaderLocator) => void
  t: TranslationFn
}

export function ThoriumReaderPane({ book, locale, onPositionSaved, t }: ThoriumReaderPaneProps): ReactElement {
  if (!book) {
    return (
      <section className="flex h-full items-center justify-center bg-background px-6">
        <div className="max-w-md text-center">
          <h2 className="text-lg font-semibold">{t("reader.noBook")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("reader.noBookBody")}</p>
        </div>
      </section>
    )
  }

  return (
    <ThStoreProvider storageKey={thoriumReaderStorageKey}>
      <StatefulGlobalPreferencesProvider initialPreferences={{ locale }}>
        <ThoriumPublicationReader key={book.id} book={book} locale={locale} onPositionSaved={onPositionSaved} t={t} />
      </StatefulGlobalPreferencesProvider>
    </ThStoreProvider>
  )
}

function ThoriumPublicationReader({
  book,
  locale,
  onPositionSaved,
  t
}: {
  book: BookDetails
  locale: Locale
  onPositionSaved?: (locator: ReaderLocator) => void
  t: TranslationFn
}): ReactElement {
  const manifestUrl = useMemo(() => publicationManifestUrl(book.id), [book.id])
  const { error, isLoading, localDataKey, profile, publication } = usePublication({ url: manifestUrl })
  const readerRootRef = useRef<HTMLElement | null>(null)
  const [readerFooterColors, setReaderFooterColors] = useState<ReaderFooterColors>({
    backgroundColor: null,
    hoverColor: null,
    textColor: null
  })
  const syncReaderFooterColors = useCallback(() => {
    const root = readerRootRef.current
    if (!root) {
      return
    }

    const frames = Array.from(root.querySelectorAll<HTMLIFrameElement>("iframe.readium-navigator-iframe"))
    const frame = frames.find((candidate) => window.getComputedStyle(candidate).visibility === "visible") ?? frames[0]
    const frameWindow = frame?.contentWindow
    const frameDocument = frame?.contentDocument
    if (!frameWindow || !frameDocument) {
      return
    }

    const shellStyle = window.getComputedStyle(root)
    const frameStyle = window.getComputedStyle(frame)
    const documentStyle = frameWindow.getComputedStyle(frameDocument.documentElement)
    const bodyStyle = frameDocument.body ? frameWindow.getComputedStyle(frameDocument.body) : null
    const contentStyle = firstContentStyle(frameWindow, frameDocument)
    const backgroundColor = firstUsableCssColor(
      shellStyle.getPropertyValue("--th-theme-background"),
      documentStyle.getPropertyValue("--USER__backgroundColor"),
      bodyStyle?.getPropertyValue("--USER__backgroundColor"),
      contentStyle?.getPropertyValue("--USER__backgroundColor"),
      documentStyle.getPropertyValue("--RS__backgroundColor"),
      bodyStyle?.getPropertyValue("--RS__backgroundColor"),
      contentStyle?.getPropertyValue("--RS__backgroundColor"),
      documentStyle.getPropertyValue("--th-theme-background"),
      bodyStyle?.getPropertyValue("--th-theme-background"),
      contentStyle?.getPropertyValue("--th-theme-background"),
      documentStyle.backgroundColor,
      bodyStyle?.backgroundColor,
      contentStyle?.backgroundColor,
      frameStyle.backgroundColor
    )
    const textColor = textColorForBackground(backgroundColor, firstUsableCssColor(
      shellStyle.getPropertyValue("--th-theme-text"),
      documentStyle.getPropertyValue("--USER__textColor"),
      bodyStyle?.getPropertyValue("--USER__textColor"),
      contentStyle?.getPropertyValue("--USER__textColor"),
      documentStyle.getPropertyValue("--RS__textColor"),
      bodyStyle?.getPropertyValue("--RS__textColor"),
      contentStyle?.getPropertyValue("--RS__textColor"),
      documentStyle.getPropertyValue("--th-theme-text"),
      bodyStyle?.getPropertyValue("--th-theme-text"),
      contentStyle?.getPropertyValue("--th-theme-text"),
      documentStyle.color,
      bodyStyle?.color,
      contentStyle?.color
    ))
    const hoverColor = firstUsableCssColor(
      shellStyle.getPropertyValue("--th-theme-hover"),
      documentStyle.getPropertyValue("--th-theme-hover"),
      bodyStyle?.getPropertyValue("--th-theme-hover"),
      contentStyle?.getPropertyValue("--th-theme-hover"),
      frameStyle.getPropertyValue("--th-theme-hover")
    ) ?? hoverColorForText(textColor, backgroundColor)

    if (backgroundColor) {
      setReaderFooterColors((current) => {
        if (current.backgroundColor === backgroundColor && current.hoverColor === hoverColor && current.textColor === textColor) {
          return current
        }

        return { backgroundColor, hoverColor, textColor }
      })
    }
  }, [])
  const positionStorage = useMemo<PositionStorage>(
    () => ({
      get: () => {
        if (!book.lastPosition?.readiumLocator) {
          return undefined
        }
        return Locator.deserialize(book.lastPosition.readiumLocator)
      },
      set: (locator) => {
        const serialized = serializeReadiumLocator(locator)
        const nextProgress = readiumLocatorProgress(serialized)
        const readerLocator = rendererLocatorFromReadium(book.id, serialized, nextProgress)

        return dreamreaderClient.saveReadiumLocator(book.id, serialized)
          .then(() => {
            onPositionSaved?.(readerLocator)
          })
          .catch(() => undefined)
      }
    }),
    [book.id, book.lastPosition?.readiumLocator, onPositionSaved]
  )

  useEffect(() => {
    const root = readerRootRef.current
    if (!root) {
      return undefined
    }

    const cleanupFns: Array<() => void> = []
    const observedFrameDocuments = new Set<Document>()
    const observedFrameLoads = new Set<HTMLIFrameElement>()

    const observeFrameDocument = (frameDocument: Document | null) => {
      if (!frameDocument || observedFrameDocuments.has(frameDocument)) {
        return
      }

      const documentObserver = new MutationObserver(syncReaderFooterColors)
      documentObserver.observe(frameDocument.documentElement, { attributes: true, attributeFilter: ["class", "style"] })
      if (frameDocument.body) {
        documentObserver.observe(frameDocument.body, { attributes: true, attributeFilter: ["class", "style"] })
      }
      if (frameDocument.head) {
        documentObserver.observe(frameDocument.head, { characterData: true, childList: true, subtree: true })
      }

      observedFrameDocuments.add(frameDocument)
      cleanupFns.push(() => documentObserver.disconnect())
    }

    const attachIframeListeners = () => {
      root.querySelectorAll<HTMLIFrameElement>("iframe.readium-navigator-iframe").forEach((iframe) => {
        if (!observedFrameLoads.has(iframe)) {
          iframe.addEventListener("load", attachIframeListeners)
          observedFrameLoads.add(iframe)
          cleanupFns.push(() => iframe.removeEventListener("load", attachIframeListeners))
        }

        try {
          observeFrameDocument(iframe.contentDocument)
        } catch {
          // Same-origin is expected for Readium frames, but the document can be briefly unavailable while loading.
        }
      })
      syncReaderFooterColors()
    }

    const observer = new MutationObserver(attachIframeListeners)
    observer.observe(root, { attributes: true, childList: true, subtree: true })
    attachIframeListeners()

    return () => {
      observer.disconnect()
      cleanupFns.forEach((cleanup) => cleanup())
    }
  }, [syncReaderFooterColors])

  if (error) {
    return (
      <section className="flex h-full items-center justify-center bg-background px-6">
        <div className="max-w-md rounded-md border bg-card p-5 text-sm shadow-sm">
          <h2 className="text-base font-semibold">{t("common.error")}</h2>
          <p className="mt-2 text-muted-foreground">{error.context ?? t("common.error")}</p>
        </div>
      </section>
    )
  }

  if (!publication || !profile) {
    return (
      <section className="flex h-full items-center justify-center bg-background px-6">
        <p className="text-sm text-muted-foreground">{t(isLoading ? "common.loading" : "reader.noBook")}</p>
      </section>
    )
  }

  return (
    <section
      ref={readerRootRef}
      className="dreamreader-thorium-shell relative flex h-full min-h-0 flex-col overflow-hidden bg-background"
      style={{
        "--dreamreader-reader-background": readerFooterColors.backgroundColor ?? undefined,
        "--dreamreader-reader-hover": readerFooterColors.hoverColor ?? undefined,
        "--dreamreader-reader-text": readerFooterColors.textColor ?? undefined
      } as CSSProperties}
    >
      <div className="dreamreader-thorium-frame min-h-0 flex-1 overflow-hidden">
        <StatefulReaderWrapper
          profile={profile}
          publication={publication}
          localDataKey={localDataKey}
          isLoading={isLoading}
          preferences={{ initialPreferences: thoriumReaderPreferences }}
          positionStorage={positionStorage}
          i18n={{ lng: locale, fallbackLng: "en", backend: { loadPath: thoriumI18nLoadPath } }}
        />
      </div>
      <ThoriumAnnotationsBridge bookId={book.id} t={t} />
    </section>
  )
}

function publicationManifestUrl(bookId: string): string {
  return `dreamreader://publication/${encodeURIComponent(bookId)}/manifest.json`
}

function rendererLocatorFromReadium(bookId: string, locator: Record<string, unknown>, progress: number): ReaderLocator {
  const locations = locator.locations && typeof locator.locations === "object" && !Array.isArray(locator.locations)
    ? locator.locations as Record<string, unknown>
    : {}

  return {
    bookId,
    chapterId: typeof locator.href === "string" ? locator.href : "",
    pageIndex: optionalNumber(locations.position),
    progress: Math.round(progress * 100),
    readingFlow: "paginated",
    readiumLocator: locator,
    updatedAt: new Date().toISOString()
  }
}

function optionalNumber(value: unknown): number | undefined {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

function firstUsableCssColor(...colors: Array<string | null | undefined>): string | null {
  for (const color of colors) {
    const trimmedColor = color?.trim()
    if (trimmedColor && parseCssColor(trimmedColor) && !isTransparentCssColor(trimmedColor)) {
      return trimmedColor
    }
  }

  return null
}

function firstContentStyle(frameWindow: Window, frameDocument: Document): CSSStyleDeclaration | null {
  const candidates = [
    frameDocument.body,
    frameDocument.body?.firstElementChild,
    frameDocument.body?.querySelector("[style], main, article, section, div")
  ]

  for (const element of candidates) {
    if (!element) {
      continue
    }
    const style = frameWindow.getComputedStyle(element)
    if (firstUsableCssColor(
      style.getPropertyValue("--USER__backgroundColor"),
      style.getPropertyValue("--RS__backgroundColor"),
      style.getPropertyValue("--th-theme-background"),
      style.backgroundColor
    )) {
      return style
    }
  }

  return null
}

function isTransparentCssColor(color: string): boolean {
  const parsedColor = parseCssColor(color)
  return color === "transparent" || parsedColor?.a === 0
}

function textColorForBackground(backgroundColor: string | null, preferredTextColor: string | null): string | null {
  const background = backgroundColor ? parseCssColor(backgroundColor) : null
  if (!background) {
    return preferredTextColor
  }

  const preferred = preferredTextColor ? parseCssColor(preferredTextColor) : null
  if (preferred && contrastRatio(background, preferred) >= 4.5) {
    return preferredTextColor
  }

  const black = { r: 0, g: 0, b: 0, a: 1 }
  const white = { r: 255, g: 255, b: 255, a: 1 }
  return contrastRatio(background, white) >= contrastRatio(background, black) ? "#ffffff" : "#000000"
}

function hoverColorForText(textColor: string | null, backgroundColor: string | null): string | null {
  const parsedColor = textColor ? parseCssColor(textColor) : null
  if (!parsedColor) {
    return null
  }

  const parsedBackgroundColor = backgroundColor ? parseCssColor(backgroundColor) : null
  const alpha = parsedBackgroundColor && relativeLuminance(parsedBackgroundColor) < 0.5 ? 0.25 : 0.14
  return `rgba(${Math.round(parsedColor.r)}, ${Math.round(parsedColor.g)}, ${Math.round(parsedColor.b)}, ${alpha})`
}

function parseCssColor(color: string): RgbColor | null {
  const trimmedColor = color.trim().toLowerCase()
  if (trimmedColor === "transparent") {
    return { r: 0, g: 0, b: 0, a: 0 }
  }

  const hexMatch = trimmedColor.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hexMatch) {
    const hex = hexMatch[1]
    const fullHex = hex.length === 3
      ? hex.split("").map((char) => char + char).join("")
      : hex
    return {
      r: Number.parseInt(fullHex.slice(0, 2), 16),
      g: Number.parseInt(fullHex.slice(2, 4), 16),
      b: Number.parseInt(fullHex.slice(4, 6), 16),
      a: 1
    }
  }

  const rgbMatch = trimmedColor.match(/^rgba?\((.+)\)$/)
  if (!rgbMatch) {
    return null
  }

  const parts = rgbMatch[1].replace(/\s*\/\s*/, " ").replaceAll(",", " ").trim().split(/\s+/)
  if (parts.length < 3) {
    return null
  }

  return {
    r: parseCssColorChannel(parts[0]),
    g: parseCssColorChannel(parts[1]),
    b: parseCssColorChannel(parts[2]),
    a: parts[3] ? parseCssAlpha(parts[3]) : 1
  }
}

function parseCssColorChannel(value: string): number {
  const parsed = Number.parseFloat(value)
  return value.endsWith("%")
    ? clampColorChannel(parsed * 2.55)
    : clampColorChannel(parsed)
}

function parseCssAlpha(value: string): number {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) {
    return 1
  }

  return Math.min(Math.max(value.endsWith("%") ? parsed / 100 : parsed, 0), 1)
}

function clampColorChannel(value: number): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 255)
}

function contrastRatio(colorA: RgbColor, colorB: RgbColor): number {
  const lighter = Math.max(relativeLuminance(colorA), relativeLuminance(colorB))
  const darker = Math.min(relativeLuminance(colorA), relativeLuminance(colorB))
  return (lighter + 0.05) / (darker + 0.05)
}

function relativeLuminance(color: RgbColor): number {
  const [r, g, b] = [color.r, color.g, color.b].map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
