import { readFile } from "node:fs/promises"
import path from "node:path"
import JSZip from "jszip"
import type { ReaderChapter, ReaderManifest } from "./library-service"

export type ReadiumWebPublicationLink = {
  href?: string
  type?: string
  title?: unknown
  rel?: string | string[]
  properties?: Record<string, unknown>
  children?: ReadiumWebPublicationLink[]
  [key: string]: unknown
}

export type ReadiumWebPublicationManifest = {
  metadata?: Record<string, unknown>
  readingOrder?: ReadiumWebPublicationLink[]
  resources?: ReadiumWebPublicationLink[]
  toc?: ReadiumWebPublicationLink[]
  [key: string]: unknown
}

type ReadiumTocEntry = {
  title: string
  href: string
  children: ReadiumTocEntry[]
}

type TocChapterEntry = {
  title: string
  href: string
  contentHrefs: string[]
  includeAdditionalHrefs: "always" | "when-primary-unreadable"
}

type TocExtractionResult = {
  chapters: ReaderChapter[]
  hadStructuralMiss: boolean
}

export async function adaptReadiumManifestToReaderManifest(
  filePath: string,
  readiumManifest: ReadiumWebPublicationManifest,
  fallbackTitle: string
): Promise<ReaderManifest> {
  const zip = await JSZip.loadAsync(await readFile(filePath))
  const tocEntries = arrayify(readiumManifest.toc)
    .map(readiumLinkToTocEntry)
    .filter((entry): entry is ReadiumTocEntry => Boolean(entry))
  const tocExtraction = tocEntries.length ? await extractChaptersFromToc(zip, tocEntries) : undefined
  let chapters = tocExtraction && !tocExtraction.hadStructuralMiss ? tocExtraction.chapters : []

  if (!chapters.length) {
    chapters = await extractChaptersFromReadingOrder(zip, arrayify(readiumManifest.readingOrder))
  }

  if (!chapters.length) {
    throw new Error("Readium manifest has no readable text chapters")
  }

  const metadata = readiumManifest.metadata ?? {}
  const cover = findReadiumCoverLink(readiumManifest)
  return {
    format: "epub",
    title: stringValue(metadata.title) ?? fallbackTitle,
    authors: contributorNames(metadata.author),
    language: languageValue(metadata.language) ?? "pt-BR",
    chapters,
    tableOfContents: chapters.map((chapter) => ({ href: chapter.href, title: chapter.title })),
    cover: cover?.href
      ? {
        href: normalizeReadiumHref(cover.href),
        mediaType: cover.type ?? "application/octet-stream"
      }
      : undefined
  }
}

async function extractChaptersFromToc(
  zip: JSZip,
  tocEntries: ReadiumTocEntry[]
): Promise<TocExtractionResult> {
  const chapters: ReaderChapter[] = []
  const htmlByPath = new Map<string, string>()
  const chapterEntries = tocEntriesToChapterEntries(tocEntries)
  let hadStructuralMiss = false

  for (const [index, entry] of chapterEntries.entries()) {
    const nextEntry = chapterEntries.slice(index + 1).find((item) => splitHref(item.href).filePath === splitHref(entry.href).filePath)
    const primary = await readTocHrefContent(zip, htmlByPath, entry.href, nextEntry?.href)
    if (primary.hadStructuralMiss) {
      hadStructuralMiss = true
      continue
    }

    const pieces = primary.content ? [primary.content] : []
    const primaryText = htmlToReadableText(primary.content ?? "")
    if (entry.includeAdditionalHrefs === "always" || !primaryText) {
      for (const contentHref of entry.contentHrefs.slice(1)) {
        const additional = await readTocHrefContent(zip, htmlByPath, contentHref)
        if (additional.hadStructuralMiss) {
          hadStructuralMiss = true
          continue
        }
        if (additional.content) {
          pieces.push(additional.content)
        }
      }
    }

    const content = pieces.join("\n")
    if (!htmlToReadableText(content)) {
      continue
    }

    const parsed = splitHref(entry.href)
    chapters.push({
      id: parsed.fragment ? `${parsed.filePath}#${parsed.fragment}` : parsed.filePath,
      href: parsed.fragment ? `${parsed.filePath}#${parsed.fragment}` : parsed.filePath,
      title: entry.title,
      content,
      mediaType: "application/xhtml+xml",
      progressionStart: index / Math.max(chapterEntries.length, 1),
      progressionEnd: (index + 1) / Math.max(chapterEntries.length, 1)
    })
  }

  return { chapters: normalizeChapterProgression(chapters), hadStructuralMiss }
}

