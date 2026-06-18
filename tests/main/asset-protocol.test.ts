import { describe, expect, it, vi } from "vitest"
import type { ReaderManifest } from "../../src/main/services/library-service"

vi.mock("electron", () => ({
  protocol: {
    handle: vi.fn()
  }
}))

import {
  corsHeadersForRequest,
  createPublicationManifest,
  createPublicationPositions,
  createPublicationPositionsFromReadiumManifest,
  mimeTypeForPublicationResourcePath,
  normalizeEpubPublicationHtml,
  normalizeVirtualPublicationHtml,
  normalizePublicationResourcePath
} from "../../src/main/protocol/asset-protocol"

describe("asset publication protocol helpers", () => {
  it("normalizes publication resource paths and rejects traversal", () => {
    expect(normalizePublicationResourcePath("/OPS/Text/Chapter%201.xhtml")).toBe("OPS/Text/Chapter 1.xhtml")
    expect(normalizePublicationResourcePath("../secret.css")).toBeUndefined()
    expect(normalizePublicationResourcePath("OPS/%2e%2e/secret.css")).toBeUndefined()
    expect(normalizePublicationResourcePath("OPS/Text/\0chapter.xhtml")).toBeUndefined()
  })

  it("maps supported publication resource MIME types", () => {
    expect(mimeTypeForPublicationResourcePath("OPS/Text/chapter.xhtml")).toBe("application/xhtml+xml")
    expect(mimeTypeForPublicationResourcePath("OPS/Styles/book.css")).toBe("text/css")
    expect(mimeTypeForPublicationResourcePath("OPS/Images/cover.webp")).toBe("image/webp")
    expect(mimeTypeForPublicationResourcePath("OPS/Fonts/text.woff2")).toBe("font/woff2")
    expect(mimeTypeForPublicationResourcePath("chapter-1", "text/html; charset=utf-8")).toBe("text/html")
    expect(mimeTypeForPublicationResourcePath("OPS/Scripts/app.js")).toBeUndefined()
  })

  it("allows CORS only for app and local development origins", () => {
    expect(corsHeadersForRequest(new Request("dreamreader://publication/book/manifest.json", {
      headers: { origin: "http://localhost:5173" }
    }))).toMatchObject({
      "access-control-allow-origin": "http://localhost:5173"
    })
    expect(corsHeadersForRequest(new Request("dreamreader://publication/book/manifest.json", {
      headers: { origin: "null" }
    }))).toMatchObject({
      "access-control-allow-origin": "null"
    })
    expect(corsHeadersForRequest(new Request("dreamreader://publication/book/manifest.json", {
      headers: { origin: "https://example.com" }
    }))).toEqual({})
  })

  it("creates a virtual Thorium-fetchable manifest for non-EPUB books", () => {
    const readerManifest = virtualReaderManifest()
    const manifest = createPublicationManifest({
      id: "book_virtual",
      fileType: "markdown",
      title: "Virtual Book",
      authors: ["DreamReader"],
      language: "pt-BR",
      libraryPath: "/tmp/book.md",
      manifestJson: readerManifest
    }) as Record<string, unknown>

    expect(manifest.metadata).toMatchObject({
      title: "Virtual Book",
      language: "pt-BR",
      author: [{ name: "DreamReader" }]
    })
    expect(manifest.readingOrder).toEqual([
      {
        href: "dreamreader://publication/book_virtual/resource/chapter-1",
        type: "text/html",
        title: "Inicio"
      },
      {
        href: "dreamreader://publication/book_virtual/resource/chapter-2",
        type: "text/html",
        title: "Fim"
      }
    ])
    expect(manifest.toc).toEqual([
      { href: "dreamreader://publication/book_virtual/resource/chapter-1", title: "Inicio" },
      { href: "dreamreader://publication/book_virtual/resource/chapter-2", title: "Fim" }
    ])
    expect(manifest.links).toEqual(
      expect.arrayContaining([
        {
          href: "dreamreader://publication/book_virtual/positions.json",
          type: "application/vnd.readium.position-list+json",
          rel: "positions"
        }
      ])
    )
  })

  it("rewrites persisted Readium manifests to dreamreader publication URLs", () => {
    const readerManifest: ReaderManifest = {
      ...virtualReaderManifest(),
      format: "epub",
      readiumManifest: {
        metadata: {
          title: "Raw Readium"
        },
        links: [
          { href: "raw-positions.json", type: "application/vnd.readium.position-list+json" }
        ],
        readingOrder: [
          { href: "OPS/Text/Chapter 1.xhtml#start", type: "application/xhtml+xml", title: "Start" }
        ],
        resources: [
          { href: "OPS/Styles/book.css", type: "text/css" },
          { href: "https://example.com/tracker.css", type: "text/css" },
          { href: "file:///private/secret.png", type: "image/png" }
        ],
        toc: [
          { href: "OPS/Text/Chapter 1.xhtml#start", title: "Start" }
        ]
      }
    }

    const manifest = createPublicationManifest({
      id: "book_raw",
      fileType: "epub",
      title: "Fallback",
      authors: [],
      language: "en",
      libraryPath: "/tmp/book.epub",
      manifestJson: readerManifest
    }) as Record<string, unknown>

    expect(manifest.metadata).toMatchObject({
      title: "Raw Readium",
      conformsTo: ["https://readium.org/webpub-manifest/profiles/epub"]
    })
    expect(manifest.readingOrder).toEqual([
      {
        href: "dreamreader://publication/book_raw/resource/OPS/Text/Chapter%201.xhtml",
        type: "application/xhtml+xml",
        title: "Start"
      }
    ])
    expect(manifest.resources).toEqual([
      {
        href: "dreamreader://publication/book_raw/resource/OPS/Styles/book.css",
        type: "text/css"
      }
    ])
    expect(manifest.links).toEqual(
      expect.arrayContaining([
        {
          href: "dreamreader://publication/book_raw/positions.json",
          type: "application/vnd.readium.position-list+json",
          rel: "positions"
        }
      ])
    )
    expect(manifest.toc).toEqual([
      { href: "dreamreader://publication/book_raw/resource/OPS/Text/Chapter%201.xhtml#start", title: "Start" }
    ])
  })

  it("strips fragments from generated reading order and positions", () => {
    const readerManifest = virtualReaderManifest()
    readerManifest.chapters[0] = {
      ...readerManifest.chapters[0],
      id: "chapter-1#anchor",
      href: "chapter-1#anchor"
    }
    readerManifest.tableOfContents[0] = {
      ...readerManifest.tableOfContents[0],
      href: "chapter-1#anchor"
    }

    const manifest = createPublicationManifest({
      id: "book_fragments",
      fileType: "markdown",
      title: "Virtual Book",
      authors: ["DreamReader"],
      language: "pt-BR",
      libraryPath: "/tmp/book.md",
      manifestJson: readerManifest
    }) as Record<string, unknown>
    const positions = createPublicationPositions("book_fragments", readerManifest)

    expect(manifest.readingOrder).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ href: "dreamreader://publication/book_fragments/resource/chapter-1" })
      ])
    )
    expect(manifest.toc).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ href: "dreamreader://publication/book_fragments/resource/chapter-1#anchor" })
      ])
    )
    expect(positions.positions[0]?.href).toBe("dreamreader://publication/book_fragments/resource/chapter-1")
  })

  it("generates EPUB positions from the persisted Readium reading order", () => {
    const positions = createPublicationPositionsFromReadiumManifest("book_raw", {
      readingOrder: [
        { href: "titlepage.xhtml", type: "application/xhtml+xml", title: "Title Page" },
        { href: "The_Field_split_000.html#filepos212", type: "application/xhtml+xml", title: "Chapter" }
      ]
    })

    expect(positions).toEqual({
      total: 2,
      positions: [
        {
          href: "dreamreader://publication/book_raw/resource/titlepage.xhtml",
          type: "application/xhtml+xml",
          title: "Title Page",
          locations: {
            position: 1,
            progression: 0,
            totalProgression: 0
          }
        },
        {
          href: "dreamreader://publication/book_raw/resource/The_Field_split_000.html",
          type: "application/xhtml+xml",
          title: "Chapter",
          locations: {
            position: 2,
            progression: 0,
            totalProgression: 0.5
          }
        }
      ]
    })
  })

  it("generates simple Readium positions from chapter progression", () => {
    const positions = createPublicationPositions("book_virtual", virtualReaderManifest())

    expect(positions).toEqual({
      total: 2,
      positions: [
        {
          href: "dreamreader://publication/book_virtual/resource/chapter-1",
          type: "text/html",
          title: "Inicio",
          locations: {
            position: 1,
            progression: 0,
            totalProgression: 0
          }
        },
        {
          href: "dreamreader://publication/book_virtual/resource/chapter-2",
          type: "text/html",
          title: "Fim",
          locations: {
            position: 2,
            progression: 0,
            totalProgression: 0.5
          }
        }
      ]
    })
  })

  it("wraps virtual publication fragments as complete HTML with script-blocking CSP", () => {
    const html = normalizeVirtualPublicationHtml("<article><h1>Inicio</h1><script>window.bad = true</script></article>", "Inicio")

    expect(html).toMatch(/^<!doctype html>/i)
    expect(html).toContain("<head>")
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain("Content-Security-Policy")
    expect(html).toContain("script-src &#39;none&#39;")
    expect(html).toContain("<body><article>")
  })

  it("adds a first child to existing empty heads for Thorium WebPub base injection", () => {
    const html = normalizeVirtualPublicationHtml("<html><head></head><body><p>Texto.</p></body></html>", "Livro")

    expect(html).toContain("<head><meta charset=\"utf-8\">")
    expect(html).toContain("<title>Livro</title>")
  })

  it("fits EPUB cover-like pages to the iframe viewport", () => {
    const html = normalizeEpubPublicationHtml(
      '<html><head><title>Book</title></head><body epub:type="frontmatter"><div class="cover"><img src="image/title.jpg"/></div></body></html>'
    )

    expect(html).toContain('data-dreamreader-cover-fit="true"')
    expect(html).toContain("max-height:100vh")
    expect(html).toContain("object-fit:contain")
  })

  it("does not alter regular EPUB chapters", () => {
    const html = normalizeEpubPublicationHtml(
      '<html><head><title>Chapter</title></head><body><h1>Chapter</h1><p>Text with an <img src="image/inline.jpg"/> inline image.</p></body></html>'
    )

    expect(html).toBeUndefined()
  })
})

function virtualReaderManifest(): ReaderManifest {
  return {
    format: "markdown",
    title: "Virtual Book",
    authors: ["DreamReader"],
    language: "pt-BR",
    chapters: [
      {
        id: "chapter-1",
        href: "chapter-1",
        title: "Inicio",
        content: "<article><h1>Inicio</h1><p>Texto.</p></article>",
        mediaType: "text/html",
        progressionStart: 0,
        progressionEnd: 0.5
      },
      {
        id: "chapter-2",
        href: "chapter-2",
        title: "Fim",
        content: "<article><h1>Fim</h1><p>Texto.</p></article>",
        mediaType: "text/html",
        progressionStart: 0.5,
        progressionEnd: 1
      }
    ],
    tableOfContents: [
      { href: "chapter-1", title: "Inicio" },
      { href: "chapter-2", title: "Fim" }
    ]
  }
}
