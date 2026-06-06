import { app, BrowserWindow, protocol, shell } from "electron"
import path from "node:path"
import { getDatabase } from "@main/db/client"
import { registerIpc } from "@main/ipc/register"
import { getAppPaths } from "@main/lib/paths"
import { registerAssetProtocol } from "@main/protocol/asset-protocol"
import { AudiobookService } from "@main/services/audiobook-service"
import { LibraryService } from "@main/services/library-service"
import { RuntimeService } from "@main/services/runtime-service"
import { TtsService } from "@main/services/tts-service"
import { VoiceService } from "@main/services/voice-service"

protocol.registerSchemesAsPrivileged([
  {
    scheme: "dreamreader",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  }
])

let mainWindow: BrowserWindow | undefined

async function createWindow() {
  const paths = getAppPaths()
  const db = await getDatabase({ rootDir: app.getAppPath(), dbDir: paths.dbDir })
  registerAssetProtocol(db)
  const audiobook = new AudiobookService(db, paths)
  const tts = new TtsService(db, paths, audiobook)
  registerIpc({
    library: new LibraryService(db, paths),
    runtime: new RuntimeService(db, paths),
    tts,
    voices: new VoiceService(),
    audiobook
  })
  void tts.resumePendingJobs()

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "DreamReader",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on("ready-to-show", () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: "deny" }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"))
  }
}

app.whenReady().then(async () => {
  await createWindow()
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow()
    }
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
