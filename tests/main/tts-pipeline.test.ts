import { describe, expect, it } from "vitest"
import { buildNarrationPlan, dictionaryVersionFor, limitParagraphs, normalizePtBr, segmentTextForTts } from "../../src/main/services/tts-pipeline"

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
