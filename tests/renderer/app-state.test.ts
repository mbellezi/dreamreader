import { describe, expect, it } from "vitest"
import {
  errorCode,
  initialChapterIndex,
  libraryImportStatusForError,
  libraryImportStatusForResult
} from "../../src/renderer/lib/appState"
import type { BookDetails, ImportBooksResult } from "../../src/renderer/types"

function book(overrides: Partial<BookDetails> = {}): BookDetails {
  return {
    id: "book-1",
    title: "Livro",
    authors: ["Autora"],
    language: "pt-BR",
    format: "epub",
    status: "reading",
    progress: 0,
    tags: [],
    updatedAt: "2026-06-06T12:00:00.000Z",
    coverColor: "#111827",
    chapters: [
      { id: "chapter-1", title: "Um", position: 1, text: "Primeiro" },
      { id: "chapter-2", title: "Dois", position: 2, text: "Segundo" }
    ],
    ...overrides
  }
}

function importResult(overrides: Partial<ImportBooksResult>): ImportBooksResult {
  return {
    books: [],
    importedCount: 0,
    importersUsed: [],
    skipped: [],
    ...overrides
  }
}

describe("initialChapterIndex", () => {
  it("prefers the chapter from the saved locator", () => {
    expect(
      initialChapterIndex(
        book({
          lastChapterId: "chapter-1",
          lastPosition: {
            bookId: "book-1",
            chapterId: "chapter-2",
            progress: 50,
            updatedAt: "2026-06-06T12:00:00.000Z"
          }
        })
      )
    ).toBe(1)
  })

  it("uses the legacy last chapter id when no locator exists", () => {
    expect(initialChapterIndex(book({ lastChapterId: "chapter-2" }))).toBe(1)
  })

  it("falls back to the first chapter when the stored chapter is missing", () => {
    expect(initialChapterIndex(book({ lastChapterId: "missing" }))).toBe(0)
  })
})

describe("libraryImportStatusForResult", () => {
  it("reports a full success", () => {
    expect(libraryImportStatusForResult(importResult({ importedCount: 2 }))).toEqual({
      tone: "success",
      messageKey: "library.importSuccess",
      values: { count: 2 }
    })
  })

  it("reports the effective importer for a full success", () => {
    expect(
      libraryImportStatusForResult(importResult({ importedCount: 1, importersUsed: ["readium-cli"] }))
    ).toEqual({
      tone: "success",
      messageKey: "library.importSuccessWithImporter",
      values: { count: 1 },
      valueKeys: { importer: "library.importer.readium-cli" }
    })
  })

  it("reports a partial import", () => {
    expect(
      libraryImportStatusForResult(
        importResult({
          importedCount: 1,
          skipped: [{ path: "/tmp/repeated.epub", reason: "duplicate" }]
        })
      )
    ).toEqual({
      tone: "warning",
      messageKey: "library.importPartial",
      values: { imported: 1, skipped: 1 }
    })
  })

  it("reports mixed importers for a partial import", () => {
    expect(
      libraryImportStatusForResult(
        importResult({
          importedCount: 2,
          importersUsed: ["readium-cli", "dreamreader-local"],
          skipped: [{ path: "/tmp/bad.pdf", reason: "unsupported_type" }]
        })
      )
    ).toEqual({
      tone: "warning",
      messageKey: "library.importPartialWithImporter",
      values: { imported: 2, skipped: 1 },
      valueKeys: { importer: "library.importer.mixed" }
    })
  })

  it("keeps duplicate-only skips informational", () => {
    expect(
      libraryImportStatusForResult(
        importResult({
          skipped: [
            { path: "/tmp/one.epub", reason: "duplicate" },
            { path: "/tmp/two.epub", reason: "duplicate" }
          ]
        })
      )
    ).toEqual({
      tone: "info",
      messageKey: "library.importSkipped.duplicate",
      values: { count: 2 }
    })
  })

  it("marks non-duplicate skips as errors", () => {
    expect(
      libraryImportStatusForResult(
        importResult({
          skipped: [{ path: "/tmp/bad.pdf", reason: "unsupported_type" }]
        })
      )
    ).toEqual({
      tone: "error",
      messageKey: "library.importSkipped.unsupported_type",
      values: { count: 1 }
    })
  })

  it("reports a cancelled import with no selected files", () => {
    expect(libraryImportStatusForResult(importResult({}))).toEqual({
      tone: "info",
      messageKey: "library.importNoSelection"
    })
  })
})

describe("libraryImportStatusForError", () => {
  it("uses the bridge-unavailable message for bridge errors", () => {
    expect(libraryImportStatusForError({ code: "library_import_requires_app_bridge" })).toEqual({
      tone: "error",
      messageKey: "library.importUnavailable"
    })
  })

  it("falls back to the generic import failure", () => {
    expect(libraryImportStatusForError(new Error("boom"))).toEqual({
      tone: "error",
      messageKey: "library.importFailed"
    })
  })
})

describe("errorCode", () => {
  it("extracts string codes from unknown errors", () => {
    expect(errorCode({ code: "known" })).toBe("known")
    expect(errorCode({ code: 123 })).toBeUndefined()
    expect(errorCode(null)).toBeUndefined()
  })
})
