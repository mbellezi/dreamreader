import type { AudiobookExport } from "@shared/contracts/ai"
import { createId } from "@main/lib/ids"

export class AudiobookService {
  private readonly exports = new Map<string, AudiobookExport>()

  getExport(bookId: string) {
    return this.ensureExport(bookId)
  }

  setAutoBuild(bookId: string, enabled: boolean) {
    return this.updateExport(bookId, {
      autoBuildEnabled: enabled,
      metadata: {
        autoBuildPolicy: enabled ? "enabled" : "disabled"
      }
    })
  }

  rebuild(bookId: string) {
    return this.updateExport(bookId, {
      status: "stale",
      stale: true,
      metadata: {
        rebuildRequestedAt: new Date().toISOString(),
        reason: "chapter_audio_missing"
      }
    })
  }

  reveal(bookId: string) {
    this.ensureExport(bookId)
    return { revealed: true as const }
  }

  private updateExport(bookId: string, patch: Partial<AudiobookExport>): AudiobookExport {
    const current = this.ensureExport(bookId)
    const updated: AudiobookExport = {
      ...current,
      ...patch,
      metadata: {
        ...current.metadata,
        ...patch.metadata
      },
      updatedAt: new Date().toISOString()
    }
    this.exports.set(bookId, updated)
    return updated
  }

  private ensureExport(bookId: string): AudiobookExport {
    const existing = this.exports.get(bookId)
    if (existing) {
      return existing
    }
    const now = new Date().toISOString()
    const created: AudiobookExport = {
      id: createId("audiobook"),
      bookId,
      status: "none",
      autoBuildEnabled: false,
      format: "m4b",
      metadata: {
        builder: "dreamreader-m4b-v1",
        mode: "incremental"
      },
      chaptersReady: 0,
      chaptersTotal: 0,
      durationMs: 0,
      stale: false,
      createdAt: now,
      updatedAt: now
    }
    this.exports.set(bookId, created)
    return created
  }
}
