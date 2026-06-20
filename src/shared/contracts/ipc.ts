import { z } from "zod";
import {
  AnnotationSchema,
  BookmarkSchema,
  CreateAnnotationInputSchema,
  CreateAnnotationRequestSchema,
  DeleteAnnotationRequestSchema,
  ExportAnnotationsInputSchema,
  ExportAnnotationsResultSchema,
  ListAnnotationsRequestSchema,
  UpdateAnnotationInputSchema,
  UpdateAnnotationRequestSchema,
} from "./annotations";
import {
  createIpcResponseSchema,
  IdSchema,
  JsonObjectSchema,
} from "./common";
import {
  DeleteBookRequestSchema,
  DeleteBookResultSchema,
  ImportFilesRequestSchema,
  ImportFilesResultSchema,
  BookImporterIdSchema,
  ImportBooksInputSchema,
  ImportedBookSchema,
  ListBooksRequestSchema,
  ListBooksResultSchema,
  UpdateBookMetadataRequestSchema,
  BookSchema,
  LibraryBookSchema,
} from "./library";
import {
  BookResourceSchema,
  GetResourceRequestSchema,
  OpenBookRequestSchema,
  OpenBookResultSchema,
  ReaderChapterSchema,
  ReaderManifestSchema,
  ReaderOpenResultSchema,
  SaveLocatorRequestSchema,
  SaveReadingPositionInputSchema,
  ReadingPositionSchema,
} from "./reader";
import {
  AppSettingsSchema,
  SettingsSchema,
  UpdateSettingsRequestSchema,
} from "./settings";
import {
  AudiobookBuildJobSchema,
  AudiobookExportSchema,
  ClearChapterAudioRequestSchema,
  ClearTerminalTtsJobsRequestSchema,
  ClearTtsJobsResultSchema,
  CommitVoiceDesignPreviewInputSchema,
  CreatePronunciationEntryRequestSchema,
  DeletePronunciationEntryRequestSchema,
  DeleteModelRequestSchema,
  DiscardVoiceDesignPreviewInputSchema,
  DownloadModelRequestSchema,
  EnqueueChapterTtsRequestSchema,
  EnqueueChaptersTtsRequestSchema,
  HuggingFaceTokenStatusSchema,
  InstallRecommendedModelRequestSchema,
  LibraryAudioStatusSchema,
  TtsSegmentSummarySchema,
  ListPronunciationEntriesRequestSchema,
  ModelAssetSchema,
  ModelDownloadJobSchema,
  NarrationPlanSchema,
  PronunciationEntrySchema,
  RuntimeDiagnosticSchema,
  RuntimeInstallBackendSchema,
  RuntimeOperationJobSchema,
  RuntimeSidecarSchema,
  SidecarRequestSchema,
  TtsAdapterManifestSchema,
  TtsEngineCapabilitiesSchema,
  TtsGenerationSeedSchema,
  TtsJobSchema,
  TtsModelSettingsSchema,
  UpdateHuggingFaceTokenRequestSchema,
  UpdatePronunciationEntryRequestSchema,
  VoiceCloneInputSchema,
  VoiceDesignPromptInputSchema,
  VoiceDesignPreviewInputSchema,
  VoiceDesignPreviewSchema,
  VoiceFilterSchema,
  VoiceEngineBindingSchema,
  VoiceExportResultSchema,
  VoiceImportResultSchema,
  VoiceProfileSchema,
  VoiceSampleSchema,
} from "./ai";

