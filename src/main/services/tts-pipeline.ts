import type { NarrationPlan, NarrationProsody, NarrationSegment, PronunciationEntry, VoiceRole } from "@shared/contracts/ai"
import { hashBuffer } from "@main/lib/hash"
import {
  canonicalTtsLanguage,
  dictionaryVersionFor,
  normalizerMetadataForLanguage,
  normalizeForTts,
  sanitizeReadableText,
  sentenceAbbreviationsForLanguage,
  type TtsNormalizationOptions
} from "@main/services/tts-normalizers"

export {
  applyPronunciationEntries,
  canonicalTtsLanguage,
  dictionaryVersionFor,
  DICTIONARY_VERSION,
  NORMALIZER_ID,
  NORMALIZER_VERSION,
  normalizeForTts,
  normalizePtBr,
  numberToPtBr
} from "@main/services/tts-normalizers"

export const PROSODY_ANALYZER_ID = "neutral-rule-prosody"
export const PROSODY_VERSION = "1.0.0"
export const NARRATION_PLAN_VERSION = "narration-plan/v1"
export const MAX_TTS_SEGMENT_CHARS = 420

const htmlEntities: Record<string, string> = {
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

export type ChapterNarrationInput = {
  bookId: string
  chapterHref: string
  contentHash: string
  html: string
  language: string
  pronunciationEntries?: PronunciationEntry[]
  // When set, only the first N paragraphs are kept (partial preview for testing).
  paragraphLimit?: number
}

type SegmentTextForTtsInput = TtsNormalizationOptions | PronunciationEntry[]

export function buildNarrationPlan(input: ChapterNarrationInput): NarrationPlan {
  const fullText = htmlToReadableText(input.html)
  const text = input.paragraphLimit ? limitParagraphs(fullText, input.paragraphLimit) : fullText
  const language = canonicalTtsLanguage(input.language)
  const normalizer = normalizerMetadataForLanguage(language)
  const normalizationOptions = {
    language,
    pronunciationEntries: input.pronunciationEntries
  }
  const chunks = segmentTextForTts(text, normalizationOptions)
  const dictionaryVersion = dictionaryVersionFor(input.pronunciationEntries ?? [])
  const segments = chunks.map((chunk, index): NarrationSegment => {
    const segmentHash = hashBuffer(`${input.bookId}:${input.chapterHref}:${index}:${chunk}`)
    const normalizedText = normalizeForTts(chunk, normalizationOptions)
    return {
      segmentId: `${input.bookId}:${input.chapterHref}:${index}:${segmentHash.slice(0, 12)}`,
      locator: {
        href: input.chapterHref,
        locations: {
          progression: chunks.length <= 1 ? 0 : index / Math.max(chunks.length - 1, 1),
          segmentIndex: index
        }
      },
      originalText: chunk,
      normalizedText,
      voiceRole: voiceRoleFor(chunk),
      prosody: neutralProsodyFor(chunk)
    }
  })

  return {
    schemaVersion: "narration-plan/v1",
    source: {
      bookId: input.bookId,
      chapterHref: input.chapterHref,
      contentHash: input.contentHash,
      language
    },
    normalization: {
      normalizerId: normalizer.id,
      version: normalizer.version,
      dictionaryVersion
    },
    prosody: {
      analyzerId: PROSODY_ANALYZER_ID,
      version: PROSODY_VERSION
    },
    segments
  }
}

export function htmlToReadableText(html: string): string {
  return sanitizeReadableText(
    decodeHtmlEntities(
      removeFootnotesFromHtml(html)
        .replace(/<head[\s\S]*?<\/head>/gi, "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+\bepub:type=["']pagebreak["'][^>]*>/gi, "")
        .replace(/<(p|div|section|article|h1|h2|h3|li)[^>]*>/gi, "\n\n")
        .replace(/<\/(p|div|section|article|h1|h2|h3|li)>/gi, "\n\n")
        .replace(/<img\b[^>]*>/gi, "\n\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
    )
    .replace(/[^\S\n]+\n/g, "\n")
    .replace(/\n[^\S\n]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  )
}

function removeFootnotesFromHtml(html: string): string {
  return html
    .replace(/<p\b[^>]*\bclass\s*=\s*(?:"[^"]*\bfootnote[\w-]*\b[^"]*"|'[^']*\bfootnote[\w-]*\b[^']*')[^>]*>[\s\S]*?<\/p>/gi, "")
    .replace(/<sup\b[^>]*>\s*<a\b[^>]*\bhref\s*=\s*(?:"#[^"]*fn[-_]\d+[^"]*"|'#[^']*fn[-_]\d+[^']*')[^>]*>[\s\S]*?<\/a>\s*<\/sup>/gi, "")
}

export function limitParagraphs(text: string, limit: number): string {
  if (!Number.isFinite(limit) || limit <= 0) {
    return text
  }
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  return paragraphs.slice(0, Math.floor(limit)).join("\n\n")
}

export function segmentTextForTts(text: string, input: SegmentTextForTtsInput = {}): string[] {
  const options = normalizationOptionsFrom(input)
  const paragraphs = sanitizeReadableText(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(hasSpeakableText)
  const segments: string[] = []

  for (const paragraph of paragraphs) {
    segments.push(...chunkSentencesForTts(splitSentences(paragraph, options.language), options))
  }

  const speakableSegments = segments.filter(hasSpeakableText)
  if (speakableSegments.length) {
    return speakableSegments
  }
  const fallback = text.replace(/\s+/g, " ").trim()
  return hasSpeakableText(fallback) ? [fallback] : []
}

// The engine synthesizes normalizedText, which expands numbers/dates/abbreviations,
// so chunks must fit the limit both before and after normalization.
function fitsTtsLimit(text: string, options: TtsNormalizationOptions): boolean {
  return (
    text.length <= MAX_TTS_SEGMENT_CHARS && normalizeForTts(text, options).length <= MAX_TTS_SEGMENT_CHARS
  )
}

function splitOversizedWord(word: string, options: TtsNormalizationOptions): string[] {
  const pieces: string[] = []
  let rest = word
  while (rest.length > 0) {
    let piece = rest.slice(0, MAX_TTS_SEGMENT_CHARS)
    while (piece.length > 1 && !fitsTtsLimit(piece, options)) {
      piece = piece.slice(0, Math.ceil(piece.length / 2))
    }
    pieces.push(piece)
    rest = rest.slice(piece.length)
  }
  return pieces
}

function splitLongSentence(sentence: string, options: TtsNormalizationOptions): string[] {
  if (fitsTtsLimit(sentence, options)) {
    return [sentence]
  }
  const words = sentence.split(/\s+/)
  const chunks: string[] = []
  let current = ""
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (fitsTtsLimit(candidate, options)) {
      current = candidate
      continue
    }
    if (current) {
      chunks.push(current)
      current = ""
    }
    if (fitsTtsLimit(word, options)) {
      current = word
    } else {
      chunks.push(...splitOversizedWord(word, options))
    }
  }
  if (current) {
    chunks.push(current)
  }
  return chunks
}

function chunkSentencesForTts(sentences: string[], options: TtsNormalizationOptions): string[] {
  const chunks: string[] = []
  let current = ""

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence
    if (fitsTtsLimit(candidate, options)) {
      current = candidate
      continue
    }
    if (current) {
      chunks.push(...splitLongSentence(current, options))
    }
    current = sentence
  }

  if (current) {
    chunks.push(...splitLongSentence(current, options))
  }
  return chunks
}

function splitSentences(paragraph: string, language?: string): string[] {
  const protectedParagraph = sentenceAbbreviationsForLanguage(language).reduce(
    (value, abbreviation) => value.replaceAll(abbreviation, abbreviation.replaceAll(".", "<dot>")),
    paragraph
  )
  return protectedParagraph
    .split(/(?<=[.!?…])\s+/)
    .map((sentence) => sentence.replaceAll("<dot>", ".").trim())
    .filter(Boolean)
}

function hasSpeakableText(text: string): boolean {
  return [...sanitizeReadableText(text).matchAll(/[\p{L}\p{N}]/gu)].length >= 2
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => htmlEntities[name] ?? match)
}

