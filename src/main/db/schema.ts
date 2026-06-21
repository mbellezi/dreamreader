import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex
} from "drizzle-orm/pg-core"

export const books = pgTable(
  "books",
  {
    id: text("id").primaryKey(),
    contentHash: text("content_hash").notNull(),
    fileType: text("file_type").notNull(),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    authors: jsonb("authors").$type<string[]>().notNull().default([]),
    language: text("language").notNull().default("pt-BR"),
    publisher: text("publisher"),
    publishedAt: text("published_at"),
    description: text("description"),
    originalPath: text("original_path"),
    libraryPath: text("library_path").notNull(),
    coverAssetId: text("cover_asset_id"),
    manifestJson: jsonb("manifest_json").$type<Record<string, unknown>>().notNull().default({}),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true })
  },
  (table) => ({
    contentHashIdx: uniqueIndex("books_content_hash_idx").on(table.contentHash),
    titleIdx: index("books_title_idx").on(table.title),
    languageIdx: index("books_language_idx").on(table.language)
  })
)

export const assets = pgTable(
  "assets",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    bookId: text("book_id").references(() => books.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    mimeType: text("mime_type").notNull(),
    contentHash: text("content_hash").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    assetHashIdx: index("assets_content_hash_idx").on(table.contentHash),
    assetBookIdx: index("assets_book_id_idx").on(table.bookId)
  })
)

export const readingPositions = pgTable(
  "reading_positions",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    locatorJson: jsonb("locator_json").$type<Record<string, unknown>>().notNull(),
    chapterHref: text("chapter_href"),
    progression: real("progression").notNull().default(0),
    audioPositionMs: integer("audio_position_ms").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    readingPositionBookIdx: uniqueIndex("reading_positions_book_id_idx").on(table.bookId)
  })
)

export const annotations = pgTable(
  "annotations",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    locatorJson: jsonb("locator_json").$type<Record<string, unknown>>().notNull(),
    quote: text("quote").notNull(),
    color: text("color").notNull().default("yellow"),
    note: text("note").notNull().default(""),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true })
  },
  (table) => ({
    annotationsBookIdx: index("annotations_book_id_idx").on(table.bookId)
  })
)

export const bookmarks = pgTable(
  "bookmarks",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    locatorJson: jsonb("locator_json").$type<Record<string, unknown>>().notNull(),
    label: text("label").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    bookmarksBookIdx: index("bookmarks_book_id_idx").on(table.bookId)
  })
)

export const collections = pgTable("collections", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
})

export const collectionBooks = pgTable(
  "collection_books",
  {
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.collectionId, table.bookId] })
  })
)

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  valueJson: jsonb("value_json").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
})

export const ttsEngines = pgTable(
  "tts_engines",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    version: text("version").notNull(),
    adapterId: text("adapter_id").notNull(),
    runtime: text("runtime").notNull(),
    modelFormat: text("model_format").notNull(),
    accelerator: text("accelerator").notNull(),
    capabilitiesJson: jsonb("capabilities_json").$type<Record<string, unknown>>().notNull().default({}),
    performanceProfileJson: jsonb("performance_profile_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    installed: boolean("installed").notNull().default(false),
    installPath: text("install_path"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    ttsAdapterIdx: index("tts_engines_adapter_id_idx").on(table.adapterId),
    ttsRuntimeIdx: index("tts_engines_runtime_idx").on(table.runtime)
  })
)

export const voiceProfiles = pgTable(
  "voice_profiles",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    language: text("language").notNull().default("pt-BR"),
    kind: text("kind").notNull().default("built_in"),
    source: text("source").notNull().default(""),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    settingsJson: jsonb("settings_json").$type<Record<string, unknown>>().notNull().default({}),
    consentConfirmedAt: timestamp("consent_confirmed_at", { withTimezone: true }),
    consentNote: text("consent_note").notNull().default(""),
    previewAssetId: text("preview_asset_id"),
    createdFromEngineId: text("created_from_engine_id").references(() => ttsEngines.id, {
      onDelete: "set null"
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    voiceLanguageIdx: index("voice_profiles_language_idx").on(table.language),
    voiceKindIdx: index("voice_profiles_kind_idx").on(table.kind)
  })
)

