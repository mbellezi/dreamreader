import type { NarrationPlan, NarrationProsody, NarrationSegment, VoiceRole } from "@shared/contracts/ai"
import { hashBuffer } from "@main/lib/hash"

export const NORMALIZER_ID = "pt-br-basic-normalizer"
export const NORMALIZER_VERSION = "1.0.0"
export const DICTIONARY_VERSION = "builtin-pt-br-v1"
export const PROSODY_ANALYZER_ID = "neutral-rule-prosody"
export const PROSODY_VERSION = "1.0.0"
export const NARRATION_PLAN_VERSION = "narration-plan/v1"

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
}

export function buildNarrationPlan(input: ChapterNarrationInput): NarrationPlan {
  const text = htmlToReadableText(input.html)
  const chunks = segmentTextForTts(text)
  const segments = chunks.map((chunk, index): NarrationSegment => {
    const segmentHash = hashBuffer(`${input.bookId}:${input.chapterHref}:${index}:${chunk}`)
    const normalizedText = normalizePtBr(chunk)
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
      dictionaryVersion: DICTIONARY_VERSION
    },
    prosody: {
      analyzerId: PROSODY_ANALYZER_ID,
      version: PROSODY_VERSION
    },
    segments
  }
}

export function htmlToReadableText(html: string): string {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<(p|div|section|article|h1|h2|h3|li)[^>]*>/gi, "\n\n")
    .replace(/<\/(p|div|section|article|h1|h2|h3|li)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[^\S\n]+\n/g, "\n")
    .replace(/\n[^\S\n]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function segmentTextForTts(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
  const segments: string[] = []

  for (const paragraph of paragraphs) {
    for (const sentence of splitSentences(paragraph)) {
      segments.push(...splitLongSentence(sentence))
    }
  }

  return segments.length ? segments : [text.replace(/\s+/g, " ").trim()].filter(Boolean)
}

function splitLongSentence(sentence: string): string[] {
  if (sentence.length <= 420) {
    return [sentence]
  }
  const words = sentence.split(/\s+/)
  const chunks: string[] = []
  let current = ""
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > 420 && current) {
      chunks.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) {
    chunks.push(current)
  }
  return chunks
}

export function normalizePtBr(text: string): string {
  let normalized = text

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

  return normalized.replace(/\s+/g, " ").trim()
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