async function extractChaptersFromReadingOrder(
  zip: JSZip,
  readingOrder: ReadiumWebPublicationLink[]
): Promise<ReaderChapter[]> {
  const htmlItems = readingOrder.filter((item) => item.href && (isHtmlMediaType(item.type) || isHtmlPath(item.href)))
  const chapters: ReaderChapter[] = []

  for (const [index, item] of htmlItems.entries()) {
    if (!item.href) {
      continue
    }
    const href = normalizeReadiumHref(item.href)
    if (isNoteHref(href)) {
      continue
    }
    const parsed = splitHref(href)
    const chapterFile = findZipFile(zip, parsed.filePath)
    if (!chapterFile) {
      continue
    }
    const content = await chapterFile.async("text")
    if (!htmlToReadableText(content)) {
      continue
    }
    const title = stringValue(item.title) ?? extractTitle(content) ?? path.posix.basename(parsed.filePath)
    chapters.push({
      id: parsed.fragment ? `${parsed.filePath}#${parsed.fragment}` : parsed.filePath,
      href: parsed.fragment ? `${parsed.filePath}#${parsed.fragment}` : parsed.filePath,
      title,
      content,
      mediaType: item.type ?? "application/xhtml+xml",
      progressionStart: index / Math.max(htmlItems.length, 1),
      progressionEnd: (index + 1) / Math.max(htmlItems.length, 1)
    })
  }

  return normalizeChapterProgression(chapters)
}

function readiumLinkToTocEntry(link: ReadiumWebPublicationLink): ReadiumTocEntry | undefined {
  const href = typeof link.href === "string" ? normalizeReadiumHref(link.href) : ""
  const children = arrayify(link.children)
    .map(readiumLinkToTocEntry)
    .filter((entry): entry is ReadiumTocEntry => Boolean(entry))
  const title = stringValue(link.title)?.trim() ?? ""

  if (!title && !href && !children.length) {
    return undefined
  }

  return {
    title: title || href,
    href,
    children
  }
}

function tocEntriesToChapterEntries(entries: ReadiumTocEntry[]): TocChapterEntry[] {
  return entries.flatMap((entry) => tocEntryToChapterEntries(entry))
}

function tocEntryToChapterEntries(entry: ReadiumTocEntry): TocChapterEntry[] {
  if (isNoteTocEntry(entry)) {
    return []
  }

  const chapterChildren = entry.children.filter((child) => isMajorTocEntry(child))
  if (chapterChildren.length) {
    return chapterChildren.flatMap((child) => tocChapterEntry(child, "always"))
  }

  if (!entry.href) {
    return entry.children.flatMap((child) => tocEntryToChapterEntries(child))
  }

  return tocChapterEntry(entry, "when-primary-unreadable")
}

function tocChapterEntry(entry: ReadiumTocEntry, includeAdditionalHrefs: TocChapterEntry["includeAdditionalHrefs"]): TocChapterEntry[] {
  if (isNoteTocEntry(entry)) {
    return []
  }
  if (!entry.href) {
    return entry.children.flatMap((child) => tocEntryToChapterEntries(child))
  }

  return [
    {
      title: entry.title,
      href: entry.href,
      contentHrefs: uniqueContentHrefs([entry.href, ...collectDescendantContentHrefs(entry)]),
      includeAdditionalHrefs
    }
  ]
}

function collectDescendantContentHrefs(entry: ReadiumTocEntry): string[] {
  return entry.children.flatMap((child) => {
    if (isNoteTocEntry(child)) {
      return []
    }
    return [hrefWithoutFragment(child.href), ...collectDescendantContentHrefs(child)].filter(isString)
  })
}

function uniqueContentHrefs(hrefs: string[]): string[] {
  const seen = new Set<string>()
  return hrefs.filter((href) => {
    const normalized = hrefWithoutFragment(href)
    if (!normalized || seen.has(normalized)) {
      return false
    }
    seen.add(normalized)
    return true
  })
}

async function readTocHrefContent(
  zip: JSZip,
  htmlByPath: Map<string, string>,
  href: string,
  endBeforeHref?: string
): Promise<{ content?: string; hadStructuralMiss: boolean }> {
  const parsed = splitHref(href)
  const chapterFile = findZipFile(zip, parsed.filePath)
  if (!chapterFile || !isHtmlPath(parsed.filePath)) {
    return { hadStructuralMiss: true }
  }

  const html = htmlByPath.get(parsed.filePath) ?? await chapterFile.async("text")
  htmlByPath.set(parsed.filePath, html)
  const startIndex = parsed.fragment ? findAnchorIndex(html, parsed.fragment) : bodyStartIndex(html)
  if (startIndex === undefined) {
    return { hadStructuralMiss: true }
  }

  const next = endBeforeHref ? splitHref(endBeforeHref) : undefined
  const endIndex = next?.filePath === parsed.filePath && next.fragment
    ? findAnchorIndex(html, next.fragment) ?? html.length
    : html.length

  return {
    content: html.slice(startIndex, Math.max(startIndex, endIndex)),
    hadStructuralMiss: false
  }
}

