import { app } from "electron"
import path from "node:path"

export type AppPaths = {
  appRoot: string
  resourcesDir: string
  userData: string
  dbDir: string
  booksDir: string
  coversDir: string
  extractedDir: string
  audioCacheDir: string
  audiobooksDir: string
  voicesDir: string
  modelsDir: string
  runtimeDir: string
  pythonDir: string
  runtimeDownloadsDir: string
  runtimeCacheDir: string
  huggingFaceDir: string
  sidecarsDir: string
  logsDir: string
  backupsDir: string
}

export function getAppPaths(): AppPaths {
  const appRoot = app.getAppPath()
  const resourcesDir = app.isPackaged ? electronResourcesPath() : appRoot
  const userData = app.getPath("userData")
  return {
    appRoot,
    resourcesDir,
    userData,
    dbDir: path.join(userData, "db", "pglite"),
    booksDir: path.join(userData, "library", "books"),
    coversDir: path.join(userData, "library", "covers"),
    extractedDir: path.join(userData, "library", "extracted"),
    audioCacheDir: path.join(userData, "audio-cache"),
    audiobooksDir: path.join(userData, "audiobooks"),
    voicesDir: path.join(userData, "voices"),
    modelsDir: path.join(userData, "models"),
    runtimeDir: path.join(userData, "runtimes"),
    pythonDir: path.join(userData, "runtimes", "python"),
    runtimeDownloadsDir: path.join(userData, "runtimes", "downloads"),
    runtimeCacheDir: path.join(userData, "runtime-cache"),
    huggingFaceDir: path.join(userData, "huggingface"),
    sidecarsDir: path.join(resourcesDir, "sidecars"),
    logsDir: path.join(userData, "logs"),
    backupsDir: path.join(userData, "backups")
  }
}

function electronResourcesPath(): string {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? path.dirname(app.getAppPath())
}
