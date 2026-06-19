import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import JSZip from "jszip"
import { afterEach, describe, expect, it } from "vitest"
import * as schema from "../../src/main/db/schema"
import { LibraryService } from "../../src/main/services/library-service"
import type { ReadiumManifestProvider } from "../../src/main/services/readium-cli"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { force: true, recursive: true })
  }
})

describe("LibraryService", () => {
  it("imports an EPUB and extracts readable chapters", async () => {
    const { client, service, tempDir } = await createTestLibrary()
    const epubPath = path.join(tempDir, "livro-teste.epub")
    await writeFile(epubPath, await createMinimalEpub())

    try {
      const result = await service.importFiles([epubPath])
      const imported = result.imported[0] as {
        id: string
        title: string
        importSource?: { importer: string }
      }

      expect(result.skipped).toEqual([])
      expect(imported.title).toBe("Livro de Teste")
      expect(imported.importSource?.importer).toBe("dreamreader-local")

      const opened = await service.openBook(imported.id)
      expect(opened.tableOfContents).toHaveLength(1)

      const resource = await service.getResource({
        bookId: imported.id,
        href: opened.tableOfContents[0].href
      })
      expect(resource.content).toContain("Primeiro capitulo")
    } finally {
      await client.close()
    }
  })

  it("uses NCX anchors to split Calibre-style EPUB files and stores the cover", async () => {
    const { client, service, tempDir } = await createTestLibrary()
    const epubPath = path.join(tempDir, "seth-style.epub")
    await writeFile(epubPath, await createAnchoredEpub())

    try {
      const result = await service.importFiles([epubPath])
      const imported = result.imported[0] as {
        id: string
        coverAssetId?: string
        coverImageUrl?: string
      }

      expect(result.skipped).toEqual([])
      expect(imported.coverAssetId).toBeTruthy()
      expect(imported.coverImageUrl).toMatch(/^dreamreader:\/\/asset\//)

      const opened = await service.openBook(imported.id)
      expect(opened.tableOfContents.map((item) => item.title)).toEqual([
        "INTRODUÇÃO",
        "CAPÍTULO 1",
        "CAPÍTULO 2"
      ])

      const introduction = await service.getResource({
        bookId: imported.id,
        href: opened.tableOfContents[0].href
      })
      const chapterOne = await service.getResource({
        bookId: imported.id,
        href: opened.tableOfContents[1].href
      })

      expect(introduction.content).toContain("Texto da introducao")
      expect(introduction.content).not.toContain("Texto do capitulo 1")
      expect(chapterOne.content).toContain("Texto do capitulo 1")
      expect(chapterOne.content).not.toContain("Texto do capitulo 2")
    } finally {
      await client.close()
    }
  })

  it("uses a Readium manifest provider before the local EPUB parser", async () => {
    let readiumCalls = 0
    const readiumProvider: ReadiumManifestProvider = {
      async manifest() {
        readiumCalls += 1
        return {
          metadata: {
            title: "Titulo vindo do Readium",
            author: { name: "Autora Readium" },
            language: "pt-BR"
          },
          readingOrder: [
            { href: "index_split_000.html", type: "application/xhtml+xml" }
          ],
          resources: [
            { href: "cover.png", rel: "cover", type: "image/png" }
          ],
          toc: [
            { href: "index_split_000.html#intro", title: "Intro pelo Readium" },
            { href: "index_split_000.html#c1", title: "Capitulo pelo Readium" },
            { href: "index_split_000.html#c2", title: "Final pelo Readium" }
          ]
        }
      }
    }
    const { client, db, service, tempDir } = await createTestLibrary(readiumProvider)
    const epubPath = path.join(tempDir, "readium-provider.epub")
    await writeFile(epubPath, await createAnchoredEpub())

    try {
      const result = await service.importFiles([epubPath])
      const imported = result.imported[0] as {
        id: string
        title: string
        authors: Array<{ name: string }>
        coverAssetId?: string
        importSource?: { importer: string }
      }

      expect(result.skipped).toEqual([])
      expect(readiumCalls).toBe(1)
      expect(imported.title).toBe("Titulo vindo do Readium")
      expect(imported.authors).toEqual([{ name: "Autora Readium" }])
      expect(imported.coverAssetId).toBeTruthy()
      expect(imported.importSource?.importer).toBe("readium-cli")
      const bookRow = await db.query.books.findFirst({ where: (table, { eq }) => eq(table.id, imported.id) })
      expect((bookRow?.manifestJson as { readiumManifest?: unknown }).readiumManifest).toMatchObject({
        metadata: {
          title: "Titulo vindo do Readium"
        }
      })

      const opened = await service.openBook(imported.id)
      expect(opened.tableOfContents.map((item) => item.title)).toEqual([
        "Intro pelo Readium",
        "Capitulo pelo Readium",
        "Final pelo Readium"
      ])

      const intro = await service.getResource({
        bookId: imported.id,
        href: opened.tableOfContents[0].href
      })
      const chapter = await service.getResource({
        bookId: imported.id,
        href: opened.tableOfContents[1].href
      })

      expect(intro.content).toContain("Texto da introducao")
      expect(intro.content).not.toContain("Texto do capitulo 1")
      expect(chapter.content).toContain("Texto do capitulo 1")
      expect(chapter.content).not.toContain("Texto do capitulo 2")
    } finally {
      await client.close()
    }
  })

  it("falls back to spine order when NCX anchors point to the wrong chapter files", async () => {
    const { client, service, tempDir } = await createTestLibrary()
    const epubPath = path.join(tempDir, "broken-toc.epub")
    await writeFile(epubPath, await createBrokenTocEpub())

    try {
      const result = await service.importFiles([epubPath])
      const imported = result.imported[0] as { id: string }

      expect(result.skipped).toEqual([])

      const opened = await service.openBook(imported.id)
      expect(opened.tableOfContents.map((item) => item.title)).toEqual([
        "7 - OS ENFOQUES DOS PESQUISADORES",
        "8 - TAREFA E TECNICA DE TRADUCAO DO CORPUS HERMETICUM"
      ])
      expect(opened.tableOfContents.map((item) => item.href)).toEqual(["cap-7.html", "cap-8.html"])

      const chapterEight = await service.getResource({
        bookId: imported.id,
        href: opened.tableOfContents[1].href
      })

      expect(chapterEight.content).toContain("Texto correto do capitulo 8.")
      expect(chapterEight.content).not.toContain("Texto do capitulo 7.")
    } finally {
      await client.close()
    }
  })

  it("does not turn nested NCX subnavigation into extra chapters", async () => {
    const { client, service, tempDir } = await createTestLibrary()
    const epubPath = path.join(tempDir, "nested-subnavigation.epub")
    await writeFile(epubPath, await createNestedSubnavigationEpub())

    try {
      const result = await service.importFiles([epubPath])
      const imported = result.imported[0] as { id: string }

      expect(result.skipped).toEqual([])

      const opened = await service.openBook(imported.id)
      expect(opened.tableOfContents.map((item) => item.title)).toEqual([
        "Primary section",
        "Second section"
      ])
      expect(opened.tableOfContents.map((item) => item.href)).toEqual([
        "part-1.xhtml",
        "part-2.xhtml"
      ])

      const primary = await service.getResource({
        bookId: imported.id,
        href: opened.tableOfContents[0].href
      })

      expect(primary.content).toContain("Main body text.")
      expect(primary.content).not.toContain("Internal note text.")
    } finally {
      await client.close()
    }
  })

  it("keeps numbered chapters nested under parts and merges their subsection files", async () => {
    const { client, service, tempDir } = await createTestLibrary()
    const epubPath = path.join(tempDir, "numbered-nested-chapters.epub")
    await writeFile(epubPath, await createNumberedNestedChaptersEpub())

    try {
      const result = await service.importFiles([epubPath])
      const imported = result.imported[0] as { id: string }

      expect(result.skipped).toEqual([])

      const opened = await service.openBook(imported.id)
      expect(opened.tableOfContents.map((item) => item.title)).toEqual([
        "Introduction",
        "1. Numbered chapter",
        "Appendix One"
      ])

      const numbered = await service.getResource({
        bookId: imported.id,
        href: opened.tableOfContents[1].href
      })
      const appendix = await service.getResource({
        bookId: imported.id,
        href: opened.tableOfContents[2].href
      })

      expect(numbered.content).toContain("Numbered chapter")
      expect(numbered.content).toContain("Merged body text.")
      expect(numbered.content).not.toContain("Numbered note text.")
      expect(appendix.content).toContain("Appendix body text.")
    } finally {
      await client.close()
    }
  })

  it("merges unlisted spine files that continue flat TOC chapters", async () => {
    const { client, service, tempDir } = await createTestLibrary()
    const epubPath = path.join(tempDir, "split-continuation.epub")
    await writeFile(epubPath, await createSplitContinuationEpub())

    try {
      const result = await service.importFiles([epubPath])
      const imported = result.imported[0] as { id: string }

      expect(result.skipped).toEqual([])

      const opened = await service.openBook(imported.id)
      expect(opened.tableOfContents.map((item) => item.title)).toEqual([
        "1 First Chapter",
        "2 Second Chapter",
        "3 Third Chapter"
      ])

      const second = await service.getResource({
        bookId: imported.id,
        href: opened.tableOfContents[1].href
      })

      expect(second.content).toContain("Second chapter title page.")
      expect(second.content).toContain("Second chapter body text.")
      expect(second.content).not.toContain("Third chapter body text.")
    } finally {
      await client.close()
    }
  })

  it("merges unlisted Readium reading-order files that continue flat TOC chapters", async () => {
    const readiumProvider: ReadiumManifestProvider = {
      async manifest() {
        return {
          metadata: {
            title: "Split Continuation",
            author: { name: "DreamReader" },
            language: "pt-BR"
          },
          readingOrder: [
            { href: "chapter-1-title.xhtml", type: "application/xhtml+xml" },
            { href: "chapter-1-body.xhtml", type: "application/xhtml+xml" },
            { href: "chapter-2-title.xhtml", type: "application/xhtml+xml" },
            { href: "chapter-2-body.xhtml", type: "application/xhtml+xml" },
            { href: "chapter-3-title.xhtml", type: "application/xhtml+xml" },
            { href: "chapter-3-body.xhtml", type: "application/xhtml+xml" }
          ],
          toc: [
            { href: "chapter-1-title.xhtml", title: "1 First Chapter" },
            { href: "chapter-2-title.xhtml", title: "2 Second Chapter" },
            { href: "chapter-3-title.xhtml", title: "3 Third Chapter" }
          ]
        }
      }
    }
    const { client, service, tempDir } = await createTestLibrary(readiumProvider)
    const epubPath = path.join(tempDir, "split-continuation-readium.epub")
    await writeFile(epubPath, await createSplitContinuationEpub())

    try {
      const result = await service.importFiles([epubPath])
      const imported = result.imported[0] as { id: string; importSource?: { importer: string } }

      expect(result.skipped).toEqual([])
      expect(imported.importSource?.importer).toBe("readium-cli")

      const opened = await service.openBook(imported.id)
      const second = await service.getResource({
        bookId: imported.id,
        href: opened.tableOfContents[1].href
      })

      expect(second.content).toContain("Second chapter title page.")
      expect(second.content).toContain("Second chapter body text.")
      expect(second.content).not.toContain("Third chapter body text.")
    } finally {
      await client.close()
    }
  })

  it("lists active annotations for a book", async () => {
    const { client, service, tempDir } = await createTestLibrary()
    const epubPath = path.join(tempDir, "livro-teste.epub")
    await writeFile(epubPath, await createMinimalEpub())

    try {
      const result = await service.importFiles([epubPath])
      const imported = result.imported[0] as { id: string }
      const opened = await service.openBook(imported.id)
      const chapterHref = opened.tableOfContents[0].href
      const kept = await service.createAnnotation({
        bookId: imported.id,
        locator: {
          href: chapterHref,
          type: "application/xhtml+xml",
          text: { highlight: "Texto em portugues brasileiro." }
        },
        quote: "Texto em portugues brasileiro.",
        color: "yellow",
        tags: []
      })
      const deleted = await service.createAnnotation({
        bookId: imported.id,
        locator: { href: chapterHref, type: "application/xhtml+xml" },
        quote: "Trecho removido.",
        color: "blue",
        tags: []
      })

      await service.deleteAnnotation(deleted.id)

      expect(await service.listAnnotations(imported.id)).toEqual([kept])
    } finally {
      await client.close()
    }
  })

  it("deletes a book with its database rows and generated audio files", async () => {
    const { client, db, service, tempDir } = await createTestLibrary()
    const epubPath = path.join(tempDir, "livro-teste.epub")
    await writeFile(epubPath, await createMinimalEpub())

    try {
      const result = await service.importFiles([epubPath])
      const imported = result.imported[0] as { id: string }
      const opened = await service.openBook(imported.id)
      const chapterHref = opened.tableOfContents[0].href
      const bookRow = await db.query.books.findFirst({ where: (table, { eq }) => eq(table.id, imported.id) })
      const audioPath = path.join(tempDir, "audio-cache", imported.id, "chapter.wav")
      const m4bPath = path.join(tempDir, "audiobooks", `${imported.id}.m4b`)
      await mkdir(path.dirname(audioPath), { recursive: true })
      await mkdir(path.dirname(m4bPath), { recursive: true })
      await writeFile(audioPath, Buffer.from("chapter audio"))
      await writeFile(m4bPath, Buffer.from("m4b audio"))

      await service.createAnnotation({
        bookId: imported.id,
        locator: { href: chapterHref },
        quote: "Trecho marcado.",
        color: "yellow"
      })
      await db.insert(schema.ttsEngines).values({
        id: "dreamreader-local-tts",
        displayName: "Local TTS",
        version: "1",
        adapterId: "dreamreader-local-wav",
        runtime: "node",
        modelFormat: "wav",
        accelerator: "cpu"
      })
      await db.insert(schema.assets).values([
        {
          id: "asset-audio",
          kind: "audio_chapter",
          bookId: imported.id,
          path: audioPath,
          mimeType: "audio/wav",
          contentHash: "audio-hash",
          sizeBytes: 13
        },
        {
          id: "asset-m4b",
          kind: "audiobook_m4b",
          bookId: imported.id,
          path: m4bPath,
          mimeType: "audio/mp4",
          contentHash: "m4b-hash",
          sizeBytes: 9
        }
      ])
      await db.insert(schema.ttsJobs).values({
        id: "tts-job-1",
        bookId: imported.id,
        chapterHref,
        engineId: "dreamreader-local-tts",
        status: "completed",
        progress: 1,
        settingsJson: { chapterAudioAssetId: "asset-audio" }
      })
      await db.insert(schema.ttsSegments).values({
        id: "tts-segment-1",
        jobId: "tts-job-1",
        bookId: imported.id,
        chapterHref,
        segmentIndex: 0,
        segmentHash: "segment-hash",
        locatorJson: { href: chapterHref },
        originalText: "Trecho marcado.",
        normalizedText: "Trecho marcado.",
        audioAssetId: "asset-audio",
        durationMs: 1000,
        status: "completed"
      })
      await db.insert(schema.audiobookExports).values({
        id: "audiobook-export-1",
        bookId: imported.id,
        status: "complete",
        assetId: "asset-m4b",
        chaptersReady: 1,
        chaptersTotal: 1,
        durationMs: 1000
      })
      await db.insert(schema.audiobookChapters).values({
        id: "audiobook-chapter-1",
        audiobookExportId: "audiobook-export-1",
        bookId: imported.id,
        chapterHref,
        chapterIndex: 0,
        title: "Primeiro capitulo",
        audioAssetId: "asset-audio",
        engineId: "dreamreader-local-tts",
        durationMs: 1000,
        endMs: 1000,
        contentHash: "chapter-hash",
        audioHash: "audio-hash"
      })

      await expect(access(bookRow?.libraryPath ?? "")).resolves.toBeUndefined()
      await expect(access(audioPath)).resolves.toBeUndefined()
      await expect(access(m4bPath)).resolves.toBeUndefined()
      await expect(service.deleteBook(imported.id)).resolves.toEqual({ deleted: true })

      expect(await db.query.books.findFirst({ where: (table, { eq }) => eq(table.id, imported.id) })).toBeUndefined()
      expect(await db.query.annotations.findMany({ where: (table, { eq }) => eq(table.bookId, imported.id) })).toEqual([])
      expect(await db.query.assets.findMany({ where: (table, { eq }) => eq(table.bookId, imported.id) })).toEqual([])
      expect(await db.query.ttsJobs.findMany({ where: (table, { eq }) => eq(table.bookId, imported.id) })).toEqual([])
      expect(await db.query.ttsSegments.findMany({ where: (table, { eq }) => eq(table.bookId, imported.id) })).toEqual([])
      expect(await db.query.audiobookExports.findMany({ where: (table, { eq }) => eq(table.bookId, imported.id) })).toEqual([])
      expect(await db.query.audiobookChapters.findMany({ where: (table, { eq }) => eq(table.bookId, imported.id) })).toEqual([])
      await expect(service.listBooks()).resolves.toEqual({ books: [], total: 0 })
      await expect(access(bookRow?.libraryPath ?? "")).rejects.toThrow()
      await expect(access(audioPath)).rejects.toThrow()
      await expect(access(m4bPath)).rejects.toThrow()
    } finally {
      await client.close()
    }
  })

  it("does not delete a book while audio jobs are active", async () => {
    const { client, db, service, tempDir } = await createTestLibrary()
    const epubPath = path.join(tempDir, "livro-teste.epub")
    await writeFile(epubPath, await createMinimalEpub())

    try {
      const result = await service.importFiles([epubPath])
      const imported = result.imported[0] as { id: string }
      const opened = await service.openBook(imported.id)
      await db.insert(schema.ttsEngines).values({
        id: "dreamreader-local-tts",
        displayName: "Local TTS",
        version: "1",
        adapterId: "dreamreader-local-wav",
        runtime: "node",
        modelFormat: "wav",
        accelerator: "cpu"
      })
      await db.insert(schema.ttsJobs).values({
        id: "tts-job-active",
        bookId: imported.id,
        chapterHref: opened.tableOfContents[0].href,
        engineId: "dreamreader-local-tts",
        status: "synthesizing",
        progress: 0.5
      })

      await expect(service.deleteBook(imported.id)).rejects.toMatchObject({ code: "book_has_active_audio_jobs" })
      expect(await db.query.books.findFirst({ where: (table, { eq }) => eq(table.id, imported.id) })).toBeTruthy()
    } finally {
      await client.close()
    }
  })

  it("exports annotations as a structured Markdown file", async () => {
    const { client, service, tempDir } = await createTestLibrary()
    const epubPath = path.join(tempDir, "livro-teste.epub")
    await writeFile(epubPath, await createMinimalEpub())

    try {
      const result = await service.importFiles([epubPath])
      const imported = result.imported[0] as { id: string }
      const opened = await service.openBook(imported.id)
      const chapterHref = opened.tableOfContents[0].href

      await service.createAnnotation({
        bookId: imported.id,
        locator: {
          href: chapterHref,
          text: {
            anchorParagraphIndex: 2,
            anchorTextOffset: 8
          }
        },
        quote: "Texto em portugues brasileiro.",
        color: "yellow",
        note: "Minha nota sobre o trecho.",
        tags: ["note"]
      })

      const markdown = await service.exportAnnotations({
        bookId: imported.id,
        format: "markdown",
        includeDeleted: false
      })
      expect(markdown).toContain("# Livro de Teste")
      expect(markdown).toContain("- **Autor(es):** DreamReader")
      expect(markdown).toContain("## Primeiro capitulo")
      expect(markdown).toContain("### Paragrafo 3")
      expect(markdown).toContain("> Texto em portugues brasileiro.")
      expect(markdown).toContain("**Nota:**\n\nMinha nota sobre o trecho.")

      const targetPath = path.join(tempDir, "notas.md")
      const exported = await service.exportAnnotationsToFile({
        bookId: imported.id,
        format: "markdown",
        includeDeleted: false,
        targetPath
      })
      expect(exported).toEqual({ exported: true, filePath: targetPath })
      const exportedMarkdown = await readFile(targetPath, "utf8")
      expect(exportedMarkdown).toContain("# Livro de Teste")
      expect(exportedMarkdown).toContain("### Paragrafo 3")
      expect(exportedMarkdown).toContain("**Nota:**\n\nMinha nota sobre o trecho.")
    } finally {
      await client.close()
    }
  })
})

async function createTestLibrary(readiumManifestProvider: ReadiumManifestProvider | null = null) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dreamreader-library-"))
  tempDirs.push(tempDir)

  const client = new PGlite(path.join(tempDir, "db"))
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: path.resolve("drizzle") })

  const paths = {
    appRoot: tempDir,
    resourcesDir: tempDir,
    userData: tempDir,
    dbDir: path.join(tempDir, "db"),
    booksDir: path.join(tempDir, "library", "books"),
    coversDir: path.join(tempDir, "library", "covers"),
    extractedDir: path.join(tempDir, "library", "extracted"),
    audioCacheDir: path.join(tempDir, "audio-cache"),
    audiobooksDir: path.join(tempDir, "audiobooks"),
    voicesDir: path.join(tempDir, "voices"),
    modelsDir: path.join(tempDir, "models"),
    runtimeDir: path.join(tempDir, "runtimes"),
    pythonDir: path.join(tempDir, "runtimes", "python"),
    runtimeDownloadsDir: path.join(tempDir, "runtimes", "downloads"),
    runtimeCacheDir: path.join(tempDir, "runtime-cache"),
    huggingFaceDir: path.join(tempDir, "huggingface"),
    sidecarsDir: path.join(tempDir, "sidecars"),
    logsDir: path.join(tempDir, "logs"),
    backupsDir: path.join(tempDir, "backups")
  }
  await mkdir(path.dirname(paths.booksDir), { recursive: true })

  return {
    client,
    db,
    service: new LibraryService(db, paths, { readiumManifestProvider }),
    tempDir
  }
}