export {
  AnnotationSchema,
  AppSettingsSchema,
  AudiobookBuildJobSchema,
  AudiobookExportSchema,
  BookmarkSchema,
  ClearChapterAudioRequestSchema,
  ClearTerminalTtsJobsRequestSchema,
  ClearTtsJobsResultSchema,
  BookSchema,
  CreatePronunciationEntryRequestSchema,
  CreateAnnotationInputSchema,
  DeleteBookRequestSchema,
  DeleteBookResultSchema,
  DeletePronunciationEntryRequestSchema,
  ExportAnnotationsInputSchema,
  ExportAnnotationsResultSchema,
  ImportBooksInputSchema,
  BookImporterIdSchema,
  ImportedBookSchema,
  LibraryBookSchema,
  ListAnnotationsRequestSchema,
  ListPronunciationEntriesRequestSchema,
  ModelAssetSchema,
  ModelDownloadJobSchema,
  NarrationPlanSchema,
  PronunciationEntrySchema,
  RuntimeDiagnosticSchema,
  RuntimeInstallBackendSchema,
  RuntimeOperationJobSchema,
  RuntimeSidecarSchema,
  HuggingFaceTokenStatusSchema,
  ReaderChapterSchema,
  ReaderManifestSchema,
  ReaderOpenResultSchema,
  ReadingPositionSchema,
  SaveReadingPositionInputSchema,
  TtsAdapterManifestSchema,
  TtsEngineCapabilitiesSchema,
  TtsJobSchema,
  UpdateAnnotationInputSchema,
  UpdatePronunciationEntryRequestSchema,
  VoiceCloneInputSchema,
  VoiceDesignPromptInputSchema,
  VoiceDesignPreviewInputSchema,
  VoiceDesignPreviewSchema,
  VoiceEngineBindingSchema,
  VoiceExportResultSchema,
  VoiceImportResultSchema,
  VoiceProfileSchema,
  VoiceSampleSchema,
};
export type {
  Annotation,
  Bookmark,
  CreateAnnotationInput,
  ExportAnnotationsInput,
  ExportAnnotationsResult,
  ListAnnotationsRequest,
  UpdateAnnotationInput,
} from "./annotations";
export type {
  AudiobookBuildJob,
  AudiobookExport,
  ModelAsset,
  ModelDownloadJob,
  NarrationPlan,
  PronunciationEntry,
  RuntimeDiagnostic,
  RuntimeInstallBackend,
  HuggingFaceTokenStatus,
  RuntimeOperationJob,
  RuntimeSidecar,
  TtsEngineCapabilities,
  TtsGenerationSeed,
  TtsJob,
  TtsModelSettings,
  VoiceEngineBinding,
  VoiceExportResult,
  VoiceImportResult,
  VoiceProfile,
  VoiceSample,
} from "./ai";
export type { Book, DeleteBookRequest, DeleteBookResult, ImportBooksInput, LibraryBook } from "./library";
export type {
  ReaderChapter,
  ReaderManifest,
  ReaderOpenResult,
  ReadingPosition,
  SaveReadingPositionInput,
} from "./reader";
export type { AppSettings } from "./settings";

export const IpcChannelSchema = z.enum([
  "library.importFiles",
  "library.listBooks",
  "library.updateBookMetadata",
  "library.deleteBook",
  "reader.openBook",
  "reader.getResource",
  "reader.saveLocator",
  "annotations.list",
  "annotations.create",
  "annotations.update",
  "annotations.delete",
  "annotations.export",
  "bookmarks.create",
  "tts.enqueueChapter",
  "tts.enqueueChapters",
  "tts.cancelJob",
  "tts.pauseJob",
  "tts.resumeJob",
  "tts.retryJob",
  "tts.getJob",
  "tts.listJobs",
  "tts.listSegments",
  "tts.clearChapterAudio",
  "tts.clearTerminalJobs",
  "voices.list",
  "voices.createFromReference",
  "voices.createFromDesignPrompt",
  "voices.generateDesignPreview",
  "voices.commitDesignPreview",
  "voices.discardDesignPreview",
  "voices.selectReferenceAudio",
  "voices.preview",
  "voices.update",
  "voices.delete",
  "voices.export",
  "voices.import",
  "voices.listCompatible",
  "audiobook.getExport",
  "audiobook.listLibraryStatus",
  "audiobook.enableAutoBuild",
  "audiobook.rebuild",
  "audiobook.deleteExport",
  "audiobook.getBuildJob",
  "audiobook.save",
  "audiobook.reveal",
  "models.list",
  "models.diagnostics",
  "models.downloads",
  "models.operations",
  "models.huggingFaceToken",
  "models.updateHuggingFaceToken",
  "models.installFromPath",
  "models.installRecommended",
  "models.download",
  "models.delete",
  "sidecars.list",
  "sidecars.install",
  "sidecars.uninstall",
  "pronunciation.list",
  "pronunciation.create",
  "pronunciation.update",
  "pronunciation.delete",
  "settings.get",
  "settings.update",
]);
export type IpcChannel = z.infer<typeof IpcChannelSchema>;

