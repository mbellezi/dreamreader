export type ReaderContentBlock =
  | {
      footnotes?: ReaderFootnoteReference[]
      type: "paragraph"
      text: string
    }
  | {
      type: "image"
      alt?: string
      src: string
    }

export type ReaderFootnoteReference = {
  marker: string
  note: string
  offset: number
  target: string
}

type ReaderContentOptions = {
  bookId?: string
  chapterHref?: string
}

const BLOCK_TAGS = new Set([
  "article",
  "blockquote",
  "body",
  "div",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "p",
  "section"
])

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "...",
  laquo: "«",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  quot: "\"",
  raquo: "»",
  rdquo: "”",
  rsquo: "’"
}

export function htmlToReaderBlocks(html: string, options: ReaderContentOptions = {}): ReaderContentBlock[] {
  const blocks: ReaderContentBlock[] = []
  let currentText = ""
  let currentFootnotes: ReaderFootnoteReference[] = []
  const extractedFootnotes = extractFootnotes(stripUnsafeHtmlSections(html))
  const body = markFootnoteReferences(extractedFootnotes.html, extractedFootnotes.notes)
  const tokens = body.match(/<[^>]+>|[^<]+/g) ?? []

  const flushParagraph = () => {
    const text = normalizeReaderText(currentText)
    const footnotes = currentFootnotes
      .filter((footnote) => footnote.offset <= text.length)
      .map((footnote) => ({ ...footnote, offset: Math.max(0, footnote.offset) }))
    currentText = ""
    currentFootnotes = []
    if (text) {
      blocks.push({ type: "paragraph", text, ...(footnotes.length ? { footnotes } : {}) })
    }
  }

  for (const token of tokens) {
    if (!token.startsWith("<")) {
      currentText += decodeHtmlEntities(token)
      continue
    }

    const tagName = tagNameFor(token)
    if (!tagName || isIgnorableTag(token)) {
      continue
    }

    if (tagName === "br") {
      currentText += "\n"
      continue
    }

    if (tagName === "img") {
      flushParagraph()
      const src = resolveReaderImageSrc(attributeValue(token, "src"), options)
      if (src) {
        blocks.push({
          type: "image",
          src,
          alt: attributeValue(token, "alt")
        })
      }
      continue
    }

    if (tagName === "dr-footnote") {
      const target = attributeValue(token, "data-target")
      const note = target ? extractedFootnotes.notes.get(target) : undefined
      if (target && note) {
        currentFootnotes.push({
          marker: attributeValue(token, "data-marker") ?? target,
          note,
          offset: normalizeReaderText(currentText).length,
          target
        })
      }
      continue
    }

    if (BLOCK_TAGS.has(tagName)) {
      flushParagraph()
    }
  }

  flushParagraph()
  return blocks
}

export function htmlToPlainText(html: string): string {
  return htmlToReaderBlocks(html)
    .filter((block): block is Extract<ReaderContentBlock, { type: "paragraph" }> => block.type === "paragraph")
    .map((block) => block.text)
    .join("\n\n")
}

function stripUnsafeHtmlSections(html: string): string {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
}

function extractFootnotes(html: string): { html: string; notes: Map<string, string> } {
  const notes = new Map<string, string>()
  let currentTarget: string | undefined
  const cleanHtml = html.replace(/<p\b[^>]*\bclass\s*=\s*(?:"[^"]*\bfootnote[\w-]*\b[^"]*"|'[^']*\bfootnote[\w-]*\b[^']*')[^>]*>[\s\S]*?<\/p>/gi, (match) => {
    const target = footnoteTargetFromParagraph(match)
    const noteText = footnoteParagraphText(match)
    if (target) {
      currentTarget = target
      if (noteText) {
        notes.set(target, noteText)
      }
    } else if (currentTarget && noteText) {
      const existing = notes.get(currentTarget)
      notes.set(currentTarget, existing ? `${existing}\n\n${noteText}` : noteText)
    }
    return ""
  })
  return { html: cleanHtml, notes }
}

