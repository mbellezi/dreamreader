import { and, asc, eq, or } from "drizzle-orm"
import {
  PronunciationEntrySchema,
  type CreatePronunciationEntryRequest,
  type ListPronunciationEntriesRequest,
  type PronunciationEntry,
  type UpdatePronunciationEntryRequest
} from "@shared/contracts/ai"
import type { AppDatabase } from "@main/db/client"
import { pronunciationEntries } from "@main/db/schema"
import { AppError } from "@main/lib/errors"
import { createId } from "@main/lib/ids"

export class PronunciationService {
  constructor(private readonly db: AppDatabase) {}

  async list(input: Partial<ListPronunciationEntriesRequest> = {}): Promise<PronunciationEntry[]> {
    const includeGlobal = input.includeGlobal ?? true
    const rows = await this.db.query.pronunciationEntries.findMany({
      orderBy: [asc(pronunciationEntries.scope), asc(pronunciationEntries.pattern)]
    })

    return rows
      .filter((row) => {
        if (row.scope === "global") {
          return includeGlobal
        }
        return Boolean(input.bookId) && row.bookId === input.bookId
      })
      .map(toPronunciationEntry)
  }

  async entriesForBook(bookId: string): Promise<PronunciationEntry[]> {
    const rows = await this.db.query.pronunciationEntries.findMany({
      where: or(eq(pronunciationEntries.scope, "global"), eq(pronunciationEntries.bookId, bookId)),
      orderBy: [asc(pronunciationEntries.scope), asc(pronunciationEntries.pattern)]
    })
    return rows.map(toPronunciationEntry)
  }

  async create(input: CreatePronunciationEntryRequest): Promise<PronunciationEntry> {
    if (input.scope === "book" && !input.bookId) {
      throw new AppError("pronunciation_book_required", "Book scoped pronunciation entries require a book")
    }
    const now = new Date()
    const [created] = await this.db
      .insert(pronunciationEntries)
      .values({
        id: createId("pronunciation"),
        scope: input.scope,
        bookId: input.scope === "book" ? input.bookId : undefined,
        pattern: input.pattern,
        replacement: input.replacement,
        matchKind: input.matchKind,
        caseSensitive: input.caseSensitive,
        updatedAt: now
      })
      .returning()
    return toPronunciationEntry(created)
  }

  async update(input: UpdatePronunciationEntryRequest): Promise<PronunciationEntry> {
    await this.getRow(input.id)
    const [updated] = await this.db
      .update(pronunciationEntries)
      .set({
        pattern: input.pattern,
        replacement: input.replacement,
        matchKind: input.matchKind,
        caseSensitive: input.caseSensitive,
        updatedAt: new Date()
      })
      .where(eq(pronunciationEntries.id, input.id))
      .returning()
    return toPronunciationEntry(updated)
  }

  async delete(id: string) {
    await this.getRow(id)
    await this.db.delete(pronunciationEntries).where(eq(pronunciationEntries.id, id))
    return { deleted: true as const }
  }

  private async getRow(id: string) {
    const row = await this.db.query.pronunciationEntries.findFirst({
      where: and(eq(pronunciationEntries.id, id))
    })
    if (!row) {
      throw new AppError("pronunciation_entry_not_found", "Pronunciation entry not found")
    }
    return row
  }
}

function toPronunciationEntry(row: typeof pronunciationEntries.$inferSelect): PronunciationEntry {
  return PronunciationEntrySchema.parse({
    id: row.id,
    scope: row.scope,
    bookId: row.bookId ?? undefined,
    pattern: row.pattern,
    replacement: row.replacement,
    matchKind: row.matchKind,
    caseSensitive: row.caseSensitive,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  })
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}