function fromCodePoint(code: number): string {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ""
}

export function neutralProsodyFor(text: string): NarrationProsody {
  const trimmed = text.trim()
  if (trimmed.endsWith("?")) {
    return {
      emotion: "warm",
      intensity: 0.25,
      pace: "normal",
      pitch: "neutral",
      pauseBeforeMs: 0,
      pauseAfterMs: 420,
      instructionPtBr: "Tom claro, com leve inflexão interrogativa."
    }
  }
  if (trimmed.endsWith("!")) {
    return {
      emotion: "tense",
      intensity: 0.35,
      pace: "normal",
      pitch: "neutral",
      pauseBeforeMs: 0,
      pauseAfterMs: 450,
      instructionPtBr: "Energia moderada, sem exagero dramático."
    }
  }
  return {
    emotion: "neutral",
    intensity: 0.2,
    pace: "normal",
    pitch: "neutral",
    pauseBeforeMs: 0,
    pauseAfterMs: trimmed.endsWith(":") ? 500 : 350,
    instructionPtBr: "Tom calmo, narração clara, sem exagero."
  }
}

export function voiceRoleFor(text: string): VoiceRole {
  const trimmed = text.trim()
  if (trimmed.startsWith("—") || trimmed.startsWith("- ")) {
    return "dialogue"
  }
  if (trimmed.length < 90 && trimmed === trimmed.toLocaleUpperCase("pt-BR") && /[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(trimmed)) {
    return "heading"
  }
  return "narrator"
}

function normalizationOptionsFrom(input: SegmentTextForTtsInput): TtsNormalizationOptions {
  return Array.isArray(input) ? { pronunciationEntries: input } : input
}