export const voiceSamples = pgTable(
  "voice_samples",
  {
    id: text("id").primaryKey(),
    voiceProfileId: text("voice_profile_id")
      .notNull()
      .references(() => voiceProfiles.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    transcript: text("transcript"),
    language: text("language"),
    durationMs: integer("duration_ms").notNull(),
    qualityJson: jsonb("quality_json").$type<Record<string, unknown>>().notNull().default({}),
    consentConfirmedAt: timestamp("consent_confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    voiceSamplesProfileIdx: index("voice_samples_profile_id_idx").on(table.voiceProfileId),
    voiceSamplesAssetIdx: index("voice_samples_asset_id_idx").on(table.assetId)
  })
)

export const voiceEngineBindings = pgTable(
  "voice_engine_bindings",
  {
    id: text("id").primaryKey(),
    voiceProfileId: text("voice_profile_id")
      .notNull()
      .references(() => voiceProfiles.id, { onDelete: "cascade" }),
    engineId: text("engine_id")
      .notNull()
      .references(() => ttsEngines.id, { onDelete: "cascade" }),
    adapterId: text("adapter_id").notNull(),
    status: text("status").notNull().default("pending"),
    bindingKind: text("binding_kind").notNull(),
    bindingAssetId: text("binding_asset_id").references(() => assets.id, { onDelete: "set null" }),
    settingsJson: jsonb("settings_json").$type<Record<string, unknown>>().notNull().default({}),
    compatibilityJson: jsonb("compatibility_json").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    voiceBindingsProfileIdx: index("voice_engine_bindings_profile_id_idx").on(table.voiceProfileId),
    voiceBindingsEngineIdx: index("voice_engine_bindings_engine_id_idx").on(table.engineId),
    voiceBindingsStatusIdx: index("voice_engine_bindings_status_idx").on(table.status),
    voiceBindingsUniqueIdx: uniqueIndex("voice_engine_bindings_voice_engine_idx").on(
      table.voiceProfileId,
      table.engineId
    )
  })
)

export const pronunciationEntries = pgTable(
  "pronunciation_entries",
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull().default("global"),
    bookId: text("book_id").references(() => books.id, { onDelete: "cascade" }),
    pattern: text("pattern").notNull(),
    replacement: text("replacement").notNull(),
    matchKind: text("match_kind").notNull().default("word"),
    caseSensitive: boolean("case_sensitive").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    pronunciationScopeIdx: index("pronunciation_entries_scope_idx").on(table.scope),
    pronunciationBookIdx: index("pronunciation_entries_book_id_idx").on(table.bookId)
  })
)

export const audiobookExports = pgTable(
  "audiobook_exports",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("none"),
    autoBuildEnabled: boolean("auto_build_enabled").notNull().default(false),
    format: text("format").notNull().default("m4b"),
    assetId: text("asset_id"),
    draftAssetId: text("draft_asset_id"),
    manifestJson: jsonb("manifest_json").$type<Record<string, unknown>>().notNull().default({}),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default({}),
    chaptersReady: integer("chapters_ready").notNull().default(0),
    chaptersTotal: integer("chapters_total").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    stale: boolean("stale").notNull().default(false),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastBuiltAt: timestamp("last_built_at", { withTimezone: true })
  },
  (table) => ({
    audiobookBookIdx: index("audiobook_exports_book_id_idx").on(table.bookId),
    audiobookStatusIdx: index("audiobook_exports_status_idx").on(table.status)
  })
)

