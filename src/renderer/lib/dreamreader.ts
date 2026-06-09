import type {
  Annotation,
  AnnotationDraft,
  AnnotationUpdateDraft,
  AppSettings,
  AudiobookExport,
  BookDetails,
  BookSummary,
  ImportBooksResult,
  LibraryAudioStatus,
  LibraryQuery,
  HuggingFaceTokenStatus,
  ModelDownloadJob,
  PronunciationEntry,
  ReaderLocator,
  RuntimeDiagnostic,
  RuntimeModel,
  RuntimeOperationJob,
  RuntimeOperationLogEntry,
  RuntimeSidecar,
  TtsJob,
  TtsSegment,
  VoiceProfile
} from "@renderer/types"
import { defaultSettings, sampleAnnotations, sampleBooks } from "@renderer/lib/sampleData"
import { clamp, normalizeSearch } from "@renderer/lib/utils"

type SegmentProsody = NonNullable<TtsSegment["prosody"]>

const STORAGE_KEY = "dreamreader.renderer.fallback"

type FallbackState = {
  books: BookDetails[]
  annotations: Annotation[]
  settings: AppSettings
  positions: Record<string, ReaderLocator>
}

function readFallbackState(): FallbackState {
  const stored = window.localStorage.getItem(STORAGE_KEY)

  if (!stored) {
    return {
      books: sampleBooks,
      annotations: sampleAnnotations,
      settings: normalizeSettings(defaultSettings),
      positions: {}
    }
  }

  try {
    const parsed = JSON.parse(stored) as Partial<FallbackState>

    return {
      books: parsed.books?.length ? parsed.books : sampleBooks,
      annotations: parsed.annotations ?? sampleAnnotations,
      settings: normalizeSettings(parsed.settings),
      positions: parsed.positions ?? {}
    }
  } catch {
    return {
      books: sampleBooks,
      annotations: sampleAnnotations,
      settings: normalizeSettings(defaultSettings),
      positions: {}
    }
  }
}

