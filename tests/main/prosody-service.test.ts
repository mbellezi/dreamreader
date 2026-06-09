import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { afterEach, describe, expect, it } from "vitest"
import type { AppDatabase } from "../../src/main/db/client"
import * as schema from "../../src/main/db/schema"
import { books } from "../../src/main/db/schema"
import { ProsodyService, type ProsodyAnalyzer } from "../../src/main/services/prosody-service"
import { buildNarrationPlan } from "../../src/main/services/tts-pipeline"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { force: true, recursive: true })
  }
})

describe("ProsodyService", () => {
  it("generates and reuses expressive prosody cache per segment", async () => {
    const { client, db } = await createTestDb()
    try {
      await seedBook(db)
      const service = new ProsodyService(db)
      const plan = testPlan()

      const first = await service.applyProsody(plan, true)
      expect(first.generatedCount).toBe(plan.segments.length)
      expect(first.cacheHits).toBe(0)
      expect(first.plan.prosody.analyzerId).toBe("llm-prosody-local")
      expect(first.plan.segments.some((segment) => segment.prosody.emotion === "suspense")).toBe(true)

      const second = await service.applyProsody(plan, true)
      expect(second.generatedCount).toBe(0)
      expect(second.cacheHits).toBe(plan.segments.length)
    } finally {
      await client.close()
    }
  })

  it("falls back to neutral prosody when structured LLM output fails", async () => {
    const { client, db } = await createTestDb()
    try {
      await seedBook(db)
      const failingAnalyzer: ProsodyAnalyzer = {
        id: "llm-prosody-local",
        promptVersion: "test-failure",
        version: "1.0.0",
        async analyze() {
          throw new Error("invalid llm output")
        }
      }
      const service = new ProsodyService(db, failingAnalyzer)
      const plan = testPlan()

      const result = await service.applyProsody(plan, true)

      expect(result.fallbackCount).toBe(plan.segments.length)
      expect(result.plan.segments.every((segment) => segment.prosody.instructionPtBr.length > 0)).toBe(true)
      expect(result.plan.prosody.promptVersion).toBe("test-failure")
    } finally {
      await client.close()
    }
  })
})

async function createTestDb() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dreamreader-prosody-"))
  tempDirs.push(tempDir)
  const client = new PGlite(path.join(tempDir, "db"))
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: path.resolve("drizzle") })
  return { client, db }
}

async function seedBook(db: AppDatabase) {
  await db.insert(books).values({
    id: "book-prosody",
    contentHash: "book-prosody-hash",
    fileType: "txt",
    title: "Livro de Prosodia",
    authors: ["DreamReader"],
    language: "pt-BR",
    libraryPath: "/tmp/book-prosody.txt",
    manifestJson: {}
  })
}

function testPlan() {
  return buildNarrationPlan({
    bookId: "book-prosody",
    chapterHref: "chapter-1",
    contentHash: "chapter-hash",
    html: "<article><p>A sombra cresceu no silêncio.</p><p>— Vamos embora?</p></article>",
    language: "pt-BR"
  })
}
