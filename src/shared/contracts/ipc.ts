import { z } from "zod";
import {
  AnnotationSchema,
  BookmarkSchema,
  CreateAnnotationInputSchema,
  CreateAnnotationRequestSchema,
  DeleteAnnotationRequestSchema,
  ExportAnnotationsInputSchema,
  UpdateAnnotationInputSchema,
  UpdateAnnotationRequestSchema,
} from "./annotations";
import {
  createIpcResponseSchema,
  IdSchema,
  JsonObjectSchema,
} from "./common";
import {
  ImportFilesRequestSchema,
  ImportFilesResultSchema,
  ImportBooksInputSchema,
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
  AudiobookExportSchema,
  EnqueueChapterTtsRequestSchema,
  NarrationPlanSchema,
  TtsAdapterManifestSchema,
  TtsEngineCapabilitiesSchema,
  TtsJobSchema,
  VoiceCloneInputSchema,
  VoiceFilterSchema,
  VoiceProfileSchema,
} from "./ai";

export {
  AnnotationSchema,
  AppSettingsSchema,
  AudiobookExportSchema,
  BookmarkSchema,
  BookSchema,
  CreateAnnotationInputSchema,
  ExportAnnotationsInputSchema,
  ImportBooksInputSchema,
  LibraryBookSchema,
  NarrationPlanSchema,
  ReaderChapterSchema,
  ReaderManifestSchema,
  ReaderOpenResultSchema,
  ReadingPositionSchema,
  SaveReadingPositionInputSchema,
  TtsAdapterManifestSchema,
  TtsEngineCapabilitiesSchema,
  TtsJobSchema,
  UpdateAnnotationInputSchema,
  VoiceCloneInputSchema,
  VoiceProfileSchema,
};
export type {
  Annotation,
  Bookmark,
  CreateAnnotationInput,
  ExportAnnotationsInput,
  UpdateAnnotationInput,
} from "./annotations";
export type { AudiobookExport, NarrationPlan, TtsEngineCapabilities, TtsJob, VoiceProfile } from "./ai";
export type { Book, ImportBooksInput, LibraryBook } from "./library";
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
  "reader.openBook",
  "reader.getResource",
  "reader.saveLocator",
  "annotations.create",
  "annotations.update",
  "annotations.delete",
  "annotations.export",
  "bookmarks.create",
  "tts.enqueueChapter",
  "tts.cancelJob",
  "tts.retryJob",
  "tts.getJob",
  "tts.listJobs",
  "voices.list",
  "voices.createFromReference",
  "voices.preview",
  "voices.update",
  "voices.delete",
  "voices.listCompatible",
  "audiobook.getExport",
  "audiobook.enableAutoBuild",
  "audiobook.rebuild",
  "audiobook.reveal",
  "models.list",
  "models.diagnostics",
  "models.installFromPath",
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
    response: createIpcResponseSchema(z.string()),
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
  "tts.cancelJob": {
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
  "voices.list": {
    request: VoiceFilterSchema.default({ includeUnavailable: false }),
    response: createIpcResponseSchema(z.array(VoiceProfileSchema)),
  },
  "voices.createFromReference": {
    request: VoiceCloneInputSchema,
    response: createIpcResponseSchema(VoiceProfileSchema),
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
  "voices.listCompatible": {
    request: z.object({ engineId: IdSchema.optional() }),
    response: createIpcResponseSchema(z.array(VoiceProfileSchema)),
  },
  "audiobook.getExport": {
    request: BookIdRequestSchema,
    response: createIpcResponseSchema(AudiobookExportSchema.nullable()),
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
  "audiobook.reveal": {
    request: BookIdRequestSchema,
    response: createIpcResponseSchema(z.object({ revealed: z.literal(true) })),
  },
  "models.list": {
    request: EmptyRequestSchema,
    response: createIpcResponseSchema(z.array(JsonObjectSchema)),
  },
  "models.diagnostics": {
    request: EmptyRequestSchema,
    response: createIpcResponseSchema(z.array(JsonObjectSchema)),
  },
  "models.installFromPath": {
    request: z.object({ path: z.string().trim().min(1) }),
    response: createIpcResponseSchema(JsonObjectSchema),
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