function writeFallbackState(state: FallbackState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function toSummary(book: BookDetails): BookSummary {
  const {
    chapters: _chapters,
    description: _description,
    lastChapterId: _lastChapterId,
    lastPosition: _lastPosition,
    publisher: _publisher,
    ...summary
  } = book
  return summary
}

function filterBooks(books: BookDetails[], query?: LibraryQuery): BookSummary[] {
  const search = normalizeSearch(query?.search ?? "")

  return books
    .filter((book) => {
      if (!search) {
        return true
      }

      return normalizeSearch([book.title, ...book.authors, ...book.tags, book.collection ?? ""].join(" ")).includes(search)
    })
    .map(toSummary)
}

function normalizeSettings(settings?: Partial<AppSettings>): AppSettings {
  return {
    ...defaultSettings,
    ...settings,
    reader: {
      ...defaultSettings.reader,
      ...settings?.reader
    },
    audio: {
      ...defaultSettings.audio,
      ...settings?.audio,
      generationLanguageByEngineId: {
        ...defaultSettings.audio.generationLanguageByEngineId,
        ...settings?.audio?.generationLanguageByEngineId
      },
      modelSettingsByEngineId: {
        ...defaultSettings.audio.modelSettingsByEngineId,
        ...settings?.audio?.modelSettingsByEngineId
      }
    }
  }
}

function exportAnnotations(book: BookDetails | undefined, annotations: Annotation[], format: "markdown" | "json"): string {
  if (format === "json") {
    return JSON.stringify(annotations, null, 2)
  }

  const title = book?.title ?? "DreamReader"
  const lines = [`# ${title}`, ""]

  annotations.forEach((annotation) => {
    const chapter = book?.chapters.find((item) => item.id === annotation.chapterId)
    lines.push(`## ${chapter?.title ?? annotation.chapterId}`)
    lines.push("")
    lines.push(`> ${annotation.excerpt}`)
    if (annotation.note) {
      lines.push("")
      lines.push(annotation.note)
    }
    lines.push("")
  })

  return lines.join("\n")
}

export const dreamreaderClient = {
  hasBridge(): boolean {
    return Boolean(window.dreamreader)
  },

  async listBooks(query?: LibraryQuery): Promise<BookSummary[]> {
    const bridgeList = window.dreamreader?.library?.listBooks

    if (bridgeList) {
      return bridgeList(query)
    }

    return filterBooks(readFallbackState().books, query)
  },

  async getBook(bookId: string): Promise<BookDetails | null> {
    const bridgeGet = window.dreamreader?.library?.getBook

    if (bridgeGet) {
      return bridgeGet(bookId)
    }

    const state = readFallbackState()
    const book = state.books.find((item) => item.id === bookId)
    return book
      ? {
        ...book,
        lastChapterId: state.positions[bookId]?.chapterId,
        lastPosition: state.positions[bookId]
      }
      : null
  },

  async importBooks(): Promise<ImportBooksResult> {
    const bridgeImport = window.dreamreader?.library?.importBooks

    if (bridgeImport) {
      return bridgeImport()
    }

    throw Object.assign(new Error("Import requires the Electron bridge"), {
      code: "library_import_requires_app_bridge"
    })
  },

  async saveProgress(locator: ReaderLocator): Promise<void> {
    const bridgeSave = window.dreamreader?.reader?.saveProgress

    if (bridgeSave) {
      await bridgeSave(locator)
      return
    }

    const state = readFallbackState()
    const bookIndex = state.books.findIndex((book) => book.id === locator.bookId)

    if (bookIndex >= 0) {
      state.books[bookIndex] = {
        ...state.books[bookIndex],
        progress: locator.progress,
        status: locator.progress >= 100 ? "finished" : "reading",
        updatedAt: locator.updatedAt
      }
      state.positions[locator.bookId] = locator
      writeFallbackState(state)
    }
  },

  async listAnnotations(bookId: string): Promise<Annotation[]> {
    const bridgeList = window.dreamreader?.reader?.listAnnotations

    if (bridgeList) {
      return bridgeList(bookId)
    }

    return readFallbackState().annotations.filter((annotation) => annotation.bookId === bookId)
  },

  async createAnnotation(draft: AnnotationDraft): Promise<Annotation> {
    const bridgeCreate = window.dreamreader?.reader?.createAnnotation

    if (bridgeCreate) {
      return bridgeCreate(draft)
    }

    const state = readFallbackState()
    const annotation: Annotation = {
      ...draft,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    }
    state.annotations = [annotation, ...state.annotations]
    writeFallbackState(state)
    return annotation
  },

  async updateAnnotation(draft: AnnotationUpdateDraft): Promise<Annotation> {
    const bridgeUpdate = window.dreamreader?.reader?.updateAnnotation

    if (bridgeUpdate) {
      return bridgeUpdate(draft)
    }

    const state = readFallbackState()
    const annotationIndex = state.annotations.findIndex((annotation) => annotation.id === draft.id)

    if (annotationIndex < 0) {
      throw Object.assign(new Error("Annotation not found"), {
        code: "annotation_not_found"
      })
    }

    const annotation = {
      ...state.annotations[annotationIndex],
      color: draft.color ?? state.annotations[annotationIndex].color,
      note: draft.note ?? state.annotations[annotationIndex].note
    }
    state.annotations[annotationIndex] = annotation
    writeFallbackState(state)
    return annotation
  },

  async deleteAnnotation(annotationId: string): Promise<void> {
    const bridgeDelete = window.dreamreader?.reader?.deleteAnnotation

    if (bridgeDelete) {
      await bridgeDelete(annotationId)
      return
    }

    const state = readFallbackState()
    state.annotations = state.annotations.filter((annotation) => annotation.id !== annotationId)
    writeFallbackState(state)
  },

  async exportNotes(bookId: string, format: "markdown" | "json"): Promise<string> {
    const bridgeExport = window.dreamreader?.reader?.exportNotes

    if (bridgeExport) {
      return bridgeExport(bookId, format)
    }

    const state = readFallbackState()
    const book = state.books.find((item) => item.id === bookId)
    const annotations = state.annotations.filter((annotation) => annotation.bookId === bookId)
    return exportAnnotations(book, annotations, format)
  },

  async getSettings(): Promise<AppSettings> {
    const bridgeGet = window.dreamreader?.settings?.getSettings

    if (bridgeGet) {
      return bridgeGet()
    }

    return readFallbackState().settings
  },

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    const bridgeSave = window.dreamreader?.settings?.saveSettings

    if (bridgeSave) {
      return bridgeSave(settings)
    }

    const state = readFallbackState()
    state.settings = settings
    writeFallbackState(state)
    return settings
  },

  async enqueueChapterAudio(input: {
    bookId: string
    chapterHref: string
    engineId?: string
    generationLanguage?: string
    modelSettings?: Record<string, unknown>
    quality?: "draft" | "standard" | "high"
    seed?: number
    seedFixed?: boolean
    voiceProfileId?: string
    useExpressiveNarration?: boolean
    paragraphLimit?: number
  }): Promise<TtsJob> {
    const bridgeEnqueue = window.dreamreader?.tts?.enqueueChapter

    if (bridgeEnqueue) {
      return toTtsJob(await bridgeEnqueue(input))
    }

    return fallbackTtsJob(input.bookId, input.chapterHref, "completed")
  },

  async enqueueChaptersAudio(input: {
    bookId: string
    chapterHrefs?: string[]
    engineId?: string
    generationLanguage?: string
    modelSettings?: Record<string, unknown>
    quality?: "draft" | "standard" | "high"
    seed?: number
    seedFixed?: boolean
    voiceProfileId?: string
    useExpressiveNarration?: boolean
  }): Promise<TtsJob[]> {
    const bridgeEnqueue = window.dreamreader?.tts?.enqueueChapters

    if (bridgeEnqueue) {
      return (await bridgeEnqueue(input)).map(toTtsJob)
    }

    return []
  },

  async cancelTtsJob(id: string): Promise<TtsJob> {
    const bridgeCancel = window.dreamreader?.tts?.cancelJob

    if (bridgeCancel) {
      return toTtsJob(await bridgeCancel(id))
    }

    return fallbackTtsJob("fallback-book", "chapter-1", "cancelled", id)
  },

  async pauseTtsJob(id: string): Promise<TtsJob> {
    const bridgePause = window.dreamreader?.tts?.pauseJob

    if (bridgePause) {
      return toTtsJob(await bridgePause(id))
    }

    return fallbackTtsJob("fallback-book", "chapter-1", "paused", id)
  },

  async resumeTtsJob(id: string): Promise<TtsJob> {
    const bridgeResume = window.dreamreader?.tts?.resumeJob

    if (bridgeResume) {
      return toTtsJob(await bridgeResume(id))
    }

    return fallbackTtsJob("fallback-book", "chapter-1", "queued", id)
  },

  async retryTtsJob(id: string): Promise<TtsJob> {
    const bridgeRetry = window.dreamreader?.tts?.retryJob

    if (bridgeRetry) {
      return toTtsJob(await bridgeRetry(id))
    }

    return fallbackTtsJob("fallback-book", "chapter-1", "queued", id)
  },

  async listTtsJobs(filter?: { bookId?: string; engineId?: string }): Promise<TtsJob[]> {
    const bridgeList = window.dreamreader?.tts?.listJobs

    if (bridgeList) {
      return (await bridgeList(filter)).map(toTtsJob)
    }

    return []
  },

  async listTtsSegments(jobId: string): Promise<TtsSegment[]> {
    const bridgeList = window.dreamreader?.tts?.listSegments

    if (bridgeList) {
      return (await bridgeList(jobId)).map(toTtsSegment)
    }

    return []
  },

  async clearChapterAudio(input: { bookId: string; chapterHref: string }): Promise<void> {
    const bridgeClear = window.dreamreader?.tts?.clearChapterAudio

    if (bridgeClear) {
      await bridgeClear(input)
    }
  },

  async clearTerminalTtsJobs(bookId: string): Promise<void> {
    const bridgeClear = window.dreamreader?.tts?.clearTerminalJobs

    if (bridgeClear) {
      await bridgeClear({ bookId })
    }
  },

  async listLibraryAudioStatus(): Promise<LibraryAudioStatus[]> {
    const bridgeList = window.dreamreader?.audiobook?.listLibraryStatus

    if (bridgeList) {
      return (await bridgeList()).map(toLibraryAudioStatus)
    }

    return []
  },

  async getAudiobookExport(bookId: string): Promise<AudiobookExport | null> {
    const bridgeGet = window.dreamreader?.audiobook?.getExport

    if (bridgeGet) {
      return toAudiobookExport(await bridgeGet(bookId))
    }

    return null
  },

  async setAudiobookAutoBuild(bookId: string, enabled: boolean): Promise<AudiobookExport | null> {
    const bridgeSet = window.dreamreader?.audiobook?.enableAutoBuild

    if (bridgeSet) {
      return toAudiobookExport(await bridgeSet(bookId, enabled))
    }

    return {
      id: `fallback-audiobook-${bookId}`,
      bookId,
      status: "none",
      autoBuildEnabled: enabled,
      chaptersReady: 0,
      chaptersTotal: 0,
      stale: false
    }
  },

  async rebuildAudiobook(bookId: string): Promise<AudiobookExport | null> {
    const bridgeRebuild = window.dreamreader?.audiobook?.rebuild

    if (bridgeRebuild) {
      return toAudiobookExport(await bridgeRebuild(bookId))
    }

    return null
  },

  async listModelDiagnostics(): Promise<RuntimeDiagnostic[]> {
    const bridgeDiagnostics = window.dreamreader?.models?.diagnostics

    if (bridgeDiagnostics) {
      return (await bridgeDiagnostics()).map(toRuntimeDiagnostic)
    }

    return [
      {
        id: "fallback",
        label: "Renderer",
        status: "not_configured",
        detail: "Electron bridge unavailable"
      }
    ]
  },

  async listModels(): Promise<RuntimeModel[]> {
    const bridgeList = window.dreamreader?.models?.list

    if (bridgeList) {
      return (await bridgeList()).map(toRuntimeModel)
    }

    return fallbackRuntimeModels()
  },

  async listModelDownloadJobs(): Promise<ModelDownloadJob[]> {
    const bridgeList = window.dreamreader?.models?.downloads

    if (bridgeList) {
      return (await bridgeList()).map(toModelDownloadJob)
    }

    return []
  },

  async listRuntimeOperations(): Promise<RuntimeOperationJob[]> {
    const bridgeList = window.dreamreader?.models?.operations

    if (bridgeList) {
      return (await bridgeList()).map(toRuntimeOperation)
    }

    return []
  },

  async getHuggingFaceTokenStatus(): Promise<HuggingFaceTokenStatus> {
    const bridgeStatus = window.dreamreader?.models?.huggingFaceToken

    if (bridgeStatus) {
      return toHuggingFaceTokenStatus(await bridgeStatus())
    }

    return { configured: false }
  },

  async updateHuggingFaceToken(token: string): Promise<HuggingFaceTokenStatus> {
    const bridgeUpdate = window.dreamreader?.models?.updateHuggingFaceToken

    if (bridgeUpdate) {
      return toHuggingFaceTokenStatus(await bridgeUpdate(token))
    }

    throw Object.assign(new Error("Hugging Face token storage requires the Electron bridge"), {
      code: "hf_token_requires_app_bridge"
    })
  },

  async listSidecars(): Promise<RuntimeSidecar[]> {
    const bridgeList = window.dreamreader?.sidecars?.list

    if (bridgeList) {
      return (await bridgeList()).map(toRuntimeSidecar)
    }

    return []
  },

  async downloadModel(modelId: string): Promise<ModelDownloadJob> {
    const bridgeDownload = window.dreamreader?.models?.download

    if (bridgeDownload) {
      return toModelDownloadJob(await bridgeDownload(modelId))
    }

    throw Object.assign(new Error("Model downloads require the Electron bridge"), {
      code: "model_download_requires_app_bridge"
    })
  },

  async installRecommendedModel(modelId: string): Promise<RuntimeOperationJob> {
    const bridgeInstall = window.dreamreader?.models?.installRecommended

    if (bridgeInstall) {
      return toRuntimeOperation(await bridgeInstall(modelId))
    }

    throw Object.assign(new Error("Model installation requires the Electron bridge"), {
      code: "model_install_requires_app_bridge"
    })
  },

  async installModelFromPath(modelPath?: string): Promise<RuntimeModel | null> {
    const bridgeInstall = window.dreamreader?.models?.installFromPath

    if (bridgeInstall) {
      const installed = await bridgeInstall(modelPath)
      return installed ? toRuntimeModel(installed) : null
    }

    throw Object.assign(new Error("Model installation requires the Electron bridge"), {
      code: "model_install_requires_app_bridge"
    })
  },

  async deleteModel(modelId: string, deleteFiles = true): Promise<RuntimeModel> {
    const bridgeDelete = window.dreamreader?.models?.delete

    if (bridgeDelete) {
      return toRuntimeModel(await bridgeDelete(modelId, deleteFiles))
    }

    throw Object.assign(new Error("Model deletion requires the Electron bridge"), {
      code: "model_delete_requires_app_bridge"
    })
  },

  async installSidecar(sidecarId: string): Promise<RuntimeOperationJob> {
    const bridgeInstall = window.dreamreader?.sidecars?.install

    if (bridgeInstall) {
      return toRuntimeOperation(await bridgeInstall(sidecarId))
    }

    throw Object.assign(new Error("Sidecar installation requires the Electron bridge"), {
      code: "sidecar_install_requires_app_bridge"
    })
  },

  async uninstallSidecar(sidecarId: string): Promise<RuntimeOperationJob> {
    const bridgeUninstall = window.dreamreader?.sidecars?.uninstall

    if (bridgeUninstall) {
      return toRuntimeOperation(await bridgeUninstall(sidecarId))
    }

    throw Object.assign(new Error("Sidecar uninstall requires the Electron bridge"), {
      code: "sidecar_uninstall_requires_app_bridge"
    })
  },

  async listCompatibleVoices(engineId?: string): Promise<VoiceProfile[]> {
    const bridgeList = window.dreamreader?.voices?.listCompatible

    if (bridgeList) {
      return (await bridgeList(engineId)).map(toVoiceProfile)
    }

    return [
      {
        id: "voice_builtin_ptbr_neutral",
        name: "Narrador PT-BR neutro",
        language: "pt-BR",
        kind: "built_in"
      }
    ]
  },

  async selectVoiceReferenceAudio(): Promise<{ path: string; durationMs?: number; sampleRate?: number } | null> {
    const bridgeSelect = window.dreamreader?.voices?.selectReferenceAudio

    if (bridgeSelect) {
      const result = await bridgeSelect()
      return result.path ? { path: result.path, durationMs: result.durationMs, sampleRate: result.sampleRate } : null
    }

    return null
  },

  async createVoiceFromReference(input: {
    consentConfirmed: true
    consentNote: string
    engineId?: string
    language: string
    name: string
    referenceAudioPath: string
    transcript?: string
  }): Promise<VoiceProfile> {
    const bridgeCreate = window.dreamreader?.voices?.createFromReference

    if (bridgeCreate) {
      return toVoiceProfile(await bridgeCreate(input))
    }

    return fallbackVoice(input.name, input.language, "cloned", input.engineId ?? "dreamreader-local-tts")
  },

  async createVoiceFromDesignPrompt(input: {
    engineId: string
    language: string
    name: string
    prompt: string
  }): Promise<VoiceProfile> {
    const bridgeCreate = window.dreamreader?.voices?.createFromDesignPrompt

    if (bridgeCreate) {
      return toVoiceProfile(await bridgeCreate(input))
    }

    return fallbackVoice(input.name, input.language, "generated", input.engineId)
  },

  async updateVoice(input: { voiceProfileId: string; name?: string; description?: string | null }): Promise<VoiceProfile> {
    const bridgeUpdate = window.dreamreader?.voices?.update

    if (bridgeUpdate) {
      return toVoiceProfile(await bridgeUpdate(input))
    }

    return fallbackVoice(input.name ?? "Voz", "pt-BR", "cloned", "dreamreader-local-tts")
  },

  async deleteVoice(voiceProfileId: string): Promise<void> {
    const bridgeDelete = window.dreamreader?.voices?.delete

    if (bridgeDelete) {
      await bridgeDelete(voiceProfileId)
    }
  },

  async exportVoice(voiceProfileId: string): Promise<{ exported: boolean; path?: string }> {
    const bridgeExport = window.dreamreader?.voices?.export

    if (bridgeExport) {
      const result = (await bridgeExport(voiceProfileId)) as Record<string, unknown>
      return {
        exported: Boolean(result.exported),
        path: optionalString(result.path)
      }
    }

    throw Object.assign(new Error("Voice export requires the Electron bridge"), {
      code: "voice_export_requires_app_bridge"
    })
  },

  async importVoices(archivePaths?: string[]): Promise<VoiceProfile[]> {
    const bridgeImport = window.dreamreader?.voices?.import

    if (bridgeImport) {
      const result = (await bridgeImport(archivePaths)) as Record<string, unknown>
      return toArray(result.imported).map(toVoiceProfile)
    }

    throw Object.assign(new Error("Voice import requires the Electron bridge"), {
      code: "voice_import_requires_app_bridge"
    })
  },

  async previewVoice(voiceProfileId: string, engineId: string): Promise<string | null> {
    const bridgePreview = window.dreamreader?.voices?.preview
    if (bridgePreview) {
      const result = (await bridgePreview(voiceProfileId, engineId)) as { audioAssetId?: string } | null
      return result?.audioAssetId ?? null
    }
    return null
  },

  async listPronunciationEntries(bookId?: string): Promise<PronunciationEntry[]> {
    const bridgeList = window.dreamreader?.pronunciation?.list

    if (bridgeList) {
      return (await bridgeList({ bookId, includeGlobal: true })).map(toPronunciationEntry)
    }

    return []
  },

  async createPronunciationEntry(input: {
    bookId?: string
    caseSensitive?: boolean
    matchKind?: "literal" | "word" | "regex"
    pattern: string
    replacement: string
    scope: "global" | "book"
  }): Promise<PronunciationEntry> {
    const bridgeCreate = window.dreamreader?.pronunciation?.create

    if (bridgeCreate) {
      return toPronunciationEntry(await bridgeCreate(input))
    }

    const now = new Date().toISOString()
    return {
      id: crypto.randomUUID(),
      scope: input.scope,
      bookId: input.bookId,
      pattern: input.pattern,
      replacement: input.replacement,
      matchKind: input.matchKind ?? "word",
      caseSensitive: Boolean(input.caseSensitive),
      createdAt: now,
      updatedAt: now
    }
  },

  async deletePronunciationEntry(id: string): Promise<void> {
    const bridgeDelete = window.dreamreader?.pronunciation?.delete

    if (bridgeDelete) {
      await bridgeDelete(id)
    }
  }
}

