import { describe, expect, it } from "vitest"
import {
  buildNarrationPlan,
  dictionaryVersionFor,
  limitParagraphs,
  MAX_TTS_SEGMENT_CHARS,
  normalizePtBr,
  segmentTextForTts
} from "../../src/main/services/tts-pipeline"

describe("TTS pipeline", () => {
  it("limits a narration plan to the first N paragraphs", () => {
    const html = "<article><p>Primeiro parágrafo.</p><p>Segundo parágrafo.</p><p>Terceiro parágrafo.</p><p>Quarto parágrafo.</p></article>"
    const full = buildNarrationPlan({ bookId: "b", chapterHref: "c", contentHash: "h", html, language: "pt-BR" })
    const partial = buildNarrationPlan({ bookId: "b", chapterHref: "c", contentHash: "h", html, language: "pt-BR", paragraphLimit: 1 })
    const threeParagraphs = buildNarrationPlan({ bookId: "b", chapterHref: "c", contentHash: "h", html, language: "pt-BR", paragraphLimit: 3 })

    expect(full.segments.length).toBeGreaterThan(partial.segments.length)
    expect(partial.segments).toHaveLength(1)
    expect(partial.segments[0].originalText).toContain("Primeiro")
    expect(threeParagraphs.segments).toHaveLength(3)
    expect(threeParagraphs.segments[2].originalText).toContain("Terceiro")
    expect(threeParagraphs.segments.some((segment) => segment.originalText.includes("Quarto"))).toBe(false)
  })

  it("limitParagraphs keeps only the requested leading paragraphs", () => {
    const text = "um\n\ndois\n\ntrês"
    expect(limitParagraphs(text, 2)).toBe("um\n\ndois")
    expect(limitParagraphs(text, 0)).toBe(text)
  })

  it("normalizes common PT-BR speech forms", () => {
    const normalized = normalizePtBr("Sr. João chegou em 06/06/2026 às 14h30. Custou R$ 25,90 e rendeu 12%.")

    expect(normalized).toContain("senhor João")
    expect(normalized).toContain("seis de junho de dois mil e vinte e seis")
    expect(normalized).toContain("quatorze horas e trinta minutos")
    expect(normalized).toContain("vinte e cinco reais e noventa centavos")
    expect(normalized).toContain("doze por cento")
  })

  it("segments readable chapter text into deterministic narration plan segments", () => {
    const plan = buildNarrationPlan({
      bookId: "book-1",
      chapterHref: "chapter-1",
      contentHash: "hash-1",
      html: "<article><h1>CAPÍTULO 1</h1><p>— Vamos sair? perguntou ela.</p><p>Ele respondeu com calma.</p></article>",
      language: "pt-BR"
    })

    expect(plan.schemaVersion).toBe("narration-plan/v1")
    expect(plan.segments.length).toBeGreaterThanOrEqual(3)
    expect(plan.segments[0].voiceRole).toBe("heading")
    expect(plan.segments.some((segment) => segment.voiceRole === "dialogue")).toBe(true)
  })

  it("keeps abbreviations together during sentence splitting", () => {
    expect(segmentTextForTts("O Dr. Silva chegou cedo. Depois saiu.")).toEqual([
      "O Dr. Silva chegou cedo. Depois saiu."
    ])
  })

  it("keeps short related sentences in one TTS segment", () => {
    const segments = segmentTextForTts(
      "Quando você lê as palavras nessa página, você percebe que a informação que está recebendo não é um atributo das letras das palavras em si mesmas. A linha impressa não contém informação. Ela transmite informação. Onde está a informação que está sendo transmitida, então, se não está na pagina?"
    )

    expect(segments).toHaveLength(1)
    expect(segments[0]).toContain("Ela transmite informação. Onde está a informação")
  })

  it("removes invisible EPUB control characters before TTS", () => {
    expect(segmentTextForTts("A infor\u00admação está\u200b aqui.")).toEqual(["A informação está aqui."])
  })

  it("keeps normalizedText within the TTS limit when normalization expands numbers", () => {
    const sentence = "O valor foi de R$ 999,99 em 25/12/1999 às 23h59 com 99% de desconto."
    const paragraph = Array.from({ length: 8 }, () => sentence).join(" ")
    expect(normalizePtBr(sentence).length).toBeGreaterThan(sentence.length)

    const plan = buildNarrationPlan({
      bookId: "b",
      chapterHref: "c",
      contentHash: "h",
      html: `<article><p>${paragraph}</p></article>`,
      language: "pt-BR"
    })

    expect(plan.segments.length).toBeGreaterThan(1)
    for (const segment of plan.segments) {
      expect(segment.normalizedText.length).toBeLessThanOrEqual(MAX_TTS_SEGMENT_CHARS)
    }
    expect(plan.segments.map((segment) => segment.originalText).join(" ")).toBe(paragraph)
  })

  it("accounts for pronunciation entry expansion when chunking", () => {
    const entry = {
      id: "pronunciation-1",
      scope: "global" as const,
      pattern: "X9",
      replacement: "xis nove da série especial limitada",
      matchKind: "word" as const,
      caseSensitive: false,
      createdAt: "2026-06-06T12:00:00.000Z",
      updatedAt: "2026-06-06T12:00:00.000Z"
    }
    const sentence = "O modelo X9 superou o X9 anterior e o X9 reserva em todos os testes do X9 base."
    const paragraph = Array.from({ length: 6 }, () => sentence).join(" ")

    const withoutEntries = segmentTextForTts(paragraph)
    const withEntries = segmentTextForTts(paragraph, [entry])

    expect(withEntries.length).toBeGreaterThan(withoutEntries.length)
    for (const segment of withEntries) {
      expect(normalizePtBr(segment, [entry]).length).toBeLessThanOrEqual(MAX_TTS_SEGMENT_CHARS)
    }
    expect(withEntries.join(" ")).toBe(paragraph)
  })

  it("splits a single oversized word without dropping characters", () => {
    const word = "x".repeat(1000)
    const segments = segmentTextForTts(`Antes. ${word} depois.`)

    for (const segment of segments) {
      expect(segment.length).toBeLessThanOrEqual(MAX_TTS_SEGMENT_CHARS)
    }
    expect(segments.join("")).toBe(`Antes. ${word} depois.`.replace(/\s+/g, ""))
  })

  it("preserves every word across paragraph chunking", () => {
    const sentence = "Era uma vez um leitor que ouvia capítulos inteiros sem perder uma única palavra do texto original."
    const paragraph = Array.from({ length: 12 }, () => sentence).join(" ")
    const segments = segmentTextForTts(paragraph)

    expect(segments.length).toBeGreaterThan(1)
    expect(segments.join(" ")).toBe(paragraph)
  })

  it("applies pronunciation entries and versions the dictionary in narration plans", () => {
    const entry = {
      id: "pronunciation-1",
      scope: "global" as const,
      pattern: "Qwen",
      replacement: "tchuen",
      matchKind: "word" as const,
      caseSensitive: false,
      createdAt: "2026-06-06T12:00:00.000Z",
      updatedAt: "2026-06-06T12:00:00.000Z"
    }
    const plan = buildNarrationPlan({
      bookId: "book-1",
      chapterHref: "chapter-1",
      contentHash: "hash-1",
      html: "<article><p>Qwen melhora a prosodia.</p></article>",
      language: "pt-BR",
      pronunciationEntries: [entry]
    })

    expect(plan.segments[0].normalizedText).toContain("tchuen melhora")
    expect(plan.normalization.dictionaryVersion).toBe(dictionaryVersionFor([entry]))
    expect(plan.normalization.dictionaryVersion).not.toBe(dictionaryVersionFor([]))
  })
})
