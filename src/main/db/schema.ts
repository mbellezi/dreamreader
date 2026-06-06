import {
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
    ttsSegmentsBookChapterIdx: index("tts_segments_book_chapter_idx").on(table.bookId, table.chapterHref)
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