function fallbackTtsJob(bookId: string, chapterHref: string, status: TtsJob["status"], id: string = crypto.randomUUID()): TtsJob {
  const now = new Date().toISOString()
  return {
    id,
    bookId,
    chapterHref,
    engineId: "dreamreader-local-tts",
    voiceProfileId: "voice_builtin_ptbr_neutral",
    status,
    progress: status === "completed" ? 1 : 0,
    settings: {
      useExpressiveNarration: false
    },
    createdAt: now,
    updatedAt: now,
    finishedAt: status === "completed" || status === "cancelled" ? now : undefined
  }
}

function toTtsJob(input: unknown): TtsJob {
  const job = (input ?? {}) as Record<string, unknown>
  return {
    id: String(job.id ?? ""),
    bookId: String(job.bookId ?? ""),
    chapterHref: String(job.chapterHref ?? ""),
    engineId: String(job.engineId ?? "dreamreader-local-tts"),
    voiceProfileId: optionalString(job.voiceProfileId),
    voiceBindingId: optionalString(job.voiceBindingId),
    status: toTtsJobStatus(job.status),
    progress: Number(job.progress ?? 0),
    settings: jsonObject(job.settings),
    errorMessage: optionalString(job.errorMessage),
    createdAt: String(job.createdAt ?? new Date().toISOString()),
    updatedAt: String(job.updatedAt ?? new Date().toISOString()),
    finishedAt: optionalString(job.finishedAt)
  }
}

