import { z } from "zod";
import {
  AcceleratorSchema,
  IdSchema,
  IsoDateTimeStringSchema,
  JobStatusSchema,
  JsonObjectSchema,
  LocaleSchema,
  ModelFormatSchema,
  NonEmptyStringSchema,
  ProgressSchema,
  RuntimeSchema,
} from "./common";
import { ReaderLocatorSchema } from "./reader";

export const ProsodyEmotionSchema = z.enum([
  "neutral",
  "warm",
  "tense",
  "sad",
  "joyful",
  "angry",
  "suspense",
  "formal",
]);
export type ProsodyEmotion = z.infer<typeof ProsodyEmotionSchema>;

export const ProsodyPaceSchema = z.enum(["slow", "normal", "fast"]);
export type ProsodyPace = z.infer<typeof ProsodyPaceSchema>;

export const ProsodyPitchSchema = z.enum(["low", "neutral", "high"]);
export type ProsodyPitch = z.infer<typeof ProsodyPitchSchema>;

export const VoiceRoleSchema = z.enum([
  "narrator",
  "dialogue",
  "quote",
  "heading",
]);
export type VoiceRole = z.infer<typeof VoiceRoleSchema>;

export const NarrationProsodySchema = z.object({
  emotion: ProsodyEmotionSchema.default("neutral"),
  intensity: z.number().min(0).max(1).default(0.2),
  pace: ProsodyPaceSchema.default("normal"),
  pitch: ProsodyPitchSchema.default("neutral"),
  pauseBeforeMs: z.number().int().min(0).max(1500).default(0),
  pauseAfterMs: z.number().int().min(0).max(1500).default(350),
  instructionPtBr: z.string().trim().max(240).default(""),
});
export type NarrationProsody = z.infer<typeof NarrationProsodySchema>;

export const NarrationSegmentSchema = z.object({
  segmentId: NonEmptyStringSchema,
  locator: ReaderLocatorSchema,
  originalText: NonEmptyStringSchema,
  normalizedText: NonEmptyStringSchema,
  voiceRole: VoiceRoleSchema.optional(),
  prosody: NarrationProsodySchema,
});
export type NarrationSegment = z.infer<typeof NarrationSegmentSchema>;

export const NarrationPlanSchema = z.object({
  schemaVersion: z.literal("narration-plan/v1"),
  source: z.object({
    bookId: IdSchema,
    chapterHref: NonEmptyStringSchema,
    contentHash: NonEmptyStringSchema,
    language: LocaleSchema.or(NonEmptyStringSchema),
  }),
  normalization: z.object({
    normalizerId: NonEmptyStringSchema,
    version: NonEmptyStringSchema,
    dictionaryVersion: NonEmptyStringSchema,
  }),
  prosody: z.object({
    analyzerId: NonEmptyStringSchema,
    version: NonEmptyStringSchema,
    promptVersion: NonEmptyStringSchema.optional(),
  }),
  segments: z.array(NarrationSegmentSchema).min(1),
});
export type NarrationPlan = z.infer<typeof NarrationPlanSchema>;

export const TtsEngineCapabilitiesSchema = z.object({
  id: IdSchema,
  displayName: NonEmptyStringSchema,
  runtime: RuntimeSchema,
  modelFormat: ModelFormatSchema,
  languages: z.array(LocaleSchema.or(NonEmptyStringSchema)).min(1),
  supportsVoiceClone: z.boolean(),
  supportsNaturalLanguageInstruction: z.boolean(),
  supportsDiscreteEmotion: z.boolean(),
  supportsBatch: z.boolean(),
  supportsStreaming: z.boolean(),
  supportsSegmentTimestamps: z.boolean(),
  supportsSsmlLikeMarkup: z.boolean(),
  preferredInputCase: z.enum(["lowercase", "preserve"]).optional(),
  estimatedMemoryMb: z.number().int().positive().optional(),
});
export type TtsEngineCapabilities = z.infer<
  typeof TtsEngineCapabilitiesSchema
>;