async function createMinimalEpub(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  )
  zip.file(
    "OPS/package.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="bookid" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Livro de Teste</dc:title>
    <dc:creator>DreamReader</dc:creator>
    <dc:language>pt-BR</dc:language>
  </metadata>
  <manifest>
    <item id="chapter-1" href="Text/Chapter%201.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter-1"/>
  </spine>
</package>`
  )
  zip.file(
    "OPS/Text/Chapter 1.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
  <head><title>Primeiro capitulo</title></head>
  <body><h1>Primeiro capitulo</h1><p>Texto em portugues brasileiro.</p></body>
</html>`
  )
  return zip.generateAsync({ type: "nodebuffer" })
}

async function createAnchoredEpub(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  )
  zip.file(
    "content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package version="2.0" unique-identifier="bookid" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Seth Style</dc:title>
    <dc:creator>DreamReader</dc:creator>
    <dc:language>pt-BR</dc:language>
    <meta name="cover" content="cover"/>
  </metadata>
  <manifest>
    <item id="cover" href="cover.png" media-type="image/png"/>
    <item id="chapter-file" href="index_split_000.html" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="chapter-file"/>
  </spine>
</package>`
  )
  zip.file(
    "toc.ncx",
    `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="por">
  <head><meta name="dtb:uid" content="bookid"/></head>
  <docTitle><text>Seth Style</text></docTitle>
  <navMap>
    <navPoint id="intro" playOrder="1"><navLabel><text>INTRODUÇÃO</text></navLabel><content src="index_split_000.html#intro"/></navPoint>
    <navPoint id="chapter-1" playOrder="2"><navLabel><text>CAPÍTULO 1</text></navLabel><content src="index_split_000.html#c1"/></navPoint>
    <navPoint id="chapter-2" playOrder="3"><navLabel><text>CAPÍTULO 2</text></navLabel><content src="index_split_000.html#c2"/></navPoint>
  </navMap>
</ncx>`
  )
  zip.file(
    "index_split_000.html",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
  <head><title>Unknown</title><style>.hidden { display: none; }</style></head>
  <body>
    <h1 id="intro">INTRODUÇÃO</h1><p>Texto da introducao.</p>
    <h1 id="c1">CAPÍTULO 1</h1><p>Texto do capitulo 1.</p>
    <h1 id="c2">CAPÍTULO 2</h1><p>Texto do capitulo 2.</p>
  </body>
</html>`
  )
  zip.file(
    "cover.png",
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lV0X9AAAAABJRU5ErkJggg==",
      "base64"
    )
  )
  return zip.generateAsync({ type: "nodebuffer" })
}