function toAudiobookExport(input: unknown): AudiobookExport | null {
  if (!input) {
    return null
  }
  const item = input as Record<string, unknown>
  const manifest = item.manifest as Record<string, unknown> | undefined
  return {
    id: String(item.id ?? ""),
    bookId: String(item.bookId ?? ""),
    status: toAudiobookStatus(item.status),
    autoBuildEnabled: Boolean(item.autoBuildEnabled),
    draftAssetId: optionalString(item.draftAssetId),
    manifest: manifest
      ? {
          chapters: toArray(manifest.chapters).map((chapter) => {
            const row = chapter as Record<string, unknown>
            return {
              bookId: String(row.bookId ?? ""),
              chapterHref: String(row.chapterHref ?? ""),
              chapterIndex: Number(row.chapterIndex ?? 0),
              title: String(row.title ?? ""),
              audioAssetId: String(row.audioAssetId ?? ""),
              engineId: String(row.engineId ?? "dreamreader-local-tts"),
              voiceProfileId: optionalString(row.voiceProfileId),
              durationMs: Number(row.durationMs ?? 0),
              startMs: Number(row.startMs ?? 0),
              endMs: Number(row.endMs ?? 0),
              contentHash: String(row.contentHash ?? ""),
              audioHash: String(row.audioHash ?? "")
            }
          }),
          durationMs: Number(manifest.durationMs ?? 0)
        }
      : undefined,
    chaptersReady: Number(item.chaptersReady ?? 0),
    chaptersTotal: Number(item.chaptersTotal ?? 0),
    durationMs: optionalNumber(item.durationMs),
    stale: Boolean(item.stale),
    errorMessage: optionalString(item.errorMessage)
  }
}

