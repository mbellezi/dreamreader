import type { PronunciationEntry } from "@shared/contracts/ai"
import { hashBuffer } from "@main/lib/hash"

export const NORMALIZER_ID = "basic-multilingual-normalizer"
export const NORMALIZER_VERSION = "2.0.0"
export const DICTIONARY_VERSION = "builtin-multilingual-v1"

export type TtsNormalizationOptions = {
  language?: string
  pronunciationEntries?: PronunciationEntry[]
}

type AbbreviationRule = {
  pattern: string
  replacement?: string
}

type TtsNormalizer = {
  aliases: string[]
  abbreviations: AbbreviationRule[]
  language: string
  normalize: (text: string, entries: PronunciationEntry[]) => string
}

const genericAbbreviations: AbbreviationRule[] = [
  stripOnly("Dr."),
  stripOnly("Dra."),
  stripOnly("Mr."),
  stripOnly("Mrs."),
  stripOnly("Ms."),
  stripOnly("Prof."),
  stripOnly("Sr."),
  stripOnly("Sra."),
  stripOnly("Jr."),
  stripOnly("St."),
  stripOnly("Fig."),
  stripOnly("Ch."),
  stripOnly("Vol."),
  stripOnly("No."),
  stripOnly("etc."),
  stripOnly("vs."),
  stripOnly("e.g."),
  stripOnly("i.e.")
]

const ptBrAbbreviations: AbbreviationRule[] = [
  abbreviation("Dr.", "doutor"),
  abbreviation("Dra.", "doutora"),
  abbreviation("Sr.", "senhor"),
  abbreviation("Sra.", "senhora"),
  abbreviation("Srs.", "senhores"),
  abbreviation("Sras.", "senhoras"),
  abbreviation("Prof.", "professor"),
  abbreviation("Profa.", "professora"),
  abbreviation("Eng.", "engenheiro"),
  abbreviation("Arq.", "arquiteto"),
  abbreviation("Pe.", "padre"),
  abbreviation("Sto.", "santo"),
  abbreviation("Sta.", "santa"),
  abbreviation("Av.", "avenida"),
  abbreviation("R.", "rua"),
  abbreviation("cap.", "capítulo"),
  abbreviation("pág.", "página"),
  abbreviation("ex.", "exemplo"),
  abbreviation("p.ex.", "por exemplo"),
  abbreviation("etc.", "etcetera")
]

const enAbbreviations: AbbreviationRule[] = [
  abbreviation("Dr.", "doctor"),
  abbreviation("Mr.", "mister"),
  abbreviation("Mrs.", "misses"),
  abbreviation("Ms.", "miz"),
  abbreviation("Prof.", "professor"),
  abbreviation("Jr.", "junior"),
  abbreviation("Sr.", "senior"),
  abbreviation("Rev.", "reverend"),
  abbreviation("Gen.", "general"),
  abbreviation("Col.", "colonel"),
  abbreviation("Capt.", "captain"),
  abbreviation("Lt.", "lieutenant"),
  abbreviation("Sgt.", "sergeant"),
  abbreviation("Hon.", "honorable"),
  abbreviation("Gov.", "governor"),
  abbreviation("Pres.", "president"),
  abbreviation("Sen.", "senator"),
  abbreviation("Rep.", "representative"),
  abbreviation("Fig.", "figure"),
  abbreviation("Ch.", "chapter"),
  abbreviation("Vol.", "volume"),
  abbreviation("No.", "number"),
  abbreviation("vs.", "versus"),
  abbreviation("etc.", "et cetera"),
  abbreviation("e.g.", "for example"),
  abbreviation("i.e.", "that is")
]

const esAbbreviations: AbbreviationRule[] = [
  abbreviation("Dr.", "doctor"),
  abbreviation("Dra.", "doctora"),
  abbreviation("Sr.", "señor"),
  abbreviation("Sra.", "señora"),
  abbreviation("Sres.", "señores"),
  abbreviation("Sras.", "señoras"),
  abbreviation("Prof.", "profesor"),
  abbreviation("Profa.", "profesora"),
  abbreviation("Ing.", "ingeniero"),
  abbreviation("Arq.", "arquitecto"),
  abbreviation("Av.", "avenida"),
  abbreviation("pág.", "página"),
  abbreviation("cap.", "capítulo"),
  abbreviation("ej.", "ejemplo"),
  abbreviation("etc.", "etcétera")
]

