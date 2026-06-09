import { dialog, ipcMain } from "electron"
import { z } from "zod"
import { IpcContractSchemas, type IpcChannel } from "@shared/contracts/ipc"
import { AudiobookService } from "@main/services/audiobook-service"
import { LibraryService } from "@main/services/library-service"
import { PronunciationService } from "@main/services/pronunciation-service"
import { RuntimeService } from "@main/services/runtime-service"
import { TtsService } from "@main/services/tts-service"
import { VoiceService } from "@main/services/voice-service"
import { probeAudio } from "@main/lib/audio-transcode"
import { toIpcError } from "@main/lib/errors"

type Services = {
  library: LibraryService
  runtime: RuntimeService
  tts: TtsService
  voices: VoiceService
  audiobook: AudiobookService
  pronunciation: PronunciationService
}

const contract = IpcContractSchemas

export function registerIpc(services: Services): void {
  handle("library.importFiles", contract["library.importFiles"].request, async (input) => {
    const candidatePaths = input.filePaths.length ? input.filePaths : input.files.map((file) => file.path)
    const filePaths = candidatePaths.length
      ? candidatePaths
      : (
        await dialog.showOpenDialog({
          properties: ["openFile", "multiSelections"],
          filters: [
            { name: "Books", extensions: ["epub", "txt", "md", "markdown", "html", "htm"] }
          ]
        })
      ).filePaths
    return services.library.importFiles(filePaths)
  })

  handle("library.listBooks", contract["library.listBooks"].request, (input) => services.library.listBooks(input.query))
  handle("library.updateBookMetadata", contract["library.updateBookMetadata"].request, (input) =>
    services.library.updateBookMetadata(input)
  )
  handle("reader.openBook", contract["reader.openBook"].request, (input) => services.library.openBook(input.bookId))
  handle("reader.getResource", contract["reader.getResource"].request, (input) => services.library.getResource(input))
  handle("reader.saveLocator", contract["reader.saveLocator"].request, (input) =>
    services.library.saveReadingPosition({
      bookId: input.bookId,
      locator: input.locator,
      chapterHref: input.chapterHref,
      progression: input.progression ?? 0
    })
  )
  handle("annotations.create", contract["annotations.create"].request, (input) => services.library.createAnnotation(input))
  handle("annotations.update", contract["annotations.update"].request, (input) => services.library.updateAnnotation(input))
  handle("annotations.delete", contract["annotations.delete"].request, (input) => services.library.deleteAnnotation(input.id))
  handle("annotations.export", contract["annotations.export"].request, (input) => services.library.exportAnnotations(input))
  handle("bookmarks.create", contract["bookmarks.create"].request, (input) => services.library.createBookmark(input))
  handle("tts.enqueueChapter", contract["tts.enqueueChapter"].request, (input) => services.tts.enqueueChapter(input))
  handle("tts.enqueueChapters", contract["tts.enqueueChapters"].request, (input) => services.tts.enqueueChapters(input))
  handle("tts.cancelJob", contract["tts.cancelJob"].request, (input) => services.tts.cancelJob(input.id))
  handle("tts.pauseJob", contract["tts.pauseJob"].request, (input) => services.tts.pauseJob(input.id))
  handle("tts.resumeJob", contract["tts.resumeJob"].request, (input) => services.tts.resumeJob(input.id))
  handle("tts.retryJob", contract["tts.retryJob"].request, (input) => services.tts.retryJob(input.id))
  handle("tts.getJob", contract["tts.getJob"].request, (input) => services.tts.getJob(input.id))
  handle("tts.listJobs", contract["tts.listJobs"].request, (input) => services.tts.listJobs(input))
  handle("tts.listSegments", contract["tts.listSegments"].request, (input) => services.tts.listSegments(input.jobId))
  handle("tts.clearChapterAudio", contract["tts.clearChapterAudio"].request, (input) => services.tts.clearChapterAudio(input))
  handle("tts.clearTerminalJobs", contract["tts.clearTerminalJobs"].request, (input) => services.tts.clearTerminalJobs(input))
  handle("settings.get", contract["settings.get"].request, () => services.library.getSettings())
  handle("settings.update", contract["settings.update"].request, (input) => services.library.updateSettings(input))
  handle("models.list", contract["models.list"].request, () => services.runtime.listModels())
  handle("models.diagnostics", contract["models.diagnostics"].request, () => services.runtime.diagnostics())
  handle("models.downloads", contract["models.downloads"].request, () => services.runtime.listModelDownloadJobs())
  handle("models.operations", contract["models.operations"].request, () => services.runtime.listOperations())
  handle("models.huggingFaceToken", contract["models.huggingFaceToken"].request, () =>
    services.runtime.getHuggingFaceTokenStatus()
  )
  handle("models.updateHuggingFaceToken", contract["models.updateHuggingFaceToken"].request, (input) =>
    services.runtime.updateHuggingFaceToken(input.token)
  )
  handle("models.installFromPath", contract["models.installFromPath"].request, async (input) => {
    const selectedPath =
      input.path ??
      (
        await dialog.showOpenDialog({
          properties: ["openDirectory"]
        })
      ).filePaths[0]
    return selectedPath ? services.runtime.installFromPath(selectedPath) : null
  })
  handle("models.installRecommended", contract["models.installRecommended"].request, (input) =>
    services.runtime.installRecommendedModel(input.modelId, input.backend)
  )
  handle("models.download", contract["models.download"].request, (input) => services.runtime.downloadModel(input.modelId))
  handle("models.delete", contract["models.delete"].request, (input) =>
    services.runtime.deleteModel(input.modelId, input.deleteFiles)
  )
  handle("sidecars.list", contract["sidecars.list"].request, () => services.runtime.listSidecars())
  handle("sidecars.install", contract["sidecars.install"].request, (input) => services.runtime.installSidecar(input.sidecarId, input.backend))
  handle("sidecars.uninstall", contract["sidecars.uninstall"].request, (input) =>
    services.runtime.uninstallSidecar(input.sidecarId)
  )
  handle("pronunciation.list", contract["pronunciation.list"].request, (input) => services.pronunciation.list(input))
  handle("pronunciation.create", contract["pronunciation.create"].request, (input) => services.pronunciation.create(input))
  handle("pronunciation.update", contract["pronunciation.update"].request, (input) => services.pronunciation.update(input))
  handle("pronunciation.delete", contract["pronunciation.delete"].request, (input) => services.pronunciation.delete(input.id))
  handle("voices.list", contract["voices.list"].request, (input) => services.voices.list(input))
  handle("voices.createFromReference", contract["voices.createFromReference"].request, (input) =>
    services.voices.createFromReference(input)
  )
  handle("voices.createFromDesignPrompt", contract["voices.createFromDesignPrompt"].request, (input) =>
    services.voices.createFromDesignPrompt(input)
  )
  handle("voices.selectReferenceAudio", contract["voices.selectReferenceAudio"].request, async () => {
    const selectedPath = (
      await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: [
          { name: "Audio", extensions: ["wav", "mp3", "m4a", "flac", "ogg"] }
        ]
      })
    ).filePaths[0]
    if (!selectedPath) {
      return {}
    }
    const probe = await probeAudio(selectedPath)
    return { path: selectedPath, durationMs: probe.durationMs, sampleRate: probe.sampleRate }
  })
  handle("voices.preview", contract["voices.preview"].request, (input) => services.voices.preview(input))
  handle("voices.update", contract["voices.update"].request, (input) => services.voices.update(input))
  handle("voices.delete", contract["voices.delete"].request, (input) => services.voices.delete(input))
  handle("voices.export", contract["voices.export"].request, async (input) => {
    const selectedPath = (
      await dialog.showSaveDialog({
        defaultPath: await services.voices.exportFileName(input.voiceProfileId),
        filters: [{ name: "DreamReader Voice", extensions: ["zip"] }]
      })
    ).filePath
    return selectedPath ? services.voices.exportVoice({ voiceProfileId: input.voiceProfileId, targetPath: selectedPath }) : { exported: false }
  })
  handle("voices.import", contract["voices.import"].request, async (input) => {
    const archivePaths = input.archivePaths.length
      ? input.archivePaths
      : (
          await dialog.showOpenDialog({
            properties: ["openFile", "multiSelections"],
            filters: [{ name: "DreamReader Voice", extensions: ["zip"] }]
          })
        ).filePaths
    return { imported: archivePaths.length ? await services.voices.importVoices({ archivePaths }) : [] }
  })
  handle("voices.listCompatible", contract["voices.listCompatible"].request, (input) =>
    services.voices.listCompatible(input.engineId)
  )
  handle("audiobook.getExport", contract["audiobook.getExport"].request, (input) => services.audiobook.getExport(input.bookId))
  handle("audiobook.listLibraryStatus", contract["audiobook.listLibraryStatus"].request, () =>
    services.audiobook.listLibraryStatus()
  )
  handle("audiobook.enableAutoBuild", contract["audiobook.enableAutoBuild"].request, (input) =>
    services.audiobook.setAutoBuild(input.bookId, input.enabled)
  )
  handle("audiobook.rebuild", contract["audiobook.rebuild"].request, (input) => services.audiobook.rebuild(input.bookId))
  handle("audiobook.reveal", contract["audiobook.reveal"].request, (input) => services.audiobook.reveal(input.bookId))
}

function handle<TSchema extends z.ZodType, TResult>(
  channel: IpcChannel,
  schema: TSchema,
  callback: (input: z.infer<TSchema>) => Promise<TResult> | TResult
) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      const input = schema.parse(payload ?? {})
      return { ok: true, data: await callback(input) }
    } catch (error) {
      return { ok: false, error: toIpcError(error) }
    }
  })
}