function toLibraryAudioStatus(input: unknown): LibraryAudioStatus {
  const item = (input ?? {}) as Record<string, unknown>
  return {
    bookId: String(item.bookId ?? ""),
    title: String(item.title ?? ""),
    authors: toArray(item.authors).map(String),
    coverAssetId: optionalString(item.coverAssetId),
    status: toAudiobookStatus(item.status),
    chaptersReady: Number(item.chaptersReady ?? 0),
    chaptersTotal: Number(item.chaptersTotal ?? 0),
    durationMs: Number(item.durationMs ?? 0),
    hasChapterAudio: Boolean(item.hasChapterAudio),
    hasActiveJob: Boolean(item.hasActiveJob),
    updatedAt: String(item.updatedAt ?? new Date().toISOString())
  }
}

function toRuntimeDiagnostic(input: unknown): RuntimeDiagnostic {
  const item = (input ?? {}) as Record<string, unknown>
  return {
    id: String(item.id ?? ""),
    label: String(item.label ?? item.id ?? ""),
    status: item.status === "available" ? "available" : "not_configured",
    detail: String(item.detail ?? "")
  }
}

function toRuntimeModel(input: unknown): RuntimeModel {
  const item = (input ?? {}) as Record<string, unknown>
  return {
    id: String(item.id ?? ""),
    kind: toRuntimeModelKind(item.kind),
    name: String(item.name ?? ""),
    provider: String(item.provider ?? ""),
    version: String(item.version ?? ""),
    runtime: String(item.runtime ?? ""),
    format: String(item.format ?? "unknown"),
    acceleratorPreference: String(item.acceleratorPreference ?? "cpu"),
    installStatus: toModelInstallStatus(item.installStatus),
    downloadProgress: clampProgress(item.downloadProgress),
    path: optionalString(item.path),
    sizeBytes: optionalNumber(item.sizeBytes),
    checksum: optionalString(item.checksum),
    checksumAlgorithm: optionalString(item.checksumAlgorithm),
    license: String(item.license ?? "unknown"),
    memoryEstimateMb: optionalNumber(item.memoryEstimateMb),
    sourceUrl: optionalString(item.sourceUrl),
    canDownload: Boolean(item.canDownload),
    engineId: optionalString(item.engineId),
    metadata: jsonObject(item.metadata),
    installedAt: optionalString(item.installedAt),
    createdAt: String(item.createdAt ?? new Date().toISOString()),
    updatedAt: String(item.updatedAt ?? new Date().toISOString())
  }
}