const frAbbreviations: AbbreviationRule[] = [
  abbreviation("Dr.", "docteur"),
  abbreviation("Dre.", "docteure"),
  abbreviation("M.", "monsieur"),
  abbreviation("Mme.", "madame"),
  abbreviation("Mlle.", "mademoiselle"),
  abbreviation("Pr.", "professeur"),
  abbreviation("Prof.", "professeur"),
  abbreviation("St.", "saint"),
  abbreviation("Ste.", "sainte"),
  abbreviation("av.", "avenue"),
  abbreviation("chap.", "chapitre"),
  abbreviation("p.", "page"),
  abbreviation("ex.", "exemple"),
  abbreviation("etc.", "et cetera")
]

const deAbbreviations: AbbreviationRule[] = [
  abbreviation("Dr.", "Doktor"),
  abbreviation("Prof.", "Professor"),
  abbreviation("Hr.", "Herr"),
  abbreviation("Fr.", "Frau"),
  abbreviation("bzw.", "beziehungsweise"),
  abbreviation("z.B.", "zum Beispiel"),
  abbreviation("bspw.", "beispielsweise"),
  abbreviation("ca.", "circa"),
  abbreviation("Nr.", "Nummer"),
  abbreviation("Abb.", "Abbildung"),
  abbreviation("Kap.", "Kapitel"),
  abbreviation("usw.", "und so weiter")
]

const itAbbreviations: AbbreviationRule[] = [
  abbreviation("Dott.", "dottore"),
  abbreviation("Dott.ssa.", "dottoressa"),
  abbreviation("Sig.", "signor"),
  abbreviation("Sig.ra.", "signora"),
  abbreviation("Prof.", "professore"),
  abbreviation("Prof.ssa.", "professoressa"),
  abbreviation("Ing.", "ingegnere"),
  abbreviation("Avv.", "avvocato"),
  abbreviation("cap.", "capitolo"),
  abbreviation("pag.", "pagina"),
  abbreviation("es.", "esempio"),
  abbreviation("ecc.", "eccetera")
]

const nlAbbreviations: AbbreviationRule[] = [
  abbreviation("dr.", "doctor"),
  abbreviation("dhr.", "de heer"),
  abbreviation("mw.", "mevrouw"),
  abbreviation("prof.", "professor"),
  abbreviation("bijv.", "bijvoorbeeld"),
  abbreviation("nr.", "nummer"),
  abbreviation("hfdst.", "hoofdstuk"),
  abbreviation("enz.", "enzovoort")
]

const daNoAbbreviations: AbbreviationRule[] = [
  abbreviation("Dr.", "doktor"),
  abbreviation("Prof.", "professor"),
  abbreviation("Hr.", "herr"),
  abbreviation("Fr.", "fru"),
  abbreviation("f.eks.", "for eksempel"),
  abbreviation("nr.", "nummer"),
  abbreviation("kap.", "kapittel"),
  abbreviation("osv.", "og så videre")
]

const svAbbreviations: AbbreviationRule[] = [
  abbreviation("Dr.", "doktor"),
  abbreviation("Prof.", "professor"),
  abbreviation("Hr.", "herr"),
  abbreviation("Fr.", "fru"),
  abbreviation("t.ex.", "till exempel"),
  abbreviation("nr.", "nummer"),
  abbreviation("kap.", "kapitel"),
  abbreviation("osv.", "och så vidare")
]

const fiAbbreviations: AbbreviationRule[] = [
  abbreviation("tri.", "tohtori"),
  abbreviation("prof.", "professori"),
  abbreviation("hra.", "herra"),
  abbreviation("rva.", "rouva"),
  abbreviation("esim.", "esimerkiksi"),
  abbreviation("nro.", "numero"),
  abbreviation("luku.", "luku"),
  abbreviation("jne.", "ja niin edelleen")
]

const plAbbreviations: AbbreviationRule[] = [
  abbreviation("dr.", "doktor"),
  abbreviation("prof.", "profesor"),
  abbreviation("p.", "pan"),
  abbreviation("np.", "na przykład"),
  abbreviation("nr.", "numer"),
  abbreviation("rozdz.", "rozdział"),
  abbreviation("itd.", "i tak dalej")
]

const ruAbbreviations: AbbreviationRule[] = [
  abbreviation("д-р.", "доктор"),
  abbreviation("проф.", "профессор"),
  abbreviation("г-н.", "господин"),
  abbreviation("г-жа.", "госпожа"),
  abbreviation("напр.", "например"),
  abbreviation("стр.", "страница"),
  abbreviation("гл.", "глава"),
  abbreviation("т.д.", "так далее")
]