export const ttsJobs = pgTable(
  "tts_jobs",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    chapterHref: text("chapter_href").notNull(),
    engineId: text("engine_id")
      .notNull()
      .references(() => ttsEngines.id, { onDelete: "restrict" }),
    voiceProfileId: text("voice_profile_id").references(() => voiceProfiles.id, { onDelete: "set null" }),
    voiceBindingId: text("voice_binding_id"),
    status: text("status").notNull().default("queued"),
    progress: real("progress").notNull().default(0),
    settingsJson: jsonb("settings_json").$type<Record<string, unknown>>().notNull().default({}),
    narrationPlanVersion: text("narration_plan_version"),
    resourcePolicyJson: jsonb("resource_policy_json").$type<Record<string, unknown>>().notNull().default({}),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    ttsJobsStatusIdx: index("tts_jobs_status_idx").on(table.status),
    ttsJobsBookIdx: index("tts_jobs_book_id_idx").on(table.bookId),
    ttsJobsChapterIdx: index("tts_jobs_chapter_href_idx").on(table.chapterHref)
  })
)

export const ttsSegments = pgTable(
  "tts_segments",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => ttsJobs.id, { onDelete: "cascade" }),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    chapterHref: text("chapter_href").notNull(),
    segmentIndex: integer("segment_index").notNull(),
    segmentHash: text("segment_hash").notNull(),
    locatorJson: jsonb("locator_json").$type<Record<string, unknown>>().notNull(),
    originalText: text("original_text").notNull(),
    normalizedText: text("normalized_text").notNull(),
    prosodyJson: jsonb("prosody_json").$type<Record<string, unknown>>().notNull().default({}),
    adapterPayloadJson: jsonb("adapter_payload_json").$type<Record<string, unknown>>().notNull().default({}),
    audioAssetId: text("audio_asset_id").references(() => assets.id, { onDelete: "set null" }),
    durationMs: integer("duration_ms"),
    status: text("status").notNull().default("queued"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    ttsSegmentsJobIdx: index("tts_segments_job_id_idx").on(table.jobId),
    ttsSegmentsHashIdx: index("tts_segments_segment_hash_idx").on(table.segmentHash),
    ttsSegmentsBookChapterIdx: index("tts_segments_book_chapter_idx").on(table.bookId, table.chapterHref),
    ttsSegmentsTextSearchIdx: index("tts_segments_text_search_idx").using(
      "gin",
      sql`to_tsvector('simple', coalesce(${table.originalText}, '') || ' ' || coalesce(${table.normalizedText}, ''))`
    )
  })
)

export const prosodyAnalyses = pgTable(
  "prosody_analyses",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    chapterHref: text("chapter_href").notNull(),
    segmentId: text("segment_id").notNull(),
    segmentHash: text("segment_hash").notNull(),
    analyzerId: text("analyzer_id").notNull(),
    analyzerVersion: text("analyzer_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    status: text("status").notNull().default("completed"),
    voiceRole: text("voice_role"),
    prosodyJson: jsonb("prosody_json").$type<Record<string, unknown>>().notNull(),
    rawResponseJson: jsonb("raw_response_json").$type<Record<string, unknown>>().notNull().default({}),
    fallbackReason: text("fallback_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    prosodyAnalysesSegmentIdx: index("prosody_analyses_segment_hash_idx").on(table.segmentHash),
    prosodyAnalysesBookChapterIdx: index("prosody_analyses_book_chapter_idx").on(table.bookId, table.chapterHref),
    prosodyAnalysesCacheIdx: uniqueIndex("prosody_analyses_cache_idx").on(
      table.segmentHash,
      table.analyzerId,
      table.analyzerVersion,
      table.promptVersion
    )
  })
)

export const modelAssets = pgTable(
  "model_assets",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    provider: text("provider").notNull(),
    version: text("version").notNull(),
    path: text("path"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    checksum: text("checksum"),
    license: text("license").notNull().default("unknown"),
    runtime: text("runtime").notNull(),
    format: text("format").notNull(),
    acceleratorPreference: text("accelerator_preference").notNull().default("cpu"),
    memoryEstimateMb: integer("memory_estimate_mb"),
    checksumAlgorithm: text("checksum_algorithm"),
    sourceUrl: text("source_url"),
    installStatus: text("install_status").notNull().default("not_configured"),
    downloadProgress: real("download_progress").notNull().default(0),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default({}),
    installedAt: timestamp("installed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    modelAssetsKindIdx: index("model_assets_kind_idx").on(table.kind),
    modelAssetsRuntimeIdx: index("model_assets_runtime_idx").on(table.runtime),
    modelAssetsStatusIdx: index("model_assets_status_idx").on(table.installStatus)
  })
)