function toModelDownloadJob(input: unknown): ModelDownloadJob {
  const item = (input ?? {}) as Record<string, unknown>
  return {
    id: String(item.id ?? ""),
    modelAssetId: String(item.modelAssetId ?? ""),
    status: toModelInstallStatus(item.status),
    progress: clampProgress(item.progress),
    receivedBytes: Number(item.receivedBytes ?? 0),
    totalBytes: optionalNumber(item.totalBytes),
    sourceUrl: String(item.sourceUrl ?? ""),
    targetPath: String(item.targetPath ?? ""),
    errorCode: optionalString(item.errorCode),
    errorMessage: optionalString(item.errorMessage),
    createdAt: String(item.createdAt ?? new Date().toISOString()),
    startedAt: optionalString(item.startedAt),
    finishedAt: optionalString(item.finishedAt),
    updatedAt: String(item.updatedAt ?? new Date().toISOString())
  }
}

function toRuntimeSidecar(input: unknown): RuntimeSidecar {
  const item = (input ?? {}) as Record<string, unknown>
  return {
    id: String(item.id ?? ""),
    adapterId: String(item.adapterId ?? ""),
    name: String(item.name ?? item.adapterId ?? ""),
    runtime: String(item.runtime ?? ""),
    status: toRuntimeSidecarStatus(item.status),
    executablePath: optionalString(item.executablePath),
    scriptPath: optionalString(item.scriptPath),
    healthcheckCommand: optionalString(item.healthcheckCommand),
    sizeBytes: optionalNumber(item.sizeBytes),
    modelEngineIds: toArray(item.modelEngineIds).map(String),
    createdAt: String(item.createdAt ?? new Date().toISOString()),
    updatedAt: String(item.updatedAt ?? new Date().toISOString())
  }
}