const trAbbreviations: AbbreviationRule[] = [
  abbreviation("Dr.", "doktor"),
  abbreviation("Prof.", "profesör"),
  abbreviation("Sn.", "sayın"),
  abbreviation("Av.", "avukat"),
  abbreviation("örn.", "örneğin"),
  abbreviation("no.", "numara"),
  abbreviation("bl.", "bölüm"),
  abbreviation("vb.", "ve benzeri")
]

const normalizers: TtsNormalizer[] = [
  createNormalizer("pt-BR", ["pt", "pt-br", "pt_br", "portuguese", "brazilian portuguese", "br"], ptBrAbbreviations, normalizePtBrCore),
  createNormalizer("en", ["en", "en-us", "en-gb", "english"], enAbbreviations),
  createNormalizer("es", ["es", "es-es", "spanish"], esAbbreviations),
  createNormalizer("fr", ["fr", "fr-fr", "french"], frAbbreviations),
  createNormalizer("de", ["de", "de-de", "german"], deAbbreviations),
  createNormalizer("it", ["it", "it-it", "italian"], itAbbreviations),
  createNormalizer("ja", ["ja", "ja-jp", "japanese"], genericAbbreviations),
  createNormalizer("ko", ["ko", "ko-kr", "korean"], genericAbbreviations),
  createNormalizer("zh", ["zh", "zh-cn", "zh-tw", "chinese"], genericAbbreviations),
  createNormalizer("ar", ["ar", "ar-sa", "arabic"], genericAbbreviations),
  createNormalizer("da", ["da", "da-dk", "danish"], daNoAbbreviations),
  createNormalizer("el", ["el", "el-gr", "greek"], genericAbbreviations),
  createNormalizer("fi", ["fi", "fi-fi", "finnish"], fiAbbreviations),
  createNormalizer("he", ["he", "he-il", "hebrew"], genericAbbreviations),
  createNormalizer("hi", ["hi", "hi-in", "hindi"], genericAbbreviations),
  createNormalizer("ms", ["ms", "ms-my", "malay"], genericAbbreviations),
  createNormalizer("nl", ["nl", "nl-nl", "dutch"], nlAbbreviations),
  createNormalizer("no", ["no", "nb", "nn", "no-no", "norwegian"], daNoAbbreviations),
  createNormalizer("pl", ["pl", "pl-pl", "polish"], plAbbreviations),
  createNormalizer("ru", ["ru", "ru-ru", "russian"], ruAbbreviations),
  createNormalizer("sv", ["sv", "sv-se", "swedish"], svAbbreviations),
  createNormalizer("sw", ["sw", "sw-ke", "swahili"], genericAbbreviations),
  createNormalizer("tr", ["tr", "tr-tr", "turkish"], trAbbreviations)
]

const normalizerByAlias = new Map<string, TtsNormalizer>()
for (const normalizer of normalizers) {
  normalizerByAlias.set(normalizeLanguageAlias(normalizer.language), normalizer)
  for (const alias of normalizer.aliases) {
    normalizerByAlias.set(normalizeLanguageAlias(alias), normalizer)
  }
}

export function normalizeForTts(text: string, options: TtsNormalizationOptions = {}): string {
  const normalizer = normalizerForLanguage(options.language)
  return normalizer.normalize(text, options.pronunciationEntries ?? [])
}

export function normalizePtBr(text: string, pronunciationEntries: PronunciationEntry[] = []): string {
  return normalizeForTts(text, { language: "pt-BR", pronunciationEntries })
}

export function normalizerMetadataForLanguage(language?: string): { id: string; language: string; version: string } {
  return {
    id: NORMALIZER_ID,
    language: normalizerForLanguage(language).language,
    version: NORMALIZER_VERSION
  }
}

export function canonicalTtsLanguage(language?: string): string {
  return normalizerForLanguage(language).language
}