function findReadiumCoverLink(readiumManifest: ReadiumWebPublicationManifest): ReadiumWebPublicationLink | undefined {
  const links = [...arrayify(readiumManifest.resources), ...arrayify(readiumManifest.readingOrder)]
  return (
    links.find((link) => linkHasRel(link, "cover")) ??
    links.find((link) => link.properties?.cover === true) ??
    links.find((link) => Boolean(link.href && link.type?.startsWith("image/") && /cover|capa/i.test(link.href)))
  )
}

function linkHasRel(link: ReadiumWebPublicationLink, rel: string): boolean {
  return arrayify(link.rel).includes(rel)
}

function normalizeReadiumHref(href: string): string {
  const [filePath, fragment] = href.split("#")
  const cleanPath = decodePathSafely(filePath).replace(/^\/+/, "")
  const normalizedPath = path.posix.normalize(cleanPath).replace(/^\/+/, "")
  return fragment ? `${normalizedPath}#${decodePathSafely(fragment)}` : normalizedPath
}

function findZipFile(zip: JSZip, filePath: string) {
  const cleanPath = filePath.replace(/^\/+/, "")
  const candidates = new Set([
    cleanPath,
    path.posix.normalize(cleanPath),
    decodePathSafely(cleanPath),
    decodePathSafely(path.posix.normalize(cleanPath))
  ])

  for (const candidate of candidates) {
    const file = zip.file(candidate)
    if (file) {
      return file
    }
  }

  return null
}

function splitHref(href: string): { filePath: string; fragment?: string } {
  const [filePath, fragment] = href.split("#")
  return {
    filePath,
    fragment
  }
}

function hrefWithoutFragment(href: string): string {
  return splitHref(href).filePath
}

function decodePathSafely(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function isHtmlMediaType(mediaType?: string): boolean {
  return Boolean(mediaType?.includes("html") || mediaType?.includes("xhtml"))
}

function isHtmlPath(filePath: string): boolean {
  return /\.(?:xhtml|html?|xml)$/i.test(filePath)
}

function isMajorTocEntry(entry: ReadiumTocEntry): boolean {
  const title = entry.title.trim()
  return /^\d+\s*[.)-]?\s+\S/.test(title) || /^(?:cap[ií]tulo|chapter)\b/i.test(title)
}

function isNoteTocEntry(entry: ReadiumTocEntry): boolean {
  const title = entry.title.trim()
  return /^notas?$/i.test(title) || isNoteHref(entry.href)
}

function isNoteHref(href: string): boolean {
  const filePath = splitHref(href).filePath
  return /(?:^|[_-])notas?\.(?:xhtml|html?)$/i.test(filePath)
}

function findAnchorIndex(html: string, fragment: string): number | undefined {
  const escaped = escapeRegExp(decodePathSafely(fragment))
  const match = html.match(new RegExp(`<[^>]+\\s(?:id|name)=["']${escaped}["'][^>]*>`, "i"))
  return match?.index
}

function bodyStartIndex(html: string): number {
  const match = html.match(/<body[^>]*>/i)
  return match?.index === undefined ? 0 : match.index + match[0].length
}

function htmlToReadableText(html: string): string {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeChapterProgression(chapters: ReaderChapter[]): ReaderChapter[] {
  return chapters.map((chapter, index) => ({
    ...chapter,
    progressionStart: index / Math.max(chapters.length, 1),
    progressionEnd: (index + 1) / Math.max(chapters.length, 1)
  }))
}

function extractTitle(html: string): string | undefined {
  const title =
    html.match(/<h1[^>]*>(.*?)<\/h1>/is)?.[1] ??
    html.match(/<h2[^>]*>(.*?)<\/h2>/is)?.[1] ??
    html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]
  return title?.replace(/<[^>]+>/g, "").trim()
}

function contributorNames(value: unknown): string[] {
  return arrayify(value)
    .map((item) => {
      if (typeof item === "string") {
        return item.trim()
      }
      if (item && typeof item === "object" && "name" in item) {
        return stringValue((item as { name?: unknown }).name)?.trim()
      }
      return stringValue(item)?.trim()
    })
    .filter(isString)
}

function languageValue(value: unknown): string | undefined {
  return arrayify(value).map(stringValue).find(isString)
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(stringValue).find(isString)
  }
  if (value && typeof value === "object") {
    for (const key of ["name", "text", "value", "title"]) {
      if (key in value) {
        const candidate = stringValue((value as Record<string, unknown>)[key])
        if (candidate) {
          return candidate
        }
      }
    }
    return Object.values(value).map(stringValue).find(isString)
  }
  return undefined
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function arrayify<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return []
  }
  return Array.isArray(value) ? value : [value]
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}
