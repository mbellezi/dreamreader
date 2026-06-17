export const AUDIOBOOK_INTRO_CHAPTER_HREF = "__dreamreader_audiobook_intro__"

type AudiobookIntroMetadata = {
  authors?: string[] | null
  publishedAt?: string | null
  title: string
}

export function audiobookIntroParts(metadata: AudiobookIntroMetadata): string[] {
  const title = metadata.title.trim()
  const authors = (metadata.authors ?? []).map((author) => author.trim()).filter(Boolean).join(", ")
  const year = publicationYear(metadata.publishedAt)
  return [title, authors, year].filter((part): part is string => Boolean(part))
}

export function buildAudiobookIntroTitle(metadata: AudiobookIntroMetadata): string {
  return audiobookIntroParts(metadata).join(" - ")
}

export function buildAudiobookIntroHtml(metadata: AudiobookIntroMetadata): string {
  const paragraphs = audiobookIntroParts(metadata).map((part) => `<p>${escapeHtml(part)}</p>`)
  return `<article>${paragraphs.join("")}</article>`
}

export function publicationYear(value?: string | null): string | undefined {
  return String(value ?? "").match(/\b([12][0-9]{3})\b/)?.[1]
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