export const TtsAdapterManifestSchema = z.object({
  adapterId: IdSchema,
  displayName: NonEmptyStringSchema,
  runtime: RuntimeSchema,
  modelFormats: z.array(ModelFormatSchema).min(1),
  languages: z.array(LocaleSchema.or(NonEmptyStringSchema)).min(1),
  capabilities: z.object({
    voiceClone: z.boolean(),
    naturalLanguageInstruction: z.boolean(),
    discreteEmotion: z.boolean(),
    batch: z.boolean(),
    streaming: z.boolean(),
    segmentTimestamps: z.boolean(),
    ssmlLikeMarkup: z.boolean().default(false),
  }),
});
export type TtsAdapterManifest = z.infer<typeof TtsAdapterManifestSchema>;

export const TtsEngineSchema = z.object({
  id: IdSchema,
  displayName: NonEmptyStringSchema,
  version: NonEmptyStringSchema.optional(),
  adapterId: IdSchema,
  runtime: RuntimeSchema,
  modelFormat: ModelFormatSchema,
  accelerator: AcceleratorSchema,
  capabilities: TtsEngineCapabilitiesSchema,
  performanceProfile: JsonObjectSchema.default({}),
  installed: z.boolean(),
  installPath: z.string().trim().optional(),
  createdAt: IsoDateTimeStringSchema,
  updatedAt: IsoDateTimeStringSchema,
});
export type TtsEngine = z.infer<typeof TtsEngineSchema>;

export const ModelInstallStatusSchema = z.enum([
  "not_configured",
  "queued",
  "downloading",
  "available",
  "failed",
]);
export type ModelInstallStatus = z.infer<typeof ModelInstallStatusSchema>;

export const ModelAssetSchema = z.object({
  id: IdSchema,
  kind: z.enum(["llm", "tts", "tokenizer", "vocoder", "runtime"]),
  name: NonEmptyStringSchema,
  provider: NonEmptyStringSchema,
  version: NonEmptyStringSchema,
  runtime: NonEmptyStringSchema,
  format: ModelFormatSchema,
  acceleratorPreference: NonEmptyStringSchema,
  installStatus: ModelInstallStatusSchema,
  downloadProgress: ProgressSchema.default(0),
  path: z.string().trim().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  checksum: z.string().trim().optional(),
  checksumAlgorithm: z.string().trim().optional(),
  license: NonEmptyStringSchema,
  memoryEstimateMb: z.number().int().positive().optional(),
  sourceUrl: z.string().url().optional(),
  canDownload: z.boolean().default(false),
  engineId: IdSchema.optional(),
  metadata: JsonObjectSchema.default({}),
  installedAt: IsoDateTimeStringSchema.optional(),
  createdAt: IsoDateTimeStringSchema,
  updatedAt: IsoDateTimeStringSchema,
});
export type ModelAsset = z.infer<typeof ModelAssetSchema>;

export const ModelDownloadJobSchema = z.object({
  id: IdSchema,
  modelAssetId: IdSchema,
  status: ModelInstallStatusSchema,
  progress: ProgressSchema,
  receivedBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative().optional(),
  sourceUrl: z.string().url(),
  targetPath: NonEmptyStringSchema,
  errorCode: z.string().trim().optional(),
  errorMessage: z.string().trim().optional(),
  createdAt: IsoDateTimeStringSchema,
  startedAt: IsoDateTimeStringSchema.optional(),
  finishedAt: IsoDateTimeStringSchema.optional(),
  updatedAt: IsoDateTimeStringSchema,
});
export type ModelDownloadJob = z.infer<typeof ModelDownloadJobSchema>;

export const DownloadModelRequestSchema = z.object({
  modelId: IdSchema,
});
export type DownloadModelRequest = z.infer<typeof DownloadModelRequestSchema>;

export const RuntimeDiagnosticSchema = z.object({
  id: IdSchema,
  label: NonEmptyStringSchema,
  status: z.enum(["available", "not_configured"]),
  detail: z.string().trim(),
});
export type RuntimeDiagnostic = z.infer<typeof RuntimeDiagnosticSchema>;

