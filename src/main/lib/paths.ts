import { app } from "electron"
import path from "node:path"

export type AppPaths = {
  userData: string
  dbDir: string
  booksDir: string
  coversDir: string
  extractedDir: string
  audioCacheDir: string
  audiobooksDir: string
  voicesDir: string
  modelsDir: string
  logsDir: string
  backupsDir: string
}

export function getAppPaths(): AppPaths {
  const userData = app.getPath("userData")
  return {
    userData,
    dbDir: path.join(userData, "db", "pglite"),
    booksDir: path.join(userData, "library", "books"),
    coversDir: path.join(userData, "library", "covers"),
    extractedDir: path.join(userData, "library", "extracted"),
    audioCacheDir: path.join(userData, "audio-cache"),
    audiobooksDir: path.join(userData, "audiobooks"),
    voicesDir: path.join(userData, "voices"),
    modelsDir: path.join(userData, "models"),
    logsDir: path.join(userData, "logs"),
    backupsDir: path.join(userData, "backups")
  }
}

