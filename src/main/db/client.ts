import { mkdir } from "node:fs/promises"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import * as schema from "./schema"

export type AppDatabase = ReturnType<typeof drizzle<typeof schema>>

let dbPromise: Promise<AppDatabase> | undefined

export type DatabasePaths = {
  rootDir: string
  dbDir: string
}

export async function createDatabase(paths: DatabasePaths): Promise<AppDatabase> {
  await mkdir(paths.dbDir, { recursive: true })
  const client = new PGlite(paths.dbDir)
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: path.join(paths.rootDir, "drizzle") }).catch(async (error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return
    }
    throw error
  })
  return db
}

export function getDatabase(paths: DatabasePaths): Promise<AppDatabase> {
  dbPromise ??= createDatabase(paths)
  return dbPromise
}

