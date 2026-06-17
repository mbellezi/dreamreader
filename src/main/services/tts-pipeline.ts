import type { NarrationPlan, NarrationProsody, NarrationSegment, PronunciationEntry, VoiceRole } from "@shared/contracts/ai"
import { hashBuffer } from "@main/lib/hash"

export const NORMALIZER_ID = "pt-br-basic-normalizer"
export const NORMALIZER_VERSION = "1.1.3"
export const DICTIONARY_VERSION = "builtin-pt-br-v1"
export const PROSODY_ANALYZER_ID = "neutral-rule-prosody"
export const PROSODY_VERSION = "1.0.0"
export const NARRATION_PLAN_VERSION = "narration-plan/v1"
export const MAX_TTS_SEGMENT_CHARS = 420

const commonAbbreviations: Record<string, string> = {
  "Dr.": "doutor",
  "Dra.": "doutora",
  "Sr.": "senhor",
  "Sra.": "senhora",
  "Srs.": "senhores",
  "Prof.": "professor",
  "Profa.": "professora",
  "etc.": "etcetera"
}

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

const monthNames = [
  "",
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro"
]

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

export function buildNarrationPlan(input: ChapterNarrationInput): NarrationPlan {
  const fullText = htmlToReadableText(input.html)
  const text = input.paragraphLimit ? limitParagraphs(fullText, input.paragraphLimit) : fullText
  const chunks = segmentTextForTts(text, input.pronunciationEntries)
  const dictionaryVersion = dictionaryVersionFor(input.pronunciationEntries ?? [])
  const segments = chunks.map((chunk, index): NarrationSegment => {
    const segmentHash = hashBuffer(`${input.bookId}:${input.chapterHref}:${index}:${chunk}`)
    const normalizedText = normalizePtBr(chunk, input.pronunciationEntries)
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
      language: input.language
    },
    normalization: {
      normalizerId: NORMALIZER_ID,
      version: NORMALIZER_VERSION,
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

export function segmentTextForTts(text: string, pronunciationEntries: PronunciationEntry[] = []): string[] {
  const paragraphs = sanitizeReadableText(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(hasSpeakableText)
  const segments: string[] = []

  for (const paragraph of paragraphs) {
    segments.push(...chunkSentencesForTts(splitSentences(paragraph), pronunciationEntries))
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
function fitsTtsLimit(text: string, pronunciationEntries: PronunciationEntry[]): boolean {
  return (
    text.length <= MAX_TTS_SEGMENT_CHARS && normalizePtBr(text, pronunciationEntries).length <= MAX_TTS_SEGMENT_CHARS
  )
}

function splitOversizedWord(word: string, pronunciationEntries: PronunciationEntry[]): string[] {
  const pieces: string[] = []
  let rest = word
  while (rest.length > 0) {
    let piece = rest.slice(0, MAX_TTS_SEGMENT_CHARS)
    while (piece.length > 1 && !fitsTtsLimit(piece, pronunciationEntries)) {
      piece = piece.slice(0, Math.ceil(piece.length / 2))
    }
    pieces.push(piece)
    rest = rest.slice(piece.length)
  }
  return pieces
}

function splitLongSentence(sentence: string, pronunciationEntries: PronunciationEntry[]): string[] {
  if (fitsTtsLimit(sentence, pronunciationEntries)) {
    return [sentence]
  }
  const words = sentence.split(/\s+/)
  const chunks: string[] = []
  let current = ""
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (fitsTtsLimit(candidate, pronunciationEntries)) {
      current = candidate
      continue
    }
    if (current) {
      chunks.push(current)
      current = ""
    }
    if (fitsTtsLimit(word, pronunciationEntries)) {
      current = word
    } else {
      chunks.push(...splitOversizedWord(word, pronunciationEntries))
    }
  }
  if (current) {
    chunks.push(current)
  }
  return chunks
}

function chunkSentencesForTts(sentences: string[], pronunciationEntries: PronunciationEntry[]): string[] {
  const chunks: string[] = []
  let current = ""

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence
    if (fitsTtsLimit(candidate, pronunciationEntries)) {
      current = candidate
      continue
    }
    if (current) {
      chunks.push(...splitLongSentence(current, pronunciationEntries))
    }
    current = sentence
  }

  if (current) {
    chunks.push(...splitLongSentence(current, pronunciationEntries))
  }
  return chunks
}

export function normalizePtBr(text: string, pronunciationEntries: PronunciationEntry[] = []): string {
  let normalized = sanitizeReadableText(text)

  normalized = normalized.replace(/\bR\$\s*(\d{1,6})(?:,(\d{2}))?\b/g, (_match, reais: string, centavos: string | undefined) => {
    const realCount = Number(reais)
    const centCount = Number(centavos ?? 0)
    const realLabel = realCount === 1 ? "real" : "reais"
    const centsLabel = centCount === 1 ? "centavo" : "centavos"
    const realText = `${numberToPtBr(realCount)} ${realLabel}`
    return centCount > 0 ? `${realText} e ${numberToPtBr(centCount)} ${centsLabel}` : realText
  })

  normalized = normalized.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g, (_match, day: string, month: string, year: string) => {
    const monthIndex = Number(month)
    const monthName = monthNames[monthIndex]
    if (!monthName) {
      return _match
    }
    return `${numberToPtBr(Number(day))} de ${monthName} de ${numberToPtBr(normalizeYear(Number(year)))}`
  })

  normalized = normalized.replace(/\b(\d{1,2})h(?:(\d{2}))?\b/gi, (_match, hours: string, minutes: string | undefined) => {
    const hourCount = Number(hours)
    const minuteCount = Number(minutes ?? 0)
    const hourLabel = hourCount === 1 ? "hora" : "horas"
    if (!minuteCount) {
      return `${numberToPtBr(hourCount)} ${hourLabel}`
    }
    const minuteLabel = minuteCount === 1 ? "minuto" : "minutos"
    return `${numberToPtBr(hourCount)} ${hourLabel} e ${numberToPtBr(minuteCount)} ${minuteLabel}`
  })

  normalized = normalized.replace(/\b(\d{1,3})%/g, (_match, value: string) => `${numberToPtBr(Number(value))} por cento`)

  for (const [abbreviation, replacement] of Object.entries(commonAbbreviations)) {
    normalized = normalized.replace(new RegExp(`\\b${escapeRegExp(abbreviation)}`, "g"), replacement)
  }

  normalized = applyPronunciationEntries(normalized, pronunciationEntries)

  return normalized.replace(/\s+/g, " ").trim()
}

export function dictionaryVersionFor(pronunciationEntries: PronunciationEntry[] = []): string {
  if (!pronunciationEntries.length) {
    return DICTIONARY_VERSION
  }
  const signature = pronunciationEntries
    .map((entry) =>
      [entry.scope, entry.bookId ?? "", entry.pattern, entry.replacement, entry.matchKind, entry.caseSensitive ? "1" : "0"].join(":")
    )
    .sort()
    .join("\n")
  return `${DICTIONARY_VERSION}:${hashBuffer(signature).slice(0, 12)}`
}

export function applyPronunciationEntries(text: string, pronunciationEntries: PronunciationEntry[]): string {
  return pronunciationEntries.reduce((current, entry) => {
    if (!entry.pattern.trim()) {
      return current
    }
    try {
      const flags = entry.caseSensitive ? "g" : "gi"
      if (entry.matchKind === "regex") {
        return current.replace(new RegExp(entry.pattern, flags), entry.replacement)
      }
      const escaped = escapeRegExp(entry.pattern)
      const expression =
        entry.matchKind === "word"
          ? new RegExp(`(^|[^\\p{L}\\p{N}_])(${escaped})(?=$|[^\\p{L}\\p{N}_])`, `${flags}u`)
          : new RegExp(escaped, flags)
      return current.replace(expression, (match, prefix: string) => {
        if (entry.matchKind !== "word") {
          return entry.replacement
        }
        return `${prefix}${entry.replacement}`
      })
    } catch {
      return current
    }
  }, text)
}

function splitSentences(paragraph: string): string[] {
  const protectedParagraph = Object.keys(commonAbbreviations).reduce(
    (value, abbreviation) => value.replaceAll(abbreviation, abbreviation.replaceAll(".", "<dot>")),
    paragraph
  )
  return protectedParagraph
    .split(/(?<=[.!?…])\s+/)
    .map((sentence) => sentence.replaceAll("<dot>", ".").trim())
    .filter(Boolean)
}

function sanitizeReadableText(text: string): string {
  return removeAudiobookReferenceMarkers(text)
    .normalize("NFC")
    .replace(/\u00ad/g, "")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, "")
}

function removeAudiobookReferenceMarkers(text: string): string {
  return text
    .replace(/\s*\[\s*(?:\.{3}|…)\s*\]\s*/g, ". ")
    .replace(/\s*\[[^\]\r\n]{1,120}\]\s*/g, " ")
    .replace(/[^\S\n]+([,.;:!?])/g, "$1")
    .replace(/([.!?])\s+([.!?])/g, "$1")
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

function normalizeYear(value: number): number {
  if (value < 100) {
    return value >= 50 ? 1900 + value : 2000 + value
  }
  return value
}

export function numberToPtBr(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value)
  }
  const integer = Math.trunc(Math.abs(value))
  if (integer === 0) {
    return "zero"
  }
  if (integer < 0) {
    return `menos ${numberToPtBr(Math.abs(integer))}`
  }
  if (integer < 1000) {
    return underThousand(integer)
  }
  if (integer < 1_000_000) {
    const thousands = Math.floor(integer / 1000)
    const rest = integer % 1000
    const thousandText = thousands === 1 ? "mil" : `${underThousand(thousands)} mil`
    return rest ? [thousandText, joinerFor(rest), underThousand(rest)].filter(Boolean).join(" ") : thousandText
  }
  return String(value)
}

function underThousand(value: number): string {
  const units = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"]
  const teens = [
    "dez",
    "onze",
    "doze",
    "treze",
    "quatorze",
    "quinze",
    "dezesseis",
    "dezessete",
    "dezoito",
    "dezenove"
  ]
  const tens = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"]
  const hundreds = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"]

  if (value < 10) return units[value]
  if (value < 20) return teens[value - 10]
  if (value < 100) {
    const ten = Math.floor(value / 10)
    const unit = value % 10
    return unit ? `${tens[ten]} e ${units[unit]}` : tens[ten]
  }
  if (value === 100) return "cem"
  const hundred = Math.floor(value / 100)
  const rest = value % 100
  return rest ? `${hundreds[hundred]} e ${underThousand(rest)}` : hundreds[hundred]
}

function joinerFor(rest: number): string {
  return rest < 100 || rest % 100 === 0 ? "e" : ""
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