export const modelDownloadJobs = pgTable(
  "model_download_jobs",
  {
    id: text("id").primaryKey(),
    modelAssetId: text("model_asset_id")
      .notNull()
      .references(() => modelAssets.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"),
    progress: real("progress").notNull().default(0),
    receivedBytes: bigint("received_bytes", { mode: "number" }).notNull().default(0),
    totalBytes: bigint("total_bytes", { mode: "number" }),
    sourceUrl: text("source_url").notNull(),
    targetPath: text("target_path").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    modelDownloadJobsModelIdx: index("model_download_jobs_model_idx").on(table.modelAssetId),
    modelDownloadJobsStatusIdx: index("model_download_jobs_status_idx").on(table.status)
  })
)

export const runtimeManifests = pgTable(
  "runtime_manifests",
  {
    id: text("id").primaryKey(),
    adapterId: text("adapter_id").notNull(),
    runtime: text("runtime").notNull(),
    version: text("version").notNull(),
    executablePath: text("executable_path"),
    environmentJson: jsonb("environment_json").$type<Record<string, unknown>>().notNull().default({}),
    healthcheckCommand: text("healthcheck_command"),
    capabilitiesJson: jsonb("capabilities_json").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    runtimeManifestsAdapterIdx: index("runtime_manifests_adapter_id_idx").on(table.adapterId),
    runtimeManifestsRuntimeIdx: index("runtime_manifests_runtime_idx").on(table.runtime)
  })
)

export const audiobookChapters = pgTable(
  "audiobook_chapters",
  {
    id: text("id").primaryKey(),
    audiobookExportId: text("audiobook_export_id")
      .notNull()
      .references(() => audiobookExports.id, { onDelete: "cascade" }),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    chapterHref: text("chapter_href").notNull(),
    chapterIndex: integer("chapter_index").notNull(),
    title: text("title").notNull(),
    audioAssetId: text("audio_asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    voiceProfileId: text("voice_profile_id").references(() => voiceProfiles.id, { onDelete: "set null" }),
    voiceBindingId: text("voice_binding_id"),
    engineId: text("engine_id")
      .notNull()
      .references(() => ttsEngines.id, { onDelete: "restrict" }),
    durationMs: integer("duration_ms").notNull(),
    startMs: integer("start_ms").notNull().default(0),
    endMs: integer("end_ms").notNull(),
    contentHash: text("content_hash").notNull(),
    audioHash: text("audio_hash").notNull(),
    status: text("status").notNull().default("ready"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    audiobookChaptersExportIdx: index("audiobook_chapters_export_idx").on(table.audiobookExportId),
    audiobookChaptersHrefIdx: index("audiobook_chapters_href_idx").on(table.chapterHref),
    audiobookChaptersUniqueIdx: uniqueIndex("audiobook_chapters_book_chapter_idx").on(table.bookId, table.chapterHref)
  })
)

export const audiobookBuildJobs = pgTable(
  "audiobook_build_jobs",
  {
    id: text("id").primaryKey(),
    audiobookExportId: text("audiobook_export_id")
      .notNull()
      .references(() => audiobookExports.id, { onDelete: "cascade" }),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"),
    progress: real("progress").notNull().default(0),
    reason: text("reason").notNull(),
    tempAssetId: text("temp_asset_id").references(() => assets.id, { onDelete: "set null" }),
    resultAssetId: text("result_asset_id").references(() => assets.id, { onDelete: "set null" }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    audiobookBuildJobsStatusIdx: index("audiobook_build_jobs_status_idx").on(table.status),
    audiobookBuildJobsBookIdx: index("audiobook_build_jobs_book_id_idx").on(table.bookId)
  })
)