const EmptyRequestSchema = z.object({}).strict();
const IdRequestSchema = z.object({ id: IdSchema });
const BookIdRequestSchema = z.object({ bookId: IdSchema });

export const IpcContractSchemas = {
  "library.importFiles": {
    request: ImportFilesRequestSchema,
    response: createIpcResponseSchema(ImportFilesResultSchema),
  },
  "library.listBooks": {
    request: ListBooksRequestSchema,
    response: createIpcResponseSchema(ListBooksResultSchema),
  },
  "library.updateBookMetadata": {
    request: UpdateBookMetadataRequestSchema,
    response: createIpcResponseSchema(BookSchema),
  },
  "library.deleteBook": {
    request: DeleteBookRequestSchema,
    response: createIpcResponseSchema(DeleteBookResultSchema),
  },
  "reader.openBook": {
    request: OpenBookRequestSchema,
    response: createIpcResponseSchema(OpenBookResultSchema),
  },
  "reader.getResource": {
    request: GetResourceRequestSchema,
    response: createIpcResponseSchema(BookResourceSchema),
  },
  "reader.saveLocator": {
    request: SaveLocatorRequestSchema,
    response: createIpcResponseSchema(ReadingPositionSchema),
  },
  "annotations.list": {
    request: ListAnnotationsRequestSchema,
    response: createIpcResponseSchema(z.array(AnnotationSchema)),
  },
  "annotations.create": {
    request: CreateAnnotationRequestSchema,
    response: createIpcResponseSchema(AnnotationSchema),
  },
  "annotations.update": {
    request: UpdateAnnotationRequestSchema,
    response: createIpcResponseSchema(AnnotationSchema),
  },
  "annotations.delete": {
    request: DeleteAnnotationRequestSchema,
    response: createIpcResponseSchema(z.object({ deleted: z.literal(true) })),
  },
  "annotations.export": {
    request: ExportAnnotationsInputSchema,
    response: createIpcResponseSchema(ExportAnnotationsResultSchema),
  },
  "bookmarks.create": {
    request: z.object({
      bookId: IdSchema,
      locator: JsonObjectSchema,
      label: z.string().trim().optional(),
    }),
    response: createIpcResponseSchema(BookmarkSchema),
  },
  "tts.enqueueChapter": {
    request: EnqueueChapterTtsRequestSchema,
    response: createIpcResponseSchema(TtsJobSchema),
  },
  "tts.enqueueChapters": {
    request: EnqueueChaptersTtsRequestSchema,
    response: createIpcResponseSchema(z.array(TtsJobSchema)),
  },
  "tts.cancelJob": {
    request: IdRequestSchema,
    response: createIpcResponseSchema(TtsJobSchema),
  },
  "tts.pauseJob": {
    request: IdRequestSchema,
    response: createIpcResponseSchema(TtsJobSchema),
  },
  "tts.resumeJob": {
    request: IdRequestSchema,
    response: createIpcResponseSchema(TtsJobSchema),
  },
  "tts.retryJob": {
    request: IdRequestSchema,
    response: createIpcResponseSchema(TtsJobSchema),
  },
  "tts.getJob": {
    request: IdRequestSchema,
    response: createIpcResponseSchema(TtsJobSchema),
  },
  "tts.listJobs": {
    request: z
      .object({
        bookId: IdSchema.optional(),
        engineId: IdSchema.optional(),
      })
      .default({}),
    response: createIpcResponseSchema(z.array(TtsJobSchema)),
  },
  "tts.listSegments": {
    request: z.object({ jobId: IdSchema }),
    response: createIpcResponseSchema(z.array(TtsSegmentSummarySchema)),
  },
  "tts.clearChapterAudio": {
    request: ClearChapterAudioRequestSchema,
    response: createIpcResponseSchema(z.object({ deleted: z.literal(true) })),
  },
  "tts.clearTerminalJobs": {
    request: ClearTerminalTtsJobsRequestSchema,
    response: createIpcResponseSchema(ClearTtsJobsResultSchema),
  },
  "voices.list": {
    request: VoiceFilterSchema.default({ includeUnavailable: false }),
    response: createIpcResponseSchema(z.array(VoiceProfileSchema)),
  },
  "voices.createFromReference": {
    request: VoiceCloneInputSchema,
    response: createIpcResponseSchema(VoiceProfileSchema),
  },
  "voices.createFromDesignPrompt": {
    request: VoiceDesignPromptInputSchema,
    response: createIpcResponseSchema(VoiceProfileSchema),
  },
  "voices.generateDesignPreview": {
    request: VoiceDesignPreviewInputSchema,
    response: createIpcResponseSchema(VoiceDesignPreviewSchema),
  },
  "voices.commitDesignPreview": {
    request: CommitVoiceDesignPreviewInputSchema,
    response: createIpcResponseSchema(VoiceProfileSchema),
  },
  "voices.discardDesignPreview": {
    request: DiscardVoiceDesignPreviewInputSchema,
    response: createIpcResponseSchema(z.object({ discarded: z.literal(true) })),
  },
  "voices.selectReferenceAudio": {
    request: EmptyRequestSchema,
    response: createIpcResponseSchema(
      z.object({
        path: z.string().trim().min(1).optional(),
        durationMs: z.number().int().nonnegative().optional(),
        sampleRate: z.number().int().positive().optional(),
      }),
    ),
  },
  "voices.preview": {
    request: z.object({
      voiceProfileId: IdSchema,
      engineId: IdSchema,
    }),
    response: createIpcResponseSchema(
      z.object({
        audioAssetId: IdSchema,
      }),
    ),
  },
  "voices.update": {
    request: z.object({
      voiceProfileId: IdSchema,
      name: z.string().trim().min(1).optional(),
      description: z.string().trim().nullable().optional(),
      tags: z.array(z.string().trim().min(1)).optional(),
    }),
    response: createIpcResponseSchema(VoiceProfileSchema),
  },
  "voices.delete": {
    request: z.object({ voiceProfileId: IdSchema }),
    response: createIpcResponseSchema(z.object({ deleted: z.literal(true) })),
  },
  "voices.export": {
    request: z.object({ voiceProfileId: IdSchema }),
    response: createIpcResponseSchema(VoiceExportResultSchema),
  },
  "voices.import": {
    request: z
      .object({
        archivePaths: z.array(z.string().trim().min(1)).default([]),
      })
      .default({ archivePaths: [] }),
    response: createIpcResponseSchema(VoiceImportResultSchema),
  },
  "voices.listCompatible": {
    request: z.object({ engineId: IdSchema.optional() }),
    response: createIpcResponseSchema(z.array(VoiceProfileSchema)),
  },
  "audiobook.getExport": {
    request: BookIdRequestSchema,
    response: createIpcResponseSchema(AudiobookExportSchema.nullable()),
  },
  "audiobook.listLibraryStatus": {
    request: EmptyRequestSchema,
    response: createIpcResponseSchema(z.array(LibraryAudioStatusSchema)),
  },
  "audiobook.enableAutoBuild": {
    request: z.object({
      bookId: IdSchema,
      enabled: z.boolean(),
    }),
    response: createIpcResponseSchema(AudiobookExportSchema),
  },
  "audiobook.rebuild": {
    request: BookIdRequestSchema,
    response: createIpcResponseSchema(AudiobookExportSchema),
  },
  "audiobook.deleteExport": {
    request: BookIdRequestSchema,
    response: createIpcResponseSchema(AudiobookExportSchema),
  },
  "audiobook.getBuildJob": {
    request: BookIdRequestSchema,
    response: createIpcResponseSchema(AudiobookBuildJobSchema.nullable()),
  },
  "audiobook.save": {
    request: BookIdRequestSchema,
    response: createIpcResponseSchema(
      z.object({
        saved: z.boolean(),
        filePath: z.string().trim().min(1).optional(),
      }),
    ),
  },
  "audiobook.reveal": {
    request: BookIdRequestSchema,
    response: createIpcResponseSchema(z.object({ revealed: z.literal(true) })),
  },
  "models.list": {
    request: EmptyRequestSchema,
    response: createIpcResponseSchema(z.array(ModelAssetSchema)),
  },
  "models.diagnostics": {
    request: EmptyRequestSchema,
    response: createIpcResponseSchema(z.array(RuntimeDiagnosticSchema)),
  },
  "models.downloads": {
    request: EmptyRequestSchema,
    response: createIpcResponseSchema(z.array(ModelDownloadJobSchema)),
  },
  "models.operations": {
    request: EmptyRequestSchema,
    response: createIpcResponseSchema(z.array(RuntimeOperationJobSchema)),
  },
  "models.huggingFaceToken": {
    request: EmptyRequestSchema,
    response: createIpcResponseSchema(HuggingFaceTokenStatusSchema),
  },
  "models.updateHuggingFaceToken": {
    request: UpdateHuggingFaceTokenRequestSchema,
    response: createIpcResponseSchema(HuggingFaceTokenStatusSchema),
  },
  "models.installFromPath": {
    request: z.object({ path: z.string().trim().min(1).optional() }).default({}),
    response: createIpcResponseSchema(ModelAssetSchema.nullable()),
  },
  "models.installRecommended": {
    request: InstallRecommendedModelRequestSchema,
    response: createIpcResponseSchema(RuntimeOperationJobSchema),
  },
  "models.download": {
    request: DownloadModelRequestSchema,
    response: createIpcResponseSchema(ModelDownloadJobSchema),
  },
  "models.delete": {
    request: DeleteModelRequestSchema,
    response: createIpcResponseSchema(ModelAssetSchema),
  },
  "sidecars.list": {
    request: EmptyRequestSchema,
    response: createIpcResponseSchema(z.array(RuntimeSidecarSchema)),
  },
  "sidecars.install": {
    request: SidecarRequestSchema,
    response: createIpcResponseSchema(RuntimeOperationJobSchema),
  },
  "sidecars.uninstall": {
    request: SidecarRequestSchema,
    response: createIpcResponseSchema(RuntimeOperationJobSchema),
  },
  "pronunciation.list": {
    request: ListPronunciationEntriesRequestSchema,
    response: createIpcResponseSchema(z.array(PronunciationEntrySchema)),
  },
  "pronunciation.create": {
    request: CreatePronunciationEntryRequestSchema,
    response: createIpcResponseSchema(PronunciationEntrySchema),
  },
  "pronunciation.update": {
    request: UpdatePronunciationEntryRequestSchema,
    response: createIpcResponseSchema(PronunciationEntrySchema),
  },
  "pronunciation.delete": {
    request: DeletePronunciationEntryRequestSchema,
    response: createIpcResponseSchema(z.object({ deleted: z.literal(true) })),
  },
  "settings.get": {
    request: EmptyRequestSchema,
    response: createIpcResponseSchema(SettingsSchema),
  },
  "settings.update": {
    request: UpdateSettingsRequestSchema,
    response: createIpcResponseSchema(SettingsSchema),
  },
} as const;

export type IpcContractSchemas = typeof IpcContractSchemas;
export type IpcRequest<C extends IpcChannel> = z.infer<
  IpcContractSchemas[C]["request"]
>;
export type IpcResponseFor<C extends IpcChannel> = z.infer<
  IpcContractSchemas[C]["response"]
>;