async function createBrokenTocEpub(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  )
  zip.file(
    "content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package version="2.0" unique-identifier="bookid" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Broken TOC</dc:title>
    <dc:creator>DreamReader</dc:creator>
    <dc:language>pt-BR</dc:language>
  </metadata>
  <manifest>
    <item id="chapter-7" href="cap-7.html" media-type="application/xhtml+xml"/>
    <item id="chapter-8" href="cap-8.html" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="chapter-7"/>
    <itemref idref="chapter-8"/>
  </spine>
</package>`
  )
  zip.file(
    "toc.ncx",
    `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="por">
  <head><meta name="dtb:uid" content="bookid"/></head>
  <docTitle><text>Broken TOC</text></docTitle>
  <navMap>
    <navPoint id="chapter-7" playOrder="1"><navLabel><text>7. Os enfoques dos pesquisadores</text></navLabel><content src="cap-6.html#p88"/></navPoint>
    <navPoint id="chapter-8" playOrder="2"><navLabel><text>8. Tarefa e tecnica de traducao do Corpus Hermeticum</text></navLabel><content src="cap-7.html#p95"/></navPoint>
  </navMap>
</ncx>`
  )
  zip.file(
    "cap-6.html",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
  <head><title>Corpus hermeticum graecum</title></head>
  <body><h1>6 - OS ASPECTOS LITERARIOS</h1><p>Texto do capitulo 6.</p></body>
</html>`
  )
  zip.file(
    "cap-7.html",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
  <head><title>Corpus hermeticum graecum</title></head>
  <body><h1>7 - OS ENFOQUES DOS PESQUISADORES</h1><p>Texto do capitulo 7.</p></body>
</html>`
  )
  zip.file(
    "cap-8.html",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
  <head><title>Corpus hermeticum graecum</title></head>
  <body><h1>8 - TAREFA E TECNICA DE TRADUCAO DO CORPUS HERMETICUM</h1><p>Texto correto do capitulo 8.</p></body>
</html>`
  )
  return zip.generateAsync({ type: "nodebuffer" })
}