function toRuntimeOperation(input: unknown): RuntimeOperationJob {
  const item = (input ?? {}) as Record<string, unknown>
  return {
    id: String(item.id ?? ""),
    kind: toRuntimeOperationKind(item.kind),
    targetKind: item.targetKind === "sidecar" ? "sidecar" : "model",
    targetId: String(item.targetId ?? ""),
    status: toRuntimeOperationStatus(item.status),
    progress: clampProgress(item.progress),
    progressLabelKey: optionalString(item.progressLabelKey),
    progressLabelValues: stringNumberRecord(item.progressLabelValues),
    errorCode: optionalString(item.errorCode),
    errorMessage: optionalString(item.errorMessage),
    logs: toArray(item.logs).map(toRuntimeOperationLog),
    createdAt: String(item.createdAt ?? new Date().toISOString()),
    startedAt: optionalString(item.startedAt),
    finishedAt: optionalString(item.finishedAt),
    updatedAt: String(item.updatedAt ?? new Date().toISOString())
  }
}

function toRuntimeOperationLog(input: unknown): RuntimeOperationLogEntry {
  const item = (input ?? {}) as Record<string, unknown>
  return {
    id: String(item.id ?? crypto.randomUUID()),
    level: item.level === "warning" || item.level === "error" ? item.level : "info",
    messageKey: String(item.messageKey ?? "modelManager.log.processOutput"),
    values: stringNumberRecord(item.values),
    createdAt: String(item.createdAt ?? new Date().toISOString())
  }
}

function toHuggingFaceTokenStatus(input: unknown): HuggingFaceTokenStatus {
  const item = (input ?? {}) as Record<string, unknown>
  return {
    configured: Boolean(item.configured),
    storage: item.storage === "electron-safe-storage" ? "electron-safe-storage" : undefined,
    updatedAt: optionalString(item.updatedAt)
  }
}

function toVoiceProfile(input: unknown): VoiceProfile {
  const voice = (input ?? {}) as Record<string, unknown>
  return {
    id: String(voice.id ?? ""),
    name: String(voice.name ?? ""),
    description: optionalString(voice.description),
    language: String(voice.language ?? "pt-BR"),
    kind: String(voice.kind ?? "built_in"),
    source: jsonObject(voice.source),
    tags: Array.isArray(voice.tags) ? voice.tags.map(String) : [],
    settings: jsonObject(voice.settings),
    createdFromEngineId: optionalString(voice.createdFromEngineId),
    createdAt: optionalString(voice.createdAt),
    updatedAt: optionalString(voice.updatedAt)
  }
}

function fallbackVoice(name: string, language: string, kind: string, engineId: string): VoiceProfile {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    name,
    language,
    kind,
    settings: {
      compatibleEngineIds: [engineId]
    },
    createdFromEngineId: engineId,
    createdAt: now,
    updatedAt: now
  }
}

function toPronunciationEntry(input: unknown): PronunciationEntry {
  const entry = (input ?? {}) as Record<string, unknown>
  return {
    id: String(entry.id ?? ""),
    scope: entry.scope === "book" ? "book" : "global",
    bookId: optionalString(entry.bookId),
    pattern: String(entry.pattern ?? ""),
    replacement: String(entry.replacement ?? ""),
    matchKind: entry.matchKind === "literal" || entry.matchKind === "regex" ? entry.matchKind : "word",
    caseSensitive: Boolean(entry.caseSensitive),
    createdAt: String(entry.createdAt ?? new Date().toISOString()),
    updatedAt: String(entry.updatedAt ?? new Date().toISOString())
  }
}

function fallbackRuntimeModels(): RuntimeModel[] {
  const now = new Date().toISOString()
  return [
    {
      id: "model_qwen3_4b_instruct_2507_gguf_q4km",
      kind: "llm",
      name: "Qwen3 4B Instruct 2507 GGUF Q4_K_M",
      provider: "Qwen",
      version: "Qwen3-4B-Instruct-2507-Q4_K_M",
      runtime: "node-llama-cpp",
      format: "gguf",
      acceleratorPreference: "metal",
      installStatus: "not_configured",
      downloadProgress: 0,
      license: "apache-2.0",
      memoryEstimateMb: 4096,
      canDownload: false,
      metadata: { role: "prosody" },
      createdAt: now,
      updatedAt: now
    }
  ]
}

