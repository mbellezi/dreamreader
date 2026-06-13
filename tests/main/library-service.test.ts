import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import JSZip from "jszip"
import { afterEach, describe, expect, it } from "vitest"
import * as schema from "../../src/main/db/schema"
import { LibraryService } from "../../src/main/services/library-service"

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
      const imported = result.imported[0] as { id: string; title: string }

      expect(result.skipped).toEqual([])
      expect(imported.title).toBe("Livro de Teste")

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

async function createTestLibrary() {
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
    service: new LibraryService(db, paths),
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