export const RuntimeSidecarSchema = z.object({
  id: IdSchema,
  adapterId: IdSchema,
  name: NonEmptyStringSchema,
  runtime: NonEmptyStringSchema,
  status: z.enum(["available", "not_configured", "failed"]),
  executablePath: z.string().trim().optional(),
  scriptPath: z.string().trim().optional(),
  healthcheckCommand: z.string().trim().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  modelEngineIds: z.array(IdSchema).default([]),
  createdAt: IsoDateTimeStringSchema,
  updatedAt: IsoDateTimeStringSchema,
});
export type RuntimeSidecar = z.infer<typeof RuntimeSidecarSchema>;

export const RuntimeOperationStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
]);
export type RuntimeOperationStatus = z.infer<
  typeof RuntimeOperationStatusSchema
>;

export const RuntimeOperationKindSchema = z.enum([
  "model_download",
  "model_install",
  "model_delete",
  "sidecar_install",
  "sidecar_uninstall",
]);
export type RuntimeOperationKind = z.infer<typeof RuntimeOperationKindSchema>;

export const RuntimeOperationLogEntrySchema = z.object({
  id: IdSchema,
  level: z.enum(["info", "warning", "error"]),
  messageKey: NonEmptyStringSchema,
  values: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  createdAt: IsoDateTimeStringSchema,
});
export type RuntimeOperationLogEntry = z.infer<
  typeof RuntimeOperationLogEntrySchema
>;

export const RuntimeOperationJobSchema = z.object({
  id: IdSchema,
  kind: RuntimeOperationKindSchema,
  targetKind: z.enum(["model", "sidecar"]),
  targetId: IdSchema,
  status: RuntimeOperationStatusSchema,
  progress: ProgressSchema.default(0),
  progressLabelKey: NonEmptyStringSchema.optional(),
  progressLabelValues: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .default({}),
  errorCode: z.string().trim().optional(),
  errorMessage: z.string().trim().optional(),
  logs: z.array(RuntimeOperationLogEntrySchema).default([]),
  createdAt: IsoDateTimeStringSchema,
  startedAt: IsoDateTimeStringSchema.optional(),
  finishedAt: IsoDateTimeStringSchema.optional(),
  updatedAt: IsoDateTimeStringSchema,
});
export type RuntimeOperationJob = z.infer<typeof RuntimeOperationJobSchema>;

export const InstallRecommendedModelRequestSchema = z.object({
  modelId: IdSchema,
});
export type InstallRecommendedModelRequest = z.infer<
  typeof InstallRecommendedModelRequestSchema
>;

export const DeleteModelRequestSchema = z.object({
  modelId: IdSchema,
  deleteFiles: z.boolean().default(true),
});
export type DeleteModelRequest = z.infer<typeof DeleteModelRequestSchema>;

export const SidecarRequestSchema = z.object({
  sidecarId: IdSchema,
});
export type SidecarRequest = z.infer<typeof SidecarRequestSchema>;

export const HuggingFaceTokenStatusSchema = z.object({
  configured: z.boolean(),
  storage: z.enum(["electron-safe-storage"]).optional(),
  updatedAt: IsoDateTimeStringSchema.optional(),
});
export type HuggingFaceTokenStatus = z.infer<
  typeof HuggingFaceTokenStatusSchema
>;

export const UpdateHuggingFaceTokenRequestSchema = z.object({
  token: z.string().trim().max(4096),
});
export type UpdateHuggingFaceTokenRequest = z.infer<
  typeof UpdateHuggingFaceTokenRequestSchema
>;

export const TtsGenerationSeedSchema = z
  .number()
  .int()
  .min(0)
  .max(4_294_967_295);
export type TtsGenerationSeed = z.infer<typeof TtsGenerationSeedSchema>;

