import { describe, expect, it } from "vitest"
import { htmlToPlainText, htmlToReaderBlocks } from "../../src/preload/reader-content"

describe("reader content parsing", () => {
  it("preserves inline-styled words and keeps EPUB images as reader blocks", () => {
    const blocks = htmlToReaderBlocks(
      `<article>
        <p>T<small>HERE</small> is a mushroom.</p>
        <p><img alt="Mushroom figure" src="image/pg_18-1.jpg"/></p>
        <p>After the image.</p>
      </article>`,
      { bookId: "book-1", chapterHref: "OEBPS/chapter01.xhtml" }
    )

    expect(blocks).toEqual([
      { type: "paragraph", text: "THERE is a mushroom." },
      {
        type: "image",
        alt: "Mushroom figure",
        src: "dreamreader://book-resource/book-1/OEBPS/image/pg_18-1.jpg"
      },
      { type: "paragraph", text: "After the image." }
    ])
  })

  it("plain text excludes image blocks without adding spaces inside words", () => {
    expect(htmlToPlainText("<p>T<small>HERE</small></p><p><img src=\"image/figure.jpg\"/></p><p>Next.</p>")).toBe("THERE\n\nNext.")
  })

  it("turns EPUB footnote references into paragraph metadata and removes footnote bodies", () => {
    const html = `
      <article>
        <p>Text with a note.<sup><a href="#fn-1" id="fn_1">1</a></sup> Next sentence.</p>
        <p class="footnote"><a href="#fn_1" id="fn-1"><sup>1</sup></a> Footnote <span class="italic">body</span>.</p>
        <p class="footnote1">Continuation paragraph.</p>
      </article>
    `

    expect(htmlToReaderBlocks(html)).toEqual([
      {
        type: "paragraph",
        text: "Text with a note. Next sentence.",
        footnotes: [
          {
            marker: "1",
            note: "Footnote body.\n\nContinuation paragraph.",
            offset: "Text with a note.".length,
            target: "fn-1"
          }
        ]
      }
    ])
    expect(htmlToPlainText(html)).toBe("Text with a note. Next sentence.")
  })
})
