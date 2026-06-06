// Pure, DOM-free resolution of where each annotation highlight belongs.
//
// Annotations carry the quoted text plus a layout-independent anchor (the
// paragraph index and character offset of the selection start). Resolving by
// anchor — rather than by text match alone — is what lets a common word like
// "que" highlight the exact occurrence the reader marked instead of every match
// in the chapter. Legacy annotations saved before anchors existed fall back to
// the first paragraph containing the quote, so each annotation still renders once.

import type { Annotation } from "@renderer/types"
import { clamp } from "@renderer/lib/utils"

export type AnnotationPlacement = { paragraphIndex: number; start: number; end: number }

export function resolveAnnotationPlacements(annotations: Annotation[], paragraphs: string[]): Map<string, AnnotationPlacement> {
  const placements = new Map<string, AnnotationPlacement>()

  for (const annotation of annotations) {
    const quote = annotation.excerpt.trim()
    if (!quote) {
      continue
    }
    const lowerQuote = quote.toLocaleLowerCase()
    const anchorIndex = annotation.anchorParagraphIndex

    if (anchorIndex !== undefined && anchorIndex >= 0 && anchorIndex < paragraphs.length) {
      const paragraph = paragraphs[anchorIndex]
      const lower = paragraph.toLocaleLowerCase()
      const preferred = clamp(annotation.anchorTextOffset ?? 0, 0, paragraph.length)
      // Re-find the quote near the stored offset so the highlight survives minor
      // text drift; fall back to a global match, then to the raw offset.
      let start = lower.indexOf(lowerQuote, Math.max(preferred - 24, 0))
      if (start < 0) {
        start = lower.indexOf(lowerQuote)
      }
      if (start < 0) {
        start = preferred
      }
      placements.set(annotation.id, {
        paragraphIndex: anchorIndex,
        start,
        end: Math.min(start + quote.length, paragraph.length)
      })
      continue
    }

    for (let index = 0; index < paragraphs.length; index += 1) {
      const start = paragraphs[index].toLocaleLowerCase().indexOf(lowerQuote)
      if (start >= 0) {
        placements.set(annotation.id, { paragraphIndex: index, start, end: start + quote.length })
        break
      }
    }
  }

  return placements
}

// Existing annotations that genuinely overlap a new selection — i.e. live in the
// same paragraph AND share character range. Position-aware on purpose: marking a
// repeated word (e.g. "que") elsewhere must NOT match the earlier highlight of
// the same word, which would otherwise be deleted as a false "replace". Returns
// nothing when the selection has no paragraph anchor (overlap can't be proven).
export function findOverlappingAnnotations(
  selection: { paragraphIndex?: number; start: number; end: number },
  annotations: Annotation[],
  paragraphs: string[]
): Annotation[] {
  if (selection.paragraphIndex === undefined) {
    return []
  }
  const placements = resolveAnnotationPlacements(annotations, paragraphs)
  return annotations.filter((annotation) => {
    const placement = placements.get(annotation.id)
    return Boolean(
      placement &&
        placement.paragraphIndex === selection.paragraphIndex &&
        selection.start < placement.end &&
        selection.end > placement.start
    )
  })
}

// The accepted, non-overlapping highlight ranges for one paragraph, sorted by
// start. Overlaps are dropped (first/longest wins) so nested marks never clash.
export function findAnnotationRanges(
  paragraphIndex: number,
  annotations: Annotation[],
  placements: Map<string, AnnotationPlacement>
): Array<{ annotation: Annotation; start: number; end: number }> {
  const ranges = annotations
    .map((annotation) => {
      const placement = placements.get(annotation.id)
      return placement && placement.paragraphIndex === paragraphIndex
        ? { annotation, start: placement.start, end: placement.end }
        : null
    })
    .filter((range): range is { annotation: Annotation; start: number; end: number } => Boolean(range))
    .sort((first, second) => first.start - second.start || second.end - first.end)

  const accepted: Array<{ annotation: Annotation; start: number; end: number }> = []
  for (const range of ranges) {
    if (!accepted.some((item) => range.start < item.end && range.end > item.start)) {
      accepted.push(range)
    }
  }
  return accepted
}