async function createSplitContinuationEpub(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  )
  zip.file(
    "content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package version="2.0" unique-identifier="bookid" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Split Continuation</dc:title>
    <dc:creator>DreamReader</dc:creator>
    <dc:language>pt-BR</dc:language>
  </metadata>
  <manifest>
    <item id="chapter-1-title" href="chapter-1-title.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-1-body" href="chapter-1-body.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-2-title" href="chapter-2-title.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-2-body" href="chapter-2-body.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-3-title" href="chapter-3-title.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-3-body" href="chapter-3-body.xhtml" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="chapter-1-title"/>
    <itemref idref="chapter-1-body"/>
    <itemref idref="chapter-2-title"/>
    <itemref idref="chapter-2-body"/>
    <itemref idref="chapter-3-title"/>
    <itemref idref="chapter-3-body"/>
  </spine>
</package>`
  )
  zip.file(
    "toc.ncx",
    `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="por">
  <head><meta name="dtb:uid" content="bookid"/></head>
  <docTitle><text>Split Continuation</text></docTitle>
  <navMap>
    <navPoint id="chapter-1" playOrder="1"><navLabel><text>1 First Chapter</text></navLabel><content src="chapter-1-title.xhtml"/></navPoint>
    <navPoint id="chapter-2" playOrder="2"><navLabel><text>2 Second Chapter</text></navLabel><content src="chapter-2-title.xhtml"/></navPoint>
    <navPoint id="chapter-3" playOrder="3"><navLabel><text>3 Third Chapter</text></navLabel><content src="chapter-3-title.xhtml"/></navPoint>
  </navMap>
</ncx>`
  )
  zip.file(
    "chapter-1-title.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
  <head><title>1 First Chapter</title></head>
  <body><h1>1 First Chapter</h1><p>First chapter title page.</p></body>
</html>`
  )
  zip.file(
    "chapter-1-body.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
  <head><title>First body</title></head>
  <body><p>First chapter body text.</p></body>
</html>`
  )
  zip.file(
    "chapter-2-title.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
  <head><title>2 Second Chapter</title></head>
  <body><h1>2 Second Chapter</h1><p>Second chapter title page.</p></body>
</html>`
  )
  zip.file(
    "chapter-2-body.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
  <head><title>Second body</title></head>
  <body><p>Second chapter body text.</p></body>
</html>`
  )
  zip.file(
    "chapter-3-title.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
  <head><title>3 Third Chapter</title></head>
  <body><h1>3 Third Chapter</h1><p>Third chapter title page.</p></body>
</html>`
  )
  zip.file(
    "chapter-3-body.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
  <head><title>Third body</title></head>
  <body><p>Third chapter body text.</p></body>
</html>`
  )
  return zip.generateAsync({ type: "nodebuffer" })
}

async function createNestedSubnavigationEpub(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  )
  zip.file(
    "content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package version="2.0" unique-identifier="bookid" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Nested Subnavigation</dc:title>
    <dc:creator>DreamReader</dc:creator>
    <dc:language>pt-BR</dc:language>
  </metadata>
  <manifest>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="part-1" href="part-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="part-1-note" href="part-1-note.xhtml" media-type="application/xhtml+xml"/>
    <item id="part-1-detail" href="part-1-detail.xhtml" media-type="application/xhtml+xml"/>
    <item id="part-2" href="part-2.xhtml" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="cover"/>
    <itemref idref="part-1"/>
    <itemref idref="part-1-note"/>
    <itemref idref="part-1-detail"/>
    <itemref idref="part-2"/>
  </spine>
</package>`
  )
  zip.file(
    "toc.ncx",
    `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="por">
  <head><meta name="dtb:uid" content="bookid"/></head>
  <docTitle><text>Nested Subnavigation</text></docTitle>
  <navMap>
    <navPoint id="cover" playOrder="1"><navLabel><text>Cover</text></navLabel><content src="cover.xhtml"/></navPoint>
    <navPoint id="part-1" playOrder="2">
      <navLabel><text>Primary section</text></navLabel>
      <content src="part-1.xhtml"/>
      <navPoint id="part-1-note" playOrder="3"><navLabel><text>Internal note</text></navLabel><content src="part-1-note.xhtml"/></navPoint>
      <navPoint id="part-1-detail" playOrder="4"><navLabel><text>Internal detail</text></navLabel><content src="part-1-detail.xhtml#detail"/></navPoint>
    </navPoint>
    <navPoint id="part-2" playOrder="5"><navLabel><text>Second section</text></navLabel><content src="part-2.xhtml"/></navPoint>
  </navMap>
</ncx>`
  )
  zip.file(
    "cover.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
  <head><title>Cover</title></head>
  <body><img src="cover.png" alt=""/></body>
</html>`
  )
  zip.file(
    "part-1.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
  <head><title>Primary section</title></head>
  <body><h1>Primary section</h1><p>Main body text.</p></body>
</html>`
  )
  zip.file(
    "part-1-note.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
  <head><title>Internal note</title></head>
  <body><h1>Internal note</h1><p>Internal note text.</p></body>
</html>`
  )
  zip.file(
    "part-1-detail.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
  <head><title>Internal detail</title></head>
  <body><h1 id="detail">Internal detail</h1><p>Internal detail text.</p></body>
</html>`
  )
  zip.file(
    "part-2.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
  <head><title>Second section</title></head>
  <body><h1>Second section</h1><p>Second body text.</p></body>
</html>`
  )
  return zip.generateAsync({ type: "nodebuffer" })
}

async function createNumberedNestedChaptersEpub(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  )
  zip.file(
    "content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package version="2.0" unique-identifier="bookid" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Numbered Nested Chapters</dc:title>
    <dc:creator>DreamReader</dc:creator>
    <dc:language>pt-BR</dc:language>
  </metadata>
  <manifest>
    <item id="intro" href="intro.xhtml" media-type="application/xhtml+xml"/>
    <item id="part" href="part.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-title" href="chapter-title.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-body" href="chapter-body.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-note" href="chapter_notas.xhtml" media-type="application/xhtml+xml"/>
    <item id="appendix-title" href="appendix-title.xhtml" media-type="application/xhtml+xml"/>
    <item id="appendix-body" href="appendix-body.xhtml" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="intro"/>
    <itemref idref="part"/>
    <itemref idref="chapter-title"/>
    <itemref idref="chapter-body"/>
    <itemref idref="chapter-note"/>
    <itemref idref="appendix-title"/>
    <itemref idref="appendix-body"/>
  </spine>
</package>`
  )
  zip.file(
    "toc.ncx",
    `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="por">
  <head><meta name="dtb:uid" content="bookid"/></head>
  <docTitle><text>Numbered Nested Chapters</text></docTitle>
  <navMap>
    <navPoint id="intro" playOrder="1"><navLabel><text>Introduction</text></navLabel><content src="intro.xhtml"/></navPoint>
    <navPoint id="part" playOrder="2">
      <navLabel><text>Part I</text></navLabel>
      <content src="part.xhtml"/>
      <navPoint id="chapter-title" playOrder="3">
        <navLabel><text>1. Numbered chapter</text></navLabel>
        <content src="chapter-title.xhtml"/>
        <navPoint id="chapter-body-topic" playOrder="4"><navLabel><text>Body topic</text></navLabel><content src="chapter-body.xhtml#topic"/></navPoint>
        <navPoint id="chapter-note" playOrder="5"><navLabel><text>Nota</text></navLabel><content src="chapter_notas.xhtml"/></navPoint>
      </navPoint>
    </navPoint>
    <navPoint id="appendix-title" playOrder="6">
      <navLabel><text>Appendix One</text></navLabel>
      <content src="appendix-title.xhtml"/>
      <navPoint id="appendix-topic-a" playOrder="7"><navLabel><text>First topic</text></navLabel><content src="appendix-body.xhtml#a"/></navPoint>
      <navPoint id="appendix-topic-b" playOrder="8"><navLabel><text>Second topic</text></navLabel><content src="appendix-body.xhtml#b"/></navPoint>
    </navPoint>
  </navMap>
</ncx>`
  )
  zip.file(
    "intro.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
  <head><title>Introduction</title></head>
  <body><h1>Introduction</h1><p>Intro body text.</p></body>
</html>`
  )
  zip.file(
    "part.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
  <head><title>Part I</title></head>
  <body><img src="part.png" alt=""/></body>
</html>`
  )
  zip.file(
    "chapter-title.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
  <head><title>Numbered chapter</title></head>
  <body><h1>Numbered chapter</h1></body>
</html>`
  )
  zip.file(
    "chapter-body.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
  <head><title>Body topic</title></head>
  <body><h2 id="topic">Body topic</h2><p>Merged body text.</p></body>
</html>`
  )
  zip.file(
    "chapter_notas.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
  <head><title>Nota</title></head>
  <body><p>Numbered note text.</p></body>
</html>`
  )
  zip.file(
    "appendix-title.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
  <head><title>Appendix One</title></head>
  <body><img src="appendix.png" alt=""/></body>
</html>`
  )
  zip.file(
    "appendix-body.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
  <head><title>Appendix body</title></head>
  <body><h2 id="a">First topic</h2><p>Appendix body text.</p><h2 id="b">Second topic</h2><p>More appendix text.</p></body>
</html>`
  )
  return zip.generateAsync({ type: "nodebuffer" })
}