export const TtsModelSettingsSchema = z
  .object({
    cfgStrength: z.number().min(0).max(10).optional(),
    crossFadeDuration: z.number().min(0).max(2).optional(),
    doSample: z.boolean().optional(),
    maxNewTokens: z.number().int().positive().max(32_768).optional(),
    nfeStep: z.number().int().min(1).max(128).optional(),
    nonStreamingMode: z.boolean().optional(),
    removeSilence: z.boolean().optional(),
    repetitionPenalty: z.number().min(0).max(3).optional(),
    speed: z.number().min(0.25).max(2).optional(),
    subtalkerDoSample: z.boolean().optional(),
    subtalkerTemperature: z.number().min(0).max(2).optional(),
    subtalkerTopK: z.number().int().min(0).max(200).optional(),
    subtalkerTopP: z.number().min(0).max(1).optional(),
    swaySamplingCoef: z.number().min(-10).max(10).optional(),
    targetRms: z.number().min(0).max(1).optional(),
    temperature: z.number().min(0).max(2).optional(),
    topK: z.number().int().min(0).max(200).optional(),
    topP: z.number().min(0).max(1).optional(),
  })
  .default({});
export type TtsModelSettings = z.infer<typeof TtsModelSettingsSchema>;

export const VoiceKindSchema = z.enum([
  "built_in",
  "cloned",
  "imported",
  "generated",
]);
export type VoiceKind = z.infer<typeof VoiceKindSchema>;

export const VoiceProfileSchema = z.object({
  id: IdSchema,
  name: NonEmptyStringSchema,
  description: z.string().trim().optional(),
  language: LocaleSchema.or(NonEmptyStringSchema),
  kind: VoiceKindSchema,
  source: JsonObjectSchema.default({}),
  tags: z.array(NonEmptyStringSchema).default([]),
  settings: JsonObjectSchema.default({}),
  consentConfirmedAt: IsoDateTimeStringSchema.optional(),
  consentNote: z.string().trim().optional(),
  previewAssetId: IdSchema.optional(),
  createdFromEngineId: IdSchema.optional(),
  createdAt: IsoDateTimeStringSchema,
  updatedAt: IsoDateTimeStringSchema,
});
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;

export const VoiceSampleSchema = z.object({
  id: IdSchema,
  voiceProfileId: IdSchema,
  assetId: IdSchema,
  transcript: z.string().trim().optional(),
  language: LocaleSchema.or(NonEmptyStringSchema).optional(),
  durationMs: z.number().int().positive(),
  quality: JsonObjectSchema.default({}),
  consentConfirmedAt: IsoDateTimeStringSchema.optional(),
  createdAt: IsoDateTimeStringSchema,
});
export type VoiceSample = z.infer<typeof VoiceSampleSchema>;

export const VoiceBindingStatusSchema = z.enum([
  "pending",
  "ready",
  "failed",
  "disabled",
]);
export type VoiceBindingStatus = z.infer<typeof VoiceBindingStatusSchema>;

export const VoiceBindingKindSchema = z.enum([
  "reference_audio",
  "speaker_embedding",
  "preset",
  "voice_design_prompt",
]);
export type VoiceBindingKind = z.infer<typeof VoiceBindingKindSchema>;

export const VoiceEngineBindingSchema = z.object({
  id: IdSchema,
  voiceProfileId: IdSchema,
  engineId: IdSchema,
  adapterId: IdSchema,
  status: VoiceBindingStatusSchema,
  bindingKind: VoiceBindingKindSchema,
  bindingAssetId: IdSchema.optional(),
  settings: JsonObjectSchema.default({}),
  compatibility: JsonObjectSchema.default({}),
  createdAt: IsoDateTimeStringSchema,
  updatedAt: IsoDateTimeStringSchema,
});
export type VoiceEngineBinding = z.infer<typeof VoiceEngineBindingSchema>;

export const VoiceFilterSchema = z.object({
  language: LocaleSchema.or(NonEmptyStringSchema).optional(),
  kind: VoiceKindSchema.optional(),
  engineId: IdSchema.optional(),
  adapterId: IdSchema.optional(),
  includeUnavailable: z.boolean().default(false),
});
export type VoiceFilter = z.infer<typeof VoiceFilterSchema>;