export function sentenceAbbreviationsForLanguage(language?: string): string[] {
  return uniqueStrings([
    ...normalizerForLanguage(language).abbreviations.map((item) => item.pattern),
    ...genericAbbreviations.map((item) => item.pattern)
  ])
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
      return current.replace(expression, (_match, prefix: string) => {
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

export function sanitizeReadableText(text: string): string {
  return removeAudiobookReferenceMarkers(text)
    .normalize("NFC")
    .replace(/\u00ad/g, "")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, "")
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
    return underThousandPtBr(integer)
  }
  if (integer < 1_000_000) {
    const thousands = Math.floor(integer / 1000)
    const rest = integer % 1000
    const thousandText = thousands === 1 ? "mil" : `${underThousandPtBr(thousands)} mil`
    return rest ? [thousandText, joinerForPtBr(rest), underThousandPtBr(rest)].filter(Boolean).join(" ") : thousandText
  }
  return String(value)
}

function createNormalizer(
  language: string,
  aliases: string[],
  abbreviations: AbbreviationRule[],
  coreNormalize: (text: string) => string = (text) => text
): TtsNormalizer {
  const allAbbreviations = uniqueAbbreviations([...abbreviations, ...genericAbbreviations])
  return {
    aliases,
    abbreviations: allAbbreviations,
    language,
    normalize: (text, entries) => {
      let normalized = sanitizeReadableText(text)
      normalized = coreNormalize(normalized)
      normalized = normalizeAbbreviations(normalized, allAbbreviations)
      normalized = normalizeInlineAbbreviationPeriods(normalized)
      normalized = applyPronunciationEntries(normalized, entries)
      return normalized.replace(/\s+/g, " ").trim()
    }
  }
}

function normalizePtBrCore(text: string): string {
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
    const monthName = ptBrMonthNames[monthIndex]
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

  return normalized
}

function normalizeAbbreviations(text: string, abbreviations: AbbreviationRule[]): string {
  return abbreviations.reduce((current, abbreviationRule) => {
    const escaped = escapeRegExp(abbreviationRule.pattern)
    const expression = new RegExp(`(^|[^\\p{L}\\p{N}_])(${escaped})(?=$|[^\\p{L}\\p{N}_])`, "giu")
    return current.replace(expression, (_match, prefix: string, value: string) => {
      return `${prefix}${abbreviationRule.replacement ?? removeAbbreviationPeriods(value)}`
    })
  }, text)
}

function normalizeInlineAbbreviationPeriods(text: string): string {
  return text
    .replace(/\b((?:\p{Lu}\.){2,})(?=\s+[\p{L}\p{N}])/gu, (value) => removeAbbreviationPeriods(value))
    .replace(/\b(\p{Lu})\.(?=\s+\p{Lu}\b)/gu, "$1")
    .replace(/\b([\p{Lu}][\p{L}]{0,4})\.(?=\s+[\p{L}\p{N}])/gu, (_match, value: string) => value)
}

function removeAudiobookReferenceMarkers(text: string): string {
  return text
    .replace(/\s*\[\s*(?:\.{3}|…)\s*\]\s*/g, ". ")
    .replace(/\s*\[[^\]\r\n]{1,120}\]\s*/g, " ")
    .replace(/[^\S\n]+([,.;:!?])/g, "$1")
    .replace(/([.!?])\s+([.!?])/g, "$1")
}

function normalizerForLanguage(language?: string): TtsNormalizer {
  return normalizerByAlias.get(normalizeLanguageAlias(language)) ?? normalizerByAlias.get("pt-br") ?? normalizers[0]
}

function normalizeLanguageAlias(language?: string): string {
  const normalized = String(language ?? "").trim().toLocaleLowerCase("en-US").replace(/_/g, "-")
  if (!normalized || normalized === "auto") {
    return "pt-br"
  }
  if (normalized.startsWith("pt")) {
    return "pt-br"
  }
  if (normalized.startsWith("zh")) {
    return "zh"
  }
  return normalized
}

function abbreviation(pattern: string, replacement: string): AbbreviationRule {
  return { pattern, replacement }
}

function stripOnly(pattern: string): AbbreviationRule {
  return { pattern }
}

function removeAbbreviationPeriods(value: string): string {
  return value.replace(/\./g, "")
}

function uniqueAbbreviations(abbreviations: AbbreviationRule[]): AbbreviationRule[] {
  const seen = new Set<string>()
  return abbreviations.filter((item) => {
    const key = item.pattern.toLocaleLowerCase("en-US")
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function normalizeYear(value: number): number {
  if (value < 100) {
    return value >= 50 ? 1900 + value : 2000 + value
  }
  return value
}

function underThousandPtBr(value: number): string {
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
  return rest ? `${hundreds[hundred]} e ${underThousandPtBr(rest)}` : hundreds[hundred]
}

function joinerForPtBr(rest: number): string {
  return rest < 100 || rest % 100 === 0 ? "e" : ""
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const ptBrMonthNames = [
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
