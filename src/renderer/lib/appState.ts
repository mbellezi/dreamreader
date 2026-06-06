import type { LibraryStatusDescriptor } from "@renderer/app/types"
import type { BookDetails, ImportBooksResult } from "@renderer/types"

export function initialChapterIndex(book: BookDetails | null): number {
  const lastChapterId = book?.lastPosition?.chapterId ?? book?.lastChapterId
  if (!book?.chapters.length || !lastChapterId) {
    return 0
  }

  const index = book.chapters.findIndex((chapter) => chapter.id === lastChapterId)
  return index >= 0 ? index : 0
}

export function libraryImportStatusForResult(result: ImportBooksResult): LibraryStatusDescriptor {
  if (result.importedCount > 0 && result.skipped.length === 0) {
    return {
      tone: "success",
      messageKey: "library.importSuccess",
      values: { count: result.importedCount }
    }
  }

  if (result.importedCount > 0 && result.skipped.length > 0) {
    return {
      tone: "warning",
      messageKey: "library.importPartial",
      values: {
        imported: result.importedCount,
        skipped: result.skipped.length
      }
    }
  }

  if (result.skipped.length > 0) {
    return {
      tone: result.skipped.every((item) => item.reason === "duplicate") ? "info" : "error",
      messageKey: `library.importSkipped.${result.skipped[0].reason}`,
      values: { count: result.skipped.length }
    }
  }

  return { tone: "info", messageKey: "library.importNoSelection" }
}

export function libraryImportStatusForError(error: unknown): LibraryStatusDescriptor {
  return {
    tone: "error",
    messageKey: errorCode(error) === "library_import_requires_app_bridge"
      ? "library.importUnavailable"
      : "library.importFailed"
  }
}

export function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined
}
