CREATE TABLE "annotations" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"locator_json" jsonb NOT NULL,
	"quote" text NOT NULL,
	"color" text DEFAULT 'yellow' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"book_id" text,
	"path" text NOT NULL,
	"mime_type" text NOT NULL,
	"content_hash" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audiobook_exports" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"auto_build_enabled" boolean DEFAULT false NOT NULL,
	"format" text DEFAULT 'm4b' NOT NULL,
	"asset_id" text,
	"draft_asset_id" text,
	"manifest_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"chapters_ready" integer DEFAULT 0 NOT NULL,
	"chapters_total" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_built_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bookmarks" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"locator_json" jsonb NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" text PRIMARY KEY NOT NULL,
	"content_hash" text NOT NULL,
	"file_type" text NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"authors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"language" text DEFAULT 'pt-BR' NOT NULL,
	"publisher" text,
	"published_at" text,
	"description" text,
	"original_path" text,
	"library_path" text NOT NULL,
	"cover_asset_id" text,
	"manifest_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_opened_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "collection_books" (
	"collection_id" text NOT NULL,
	"book_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_books_collection_id_book_id_pk" PRIMARY KEY("collection_id","book_id")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reading_positions" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"locator_json" jsonb NOT NULL,
	"chapter_href" text,
	"progression" real DEFAULT 0 NOT NULL,
	"audio_position_ms" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value_json" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tts_engines" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"version" text NOT NULL,
	"adapter_id" text NOT NULL,
	"runtime" text NOT NULL,
	"model_format" text NOT NULL,
	"accelerator" text NOT NULL,
	"capabilities_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"performance_profile_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"installed" boolean DEFAULT false NOT NULL,
	"install_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"language" text DEFAULT 'pt-BR' NOT NULL,
	"kind" text DEFAULT 'built_in' NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"settings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"consent_confirmed_at" timestamp with time zone,
	"consent_note" text DEFAULT '' NOT NULL,
	"preview_asset_id" text,
	"created_from_engine_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audiobook_exports" ADD CONSTRAINT "audiobook_exports_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_books" ADD CONSTRAINT "collection_books_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_books" ADD CONSTRAINT "collection_books_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_positions" ADD CONSTRAINT "reading_positions_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_created_from_engine_id_tts_engines_id_fk" FOREIGN KEY ("created_from_engine_id") REFERENCES "public"."tts_engines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "annotations_book_id_idx" ON "annotations" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "assets_content_hash_idx" ON "assets" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "assets_book_id_idx" ON "assets" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "audiobook_exports_book_id_idx" ON "audiobook_exports" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "audiobook_exports_status_idx" ON "audiobook_exports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bookmarks_book_id_idx" ON "bookmarks" USING btree ("book_id");--> statement-breakpoint
CREATE UNIQUE INDEX "books_content_hash_idx" ON "books" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "books_title_idx" ON "books" USING btree ("title");--> statement-breakpoint
CREATE INDEX "books_language_idx" ON "books" USING btree ("language");--> statement-breakpoint
CREATE UNIQUE INDEX "reading_positions_book_id_idx" ON "reading_positions" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "tts_engines_adapter_id_idx" ON "tts_engines" USING btree ("adapter_id");--> statement-breakpoint
CREATE INDEX "tts_engines_runtime_idx" ON "tts_engines" USING btree ("runtime");--> statement-breakpoint
CREATE INDEX "voice_profiles_language_idx" ON "voice_profiles" USING btree ("language");--> statement-breakpoint
CREATE INDEX "voice_profiles_kind_idx" ON "voice_profiles" USING btree ("kind");