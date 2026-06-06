import { describe, expect, it } from "vitest"
import { findAnnotationRanges, findOverlappingAnnotations, resolveAnnotationPlacements } from "../../src/renderer/lib/annotations"
import type { Annotation } from "../../src/renderer/types"

const paragraphs = [
  "Embora meu ambiente difira, posso lhe assegurar que ele é tão vívido.",
  "Minha existência presente é a mais desafiadora que conheço e conheço muitas."
]

function annotation(overrides: Partial<Annotation>): Annotation {
  return {
    id: "a1",
    bookId: "book-1",
    chapterId: "chapter-1",
    kind: "highlight",
    color: "yellow",
    excerpt: "que",
    note: "",
    createdAt: "2026-06-06T12:00:00.000Z",
    ...overrides
  }
}

describe("resolveAnnotationPlacements", () => {
  it("anchors a repeated word to its exact paragraph and occurrence", () => {
    // "que" appears in both paragraphs; the anchor pins this one to paragraph 1.
    const offset = paragraphs[1].indexOf("que")
    const placements = resolveAnnotationPlacements(
      [annotation({ id: "a1", anchorParagraphIndex: 1, anchorTextOffset: offset })],
      paragraphs
    )

    const placement = placements.get("a1")
    expect(placement).toEqual({ paragraphIndex: 1, start: offset, end: offset + 3 })
  })

  it("keeps two highlights of the same word in their own paragraphs", () => {
    const offset0 = paragraphs[0].indexOf("que")
    const offset1 = paragraphs[1].indexOf("que")
    const placements = resolveAnnotationPlacements(
      [
        annotation({ id: "a0", anchorParagraphIndex: 0, anchorTextOffset: offset0 }),
        annotation({ id: "a1", anchorParagraphIndex: 1, anchorTextOffset: offset1 })
      ],
      paragraphs
    )

    expect(placements.get("a0")?.paragraphIndex).toBe(0)
    expect(placements.get("a1")?.paragraphIndex).toBe(1)
  })

  it("falls back to the first matching paragraph for legacy annotations without an anchor", () => {
    const placements = resolveAnnotationPlacements([annotation({ id: "legacy" })], paragraphs)
    const placement = placements.get("legacy")
    expect(placement?.paragraphIndex).toBe(0)
    expect(placement).toEqual({ paragraphIndex: 0, start: paragraphs[0].indexOf("que"), end: paragraphs[0].indexOf("que") + 3 })
  })

  it("re-finds the quote near a drifted offset", () => {
    const realOffset = paragraphs[1].indexOf("que")
    const placements = resolveAnnotationPlacements(
      [annotation({ id: "a1", anchorParagraphIndex: 1, anchorTextOffset: realOffset + 5 })],
      paragraphs
    )
    expect(placements.get("a1")?.start).toBe(realOffset)
  })
})

describe("findAnnotationRanges", () => {
  it("returns ranges only for the requested paragraph", () => {
    const placements = resolveAnnotationPlacements(
      [
        annotation({ id: "a0", anchorParagraphIndex: 0, anchorTextOffset: paragraphs[0].indexOf("que") }),
        annotation({ id: "a1", anchorParagraphIndex: 1, anchorTextOffset: paragraphs[1].indexOf("que") })
      ],
      paragraphs
    )

    const annotations = [
      annotation({ id: "a0", anchorParagraphIndex: 0 }),
      annotation({ id: "a1", anchorParagraphIndex: 1 })
    ]

    const ranges0 = findAnnotationRanges(0, annotations, placements)
    expect(ranges0.map((range) => range.annotation.id)).toEqual(["a0"])

    const ranges1 = findAnnotationRanges(1, annotations, placements)
    expect(ranges1.map((range) => range.annotation.id)).toEqual(["a1"])
  })

  it("drops overlapping ranges, keeping the first/longest", () => {
    const placements = new Map([
      ["short", { paragraphIndex: 0, start: 4, end: 7 }],
      ["long", { paragraphIndex: 0, start: 4, end: 12 }]
    ])
    const annotations = [annotation({ id: "long" }), annotation({ id: "short" })]

    const ranges = findAnnotationRanges(0, annotations, placements)
    expect(ranges).toHaveLength(1)
    expect(ranges[0].annotation.id).toBe("long")
  })
})

describe("findOverlappingAnnotations", () => {
  it("does not flag the same word highlighted in a different paragraph", () => {
    // Regression: marking "que" in paragraph 1 must not delete the "que" in 0.
    const existing = annotation({ id: "a0", anchorParagraphIndex: 0, anchorTextOffset: paragraphs[0].indexOf("que") })
    const offset1 = paragraphs[1].indexOf("que")

    const overlapping = findOverlappingAnnotations(
      { paragraphIndex: 1, start: offset1, end: offset1 + 3 },
      [existing],
      paragraphs
    )

    expect(overlapping).toEqual([])
  })

  it("flags an existing highlight whose range intersects in the same paragraph", () => {
    const offset = paragraphs[0].indexOf("que")
    const existing = annotation({ id: "a0", anchorParagraphIndex: 0, anchorTextOffset: offset })

    const overlapping = findOverlappingAnnotations(
      { paragraphIndex: 0, start: offset - 1, end: offset + 2 },
      [existing],
      paragraphs
    )

    expect(overlapping.map((item) => item.id)).toEqual(["a0"])
  })

  it("returns nothing when the selection has no paragraph anchor", () => {
    const existing = annotation({ id: "a0", anchorParagraphIndex: 0, anchorTextOffset: paragraphs[0].indexOf("que") })
    expect(findOverlappingAnnotations({ start: 0, end: 3 }, [existing], paragraphs)).toEqual([])
  })
})
