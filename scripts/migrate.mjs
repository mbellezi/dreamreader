import { mkdir } from "node:fs/promises"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"

const rootDir = process.cwd()
const dbDir = path.join(rootDir, ".dreamreader-dev", "db", "pglite")

await mkdir(dbDir, { recursive: true })
const client = new PGlite(dbDir)
const db = drizzle(client)
await migrate(db, { migrationsFolder: path.join(rootDir, "drizzle") })
await client.close()
console.log(`Migrations applied to ${dbDir}`)