function toRuntimeModelKind(value: unknown): RuntimeModel["kind"] {
  const kind = String(value ?? "runtime")
  if (kind === "llm" || kind === "tts" || kind === "tokenizer" || kind === "vocoder" || kind === "runtime") {
    return kind
  }
  return "runtime"
}

function toModelInstallStatus(value: unknown): RuntimeModel["installStatus"] {
  const status = String(value ?? "not_configured")
  if (
    status === "not_configured" ||
    status === "queued" ||
    status === "downloading" ||
    status === "available" ||
    status === "failed"
  ) {
    return status
  }
  return "not_configured"
}

function toRuntimeSidecarStatus(value: unknown): RuntimeSidecar["status"] {
  const status = String(value ?? "not_configured")
  if (status === "available" || status === "failed") {
    return status
  }
  return "not_configured"
}

function toRuntimeOperationStatus(value: unknown): RuntimeOperationJob["status"] {
  const status = String(value ?? "queued")
  if (status === "running" || status === "completed" || status === "failed") {
    return status
  }
  return "queued"
}

function toRuntimeOperationKind(value: unknown): RuntimeOperationJob["kind"] {
  const kind = String(value ?? "model_download")
  if (
    kind === "model_download" ||
    kind === "model_install" ||
    kind === "model_delete" ||
    kind === "sidecar_install" ||
    kind === "sidecar_uninstall"
  ) {
    return kind
  }
  return "model_download"
}

function toTtsJobStatus(value: unknown): TtsJob["status"] {
  const status = String(value ?? "queued")
  if (
    status === "queued" ||
    status === "preparing" ||
    status === "analyzing" ||
    status === "synthesizing" ||
    status === "assembling" ||
    status === "updating_m4b" ||
    status === "building" ||
    status === "validating" ||
    status === "paused" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled"
  ) {
    return status
  }
  return "queued"
}

function toTtsSegment(input: unknown): TtsSegment {
  const item = (input ?? {}) as Record<string, unknown>
  return {
    id: String(item.id ?? ""),
    jobId: String(item.jobId ?? ""),
    segmentIndex: Number(item.segmentIndex ?? 0),
    status: String(item.status ?? "queued"),
    textPreview: String(item.textPreview ?? ""),
    audioAssetId: optionalString(item.audioAssetId),
    durationMs: optionalNumber(item.durationMs),
    prosody: toSegmentProsody(item.prosody),
    prosodyMode: toSegmentProsodyMode(item.prosodyMode)
  }
}

function toSegmentProsody(value: unknown): TtsSegment["prosody"] {
  const prosody = jsonObject(value)
  const emotion = toProsodyEmotion(prosody.emotion)
  const pace = toProsodyPace(prosody.pace)
  const pitch = toProsodyPitch(prosody.pitch)
  if (!emotion || !pace || !pitch) {
    return undefined
  }
  return {
    emotion,
    intensity: clamp(Number(prosody.intensity ?? 0.2), 0, 1),
    pace,
    pitch,
    pauseBeforeMs: Math.max(0, Math.round(Number(prosody.pauseBeforeMs ?? 0) || 0)),
    pauseAfterMs: Math.max(0, Math.round(Number(prosody.pauseAfterMs ?? 350) || 0)),
    instructionPtBr: String(prosody.instructionPtBr ?? "")
  }
}

function toSegmentProsodyMode(value: unknown): TtsSegment["prosodyMode"] {
  return value === "expressive" || value === "neutral" ? value : undefined
}

function toProsodyEmotion(value: unknown): SegmentProsody["emotion"] | undefined {
  const emotion = String(value ?? "")
  if (
    emotion === "neutral" ||
    emotion === "warm" ||
    emotion === "tense" ||
    emotion === "sad" ||
    emotion === "joyful" ||
    emotion === "angry" ||
    emotion === "suspense" ||
    emotion === "formal"
  ) {
    return emotion
  }
  return undefined
}

function toProsodyPace(value: unknown): SegmentProsody["pace"] | undefined {
  const pace = String(value ?? "")
  if (pace === "slow" || pace === "normal" || pace === "fast") {
    return pace
  }
  return undefined
}

function toProsodyPitch(value: unknown): SegmentProsody["pitch"] | undefined {
  const pitch = String(value ?? "")
  if (pitch === "low" || pitch === "neutral" || pitch === "high") {
    return pitch
  }
  return undefined
}

function toAudiobookStatus(value: unknown): AudiobookExport["status"] {
  const status = String(value ?? "none")
  if (status === "partial" || status === "stale" || status === "complete" || status === "error") {
    return status
  }
  return "none"
}

function toArray(value: unknown): unknown[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

function clampProgress(value: unknown): number {
  const progress = Number(value ?? 0)
  return Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 1) : 0
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringNumberRecord(value: unknown): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(jsonObject(value)).flatMap(([key, entry]) =>
      typeof entry === "string" || typeof entry === "number" ? [[key, entry]] : []
    )
  )
}