export const VoiceCloneInputSchema = z.object({
  // Reference voices are shared across every compatible installed engine, so the
  // engine is optional (kept for backward compatibility / as a hint).
  engineId: IdSchema.optional(),
  name: NonEmptyStringSchema,
  referenceAudioPath: NonEmptyStringSchema,
  transcript: z.string().trim().optional(),
  language: LocaleSchema.or(NonEmptyStringSchema).default("pt-BR"),
  consentConfirmed: z.literal(true),
  consentNote: NonEmptyStringSchema,
});
export type VoiceCloneInput = z.infer<typeof VoiceCloneInputSchema>;

export const VoiceDesignPromptInputSchema = z.object({
  engineId: IdSchema,
  name: NonEmptyStringSchema,
  prompt: NonEmptyStringSchema.max(1200),
  language: LocaleSchema.or(NonEmptyStringSchema).default("pt-BR"),
});
export type VoiceDesignPromptInput = z.infer<
  typeof VoiceDesignPromptInputSchema
>;

export const PronunciationScopeSchema = z.enum(["global", "book"]);
export type PronunciationScope = z.infer<typeof PronunciationScopeSchema>;

export const PronunciationMatchKindSchema = z.enum([
  "literal",
  "word",
  "regex",
]);
export type PronunciationMatchKind = z.infer<
  typeof PronunciationMatchKindSchema
>;

export const PronunciationEntrySchema = z.object({
  id: IdSchema,
  scope: PronunciationScopeSchema,
  bookId: IdSchema.optional(),
  pattern: NonEmptyStringSchema.max(120),
  replacement: NonEmptyStringSchema.max(160),
  matchKind: PronunciationMatchKindSchema.default("word"),
  caseSensitive: z.boolean().default(false),
  createdAt: IsoDateTimeStringSchema,
  updatedAt: IsoDateTimeStringSchema,
});
export type PronunciationEntry = z.infer<typeof PronunciationEntrySchema>;

export const CreatePronunciationEntryRequestSchema = z.object({
  scope: PronunciationScopeSchema.default("global"),
  bookId: IdSchema.optional(),
  pattern: NonEmptyStringSchema.max(120),
  replacement: NonEmptyStringSchema.max(160),
  matchKind: PronunciationMatchKindSchema.default("word"),
  caseSensitive: z.boolean().default(false),
});
export type CreatePronunciationEntryRequest = z.infer<
  typeof CreatePronunciationEntryRequestSchema
>;

export const UpdatePronunciationEntryRequestSchema = z.object({
  id: IdSchema,
  pattern: NonEmptyStringSchema.max(120).optional(),
  replacement: NonEmptyStringSchema.max(160).optional(),
  matchKind: PronunciationMatchKindSchema.optional(),
  caseSensitive: z.boolean().optional(),
});
export type UpdatePronunciationEntryRequest = z.infer<
  typeof UpdatePronunciationEntryRequestSchema
>;

export const DeletePronunciationEntryRequestSchema = z.object({
  id: IdSchema,
});
export type DeletePronunciationEntryRequest = z.infer<
  typeof DeletePronunciationEntryRequestSchema
>;

export const ListPronunciationEntriesRequestSchema = z
  .object({
    bookId: IdSchema.optional(),
    includeGlobal: z.boolean().default(true),
  })
  .default({ includeGlobal: true });
export type ListPronunciationEntriesRequest = z.infer<
  typeof ListPronunciationEntriesRequestSchema
>;

export const ClearChapterAudioRequestSchema = z.object({
  bookId: IdSchema,
  chapterHref: NonEmptyStringSchema,
});
export type ClearChapterAudioRequest = z.infer<
  typeof ClearChapterAudioRequestSchema
>;

export const ClearTerminalTtsJobsRequestSchema = z.object({
  bookId: IdSchema,
});
export type ClearTerminalTtsJobsRequest = z.infer<
  typeof ClearTerminalTtsJobsRequestSchema
>;

