import { describe, expect, it } from "vitest"
import { AUDIOBOOK_INTRO_CHAPTER_HREF } from "../../src/shared/audiobook-intro"
import { audioChaptersForBook } from "../../src/renderer/lib/audioChapters"
import type { BookDetails } from "../../src/renderer/types"

describe("audioChaptersForBook", () => {
  it("prepends an audiobook intro item with title, author, and publication year", () => {
    const chapters = audioChaptersForBook(book())

    expect(chapters.map((chapter) => chapter.id)).toEqual([
      AUDIOBOOK_INTRO_CHAPTER_HREF,
      "chapter-1",
      "chapter-2"
    ])
    expect(chapters[0]).toMatchObject({
      position: 0,
      text: "Livro - Autora - 1968",
      title: "Livro - Autora - 1968"
    })
  })
})

function book(): BookDetails {
  return {
    id: "book-1",
    title: "Livro",
    authors: ["Autora"],
    language: "pt-BR",
    format: "epub",
    status: "unread",
    progress: 0,
    tags: [],
    publishedAt: "1968-01-01",
    updatedAt: "2026-06-06T12:00:00.000Z",
    coverColor: "#111827",
    chapters: [
      { id: "chapter-1", title: "Um", position: 1, text: "Primeiro" },
      { id: "chapter-2", title: "Dois", position: 2, text: "Segundo" }
    ]
  }
}
