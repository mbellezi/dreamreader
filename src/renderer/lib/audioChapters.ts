import {
  AUDIOBOOK_INTRO_CHAPTER_HREF,
  buildAudiobookIntroTitle
} from "@shared/audiobook-intro"
import type { BookDetails, Chapter } from "@renderer/types"

export function audioChaptersForBook(book: BookDetails | null): Chapter[] {
  if (!book) {
    return []
  }
  return [audiobookIntroChapter(book), ...book.chapters]
}

export function audiobookIntroChapter(book: BookDetails): Chapter {
  const text = buildAudiobookIntroTitle(book)
  return {
    id: AUDIOBOOK_INTRO_CHAPTER_HREF,
    title: text,
    position: 0,
    text,
    blocks: [{ type: "paragraph", text }]
  }
}