function footnoteTargetFromParagraph(html: string): string | undefined {
  const match = html.match(/\bid\s*=\s*(?:"(fn[-_][^"]+)"|'(fn[-_][^']+)')/i)
  const id = match?.[1] ?? match?.[2]
  return id ? normalizeFootnoteTarget(id) : undefined
}

function footnoteParagraphText(html: string): string {
  return htmlFragmentToText(
    html.replace(/<a\b[^>]*\bid\s*=\s*(?:"fn[-_][^"]+"|'fn[-_][^']+')[^>]*>\s*<sup\b[^>]*>[\s\S]*?<\/sup>\s*<\/a>/i, "")
  )
}

function markFootnoteReferences(html: string, notes: Map<string, string>): string {
  if (!notes.size) {
    return html
  }
  return html.replace(/<sup\b[^>]*>\s*<a\b([^>]*)>([\s\S]*?)<\/a>\s*<\/sup>/gi, (match, attributes: string, markerHtml: string) => {
    const target = normalizeFootnoteTarget(attributeValue(`<a ${attributes}>`, "href"))
    if (!target || !notes.has(target)) {
      return match
    }
    const marker = htmlFragmentToText(markerHtml) || target
    return `<dr-footnote data-target="${escapeHtmlAttribute(target)}" data-marker="${escapeHtmlAttribute(marker)}"></dr-footnote>`
  })
}

function normalizeFootnoteTarget(value: string | undefined): string | undefined {
  const clean = decodePathSafely(value?.replace(/^#/, "").trim() ?? "")
  return clean ? clean : undefined
}

function htmlFragmentToText(html: string): string {
  return normalizeReaderText(
    decodeHtmlEntities(
      html
        .replace(/<head[\s\S]*?<\/head>/gi, "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+\bepub:type\s*=\s*["']pagebreak["'][^>]*>/gi, "")
        .replace(/<img\b[^>]*>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
    )
  )
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function isIgnorableTag(tag: string): boolean {
  return /<\s*(?:meta|link)\b/i.test(tag) || /\bepub:type\s*=\s*["']pagebreak["']/i.test(tag)
}

function tagNameFor(tag: string): string | undefined {
  return tag.match(/^<\s*\/?\s*([a-z0-9:-]+)/i)?.[1]?.toLocaleLowerCase("en-US")
}

function attributeValue(tag: string, attribute: string): string | undefined {
  const pattern = new RegExp(`\\s${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")
  const match = tag.match(pattern)
  const value = match?.[1] ?? match?.[2] ?? match?.[3]
  return value ? decodeHtmlEntities(value.trim()) : undefined
}

function normalizeReaderText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\u00ad/g, "")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/[^\S\n]+\n/g, "\n")
    .replace(/\n[^\S\n]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name] ?? match)
}

function fromCodePoint(code: number): string {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ""
}

function resolveReaderImageSrc(src: string | undefined, options: ReaderContentOptions): string | undefined {
  if (!src) {
    return undefined
  }
  if (/^(?:data:image\/|dreamreader:\/\/asset\/|dreamreader:\/\/book-resource\/)/i.test(src)) {
    return src
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || !options.bookId || !options.chapterHref) {
    return undefined
  }

  const [srcPath] = src.split("#")
  const chapterPath = options.chapterHref.split("#")[0] ?? ""
  const baseDir = dirname(chapterPath)
  const resourcePath = normalizePath(joinPath(baseDir, decodePathSafely(srcPath)))
  if (!resourcePath || resourcePath.startsWith("../")) {
    return undefined
  }

  return `dreamreader://book-resource/${encodeURIComponent(options.bookId)}/${resourcePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`
}

function dirname(value: string): string {
  const index = value.lastIndexOf("/")
  return index >= 0 ? value.slice(0, index) : ""
}

function joinPath(left: string, right: string): string {
  return left ? `${left}/${right}` : right
}

function normalizePath(value: string): string {
  const parts: string[] = []
  for (const part of value.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") {
      continue
    }
    if (part === "..") {
      if (!parts.length) {
        return "../"
      }
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join("/")
}

function decodePathSafely(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