export const ClearTtsJobsResultSchema = z.object({
  deleted: z.literal(true),
  jobsDeleted: z.number().int().nonnegative(),
  assetsDeleted: z.number().int().nonnegative(),
});
export type ClearTtsJobsResult = z.infer<typeof ClearTtsJobsResultSchema>;

export const TtsSynthesisInputSchema = z.object({
  jobId: IdSchema,
  engineId: IdSchema,
  voiceProfileId: IdSchema.optional(),
  voiceBindingId: IdSchema.optional(),
  plan: NarrationPlanSchema,
  outputDirectory: NonEmptyStringSchema,
  quality: z.enum(["draft", "standard", "high"]).default("standard"),
  generationLanguage: NonEmptyStringSchema.optional(),
  modelSettings: TtsModelSettingsSchema,
  seed: TtsGenerationSeedSchema.optional(),
});
export type TtsSynthesisInput = z.infer<typeof TtsSynthesisInputSchema>;

export const TtsProgressEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("job_progress"),
    jobId: IdSchema,
    status: JobStatusSchema,
    progress: ProgressSchema,
  }),
  z.object({
    type: z.literal("segment_completed"),
    jobId: IdSchema,
    segmentId: IdSchema,
    audioAssetId: IdSchema,
    durationMs: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("log"),
    jobId: IdSchema,
    level: z.enum(["debug", "info", "warn", "error"]),
    code: NonEmptyStringSchema,
    details: JsonObjectSchema.default({}),
  }),
]);
export type TtsProgressEvent = z.infer<typeof TtsProgressEventSchema>;

export const TtsJobSchema = z.object({
  id: IdSchema,
  bookId: IdSchema,
  chapterHref: NonEmptyStringSchema,
  engineId: IdSchema,
  voiceProfileId: IdSchema.optional(),
  voiceBindingId: IdSchema.optional(),
  status: JobStatusSchema,
  progress: ProgressSchema,
  settings: JsonObjectSchema.default({}),
  narrationPlanVersion: NonEmptyStringSchema.optional(),
  resourcePolicy: JsonObjectSchema.default({}),
  errorCode: z.string().trim().optional(),
  errorMessage: z.string().trim().optional(),
  createdAt: IsoDateTimeStringSchema,
  startedAt: IsoDateTimeStringSchema.optional(),
  finishedAt: IsoDateTimeStringSchema.optional(),
  updatedAt: IsoDateTimeStringSchema,
});
export type TtsJob = z.infer<typeof TtsJobSchema>;

export const EnqueueChapterTtsRequestSchema = z.object({
  bookId: IdSchema,
  chapterHref: NonEmptyStringSchema,
  engineId: IdSchema.default("dreamreader-local-tts"),
  voiceProfileId: IdSchema.optional(),
  voiceBindingId: IdSchema.optional(),
  quality: z.enum(["draft", "standard", "high"]).default("standard"),
  useExpressiveNarration: z.boolean().default(false),
  generationLanguage: NonEmptyStringSchema.optional(),
  modelSettings: TtsModelSettingsSchema,
  seed: TtsGenerationSeedSchema.optional(),
  seedFixed: z.boolean().default(false),
  // When set, only the first N paragraphs are synthesized (partial preview for
  // testing). Omitted/undefined means the whole chapter (default = total).
  paragraphLimit: z.number().int().positive().optional(),
});
export type EnqueueChapterTtsRequest = z.infer<
  typeof EnqueueChapterTtsRequestSchema
>;

export const EnqueueChaptersTtsRequestSchema = z.object({
  bookId: IdSchema,
  // Omitted means every chapter of the book.
  chapterHrefs: z.array(NonEmptyStringSchema).optional(),
  engineId: IdSchema.default("dreamreader-local-tts"),
  voiceProfileId: IdSchema.optional(),
  voiceBindingId: IdSchema.optional(),
  quality: z.enum(["draft", "standard", "high"]).default("standard"),
  useExpressiveNarration: z.boolean().default(false),
  generationLanguage: NonEmptyStringSchema.optional(),
  modelSettings: TtsModelSettingsSchema,
  seed: TtsGenerationSeedSchema.optional(),
  seedFixed: z.boolean().default(false),
});
export type EnqueueChaptersTtsRequest = z.infer<
  typeof EnqueueChaptersTtsRequestSchema
>;

export const TtsSegmentSummarySchema = z.object({
  id: IdSchema,
  jobId: IdSchema,
  segmentIndex: z.number().int().min(0),
  status: z.string(),
  textPreview: z.string(),
  audioAssetId: IdSchema.optional(),
  durationMs: z.number().int().nonnegative().optional(),
});
export type TtsSegmentSummary = z.infer<typeof TtsSegmentSummarySchema>;

export const AudiobookExportStatusSchema = z.enum([
  "none",
  "partial",
  "stale",
  "complete",
  "error",
]);
export type AudiobookExportStatus = z.infer<typeof AudiobookExportStatusSchema>;

export const AudiobookChapterManifestSchema = z.object({
  bookId: IdSchema,
  chapterHref: NonEmptyStringSchema,
  chapterIndex: z.number().int().min(0),
  title: NonEmptyStringSchema,
  audioAssetId: IdSchema,
  voiceProfileId: IdSchema.optional(),
  voiceBindingId: IdSchema.optional(),
  engineId: IdSchema,
  durationMs: z.number().int().positive(),
  startMs: z.number().int().min(0),
  endMs: z.number().int().positive(),
  contentHash: NonEmptyStringSchema,
  audioHash: NonEmptyStringSchema,
});
export type AudiobookChapterManifest = z.infer<
  typeof AudiobookChapterManifestSchema
>;

export const AudiobookManifestSchema = z.object({
  schemaVersion: z.literal("audiobook-manifest/v1"),
  bookId: IdSchema,
  title: NonEmptyStringSchema,
  authors: z.array(NonEmptyStringSchema).default([]),
  language: LocaleSchema.or(NonEmptyStringSchema).optional(),
  coverAssetId: IdSchema.optional(),
  generatedAt: IsoDateTimeStringSchema,
  engineId: IdSchema.optional(),
  voiceProfileId: IdSchema.optional(),
  chapters: z.array(AudiobookChapterManifestSchema),
  durationMs: z.number().int().min(0),
});
export type AudiobookManifest = z.infer<typeof AudiobookManifestSchema>;

export const LibraryAudioStatusSchema = z.object({
  bookId: IdSchema,
  title: NonEmptyStringSchema,
  authors: z.array(NonEmptyStringSchema).default([]),
  coverAssetId: IdSchema.optional(),
  status: AudiobookExportStatusSchema,
  chaptersReady: z.number().int().min(0),
  chaptersTotal: z.number().int().min(0),
  durationMs: z.number().int().min(0).default(0),
  hasChapterAudio: z.boolean(),
  hasActiveJob: z.boolean().default(false),
  updatedAt: IsoDateTimeStringSchema,
});
export type LibraryAudioStatus = z.infer<typeof LibraryAudioStatusSchema>;

export const AudiobookExportSchema = z.object({
  id: IdSchema,
  bookId: IdSchema,
  status: AudiobookExportStatusSchema,
  autoBuildEnabled: z.boolean(),
  format: z.literal("m4b"),
  assetId: IdSchema.optional(),
  draftAssetId: IdSchema.optional(),
  manifest: AudiobookManifestSchema.optional(),
  metadata: JsonObjectSchema.default({}),
  chaptersReady: z.number().int().min(0),
  chaptersTotal: z.number().int().min(0),
  durationMs: z.number().int().min(0).optional(),
  stale: z.boolean(),
  errorCode: z.string().trim().optional(),
  errorMessage: z.string().trim().optional(),
  createdAt: IsoDateTimeStringSchema,
  updatedAt: IsoDateTimeStringSchema,
  lastBuiltAt: IsoDateTimeStringSchema.optional(),
});
export type AudiobookExport = z.infer<typeof AudiobookExportSchema>;
