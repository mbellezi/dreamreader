CREATE TABLE "audiobook_build_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"audiobook_export_id" text NOT NULL,
	"book_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"reason" text NOT NULL,
	"temp_asset_id" text,
	"result_asset_id" text,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audiobook_chapters" (
	"id" text PRIMARY KEY NOT NULL,
	"audiobook_export_id" text NOT NULL,
	"book_id" text NOT NULL,
	"chapter_href" text NOT NULL,
	"chapter_index" integer NOT NULL,
	"title" text NOT NULL,
	"audio_asset_id" text NOT NULL,
	"voice_profile_id" text,
	"voice_binding_id" text,
	"engine_id" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"start_ms" integer DEFAULT 0 NOT NULL,
	"end_ms" integer NOT NULL,
	"content_hash" text NOT NULL,
	"audio_hash" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tts_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"chapter_href" text NOT NULL,
	"engine_id" text NOT NULL,
	"voice_profile_id" text,
	"voice_binding_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"settings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"narration_plan_version" text,
	"resource_policy_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tts_segments" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"book_id" text NOT NULL,
	"chapter_href" text NOT NULL,
	"segment_index" integer NOT NULL,
	"segment_hash" text NOT NULL,
	"locator_json" jsonb NOT NULL,
	"original_text" text NOT NULL,
	"normalized_text" text NOT NULL,
	"prosody_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"adapter_payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"audio_asset_id" text,
	"duration_ms" integer,
	"status" text DEFAULT 'queued' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
UPDATE "audiobook_exports" SET "status" = 'none' WHERE "status" = 'idle';--> statement-breakpoint
ALTER TABLE "audiobook_exports" ALTER COLUMN "status" SET DEFAULT 'none';--> statement-breakpoint
ALTER TABLE "audiobook_build_jobs" ADD CONSTRAINT "audiobook_build_jobs_audiobook_export_id_audiobook_exports_id_fk" FOREIGN KEY ("audiobook_export_id") REFERENCES "public"."audiobook_exports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audiobook_build_jobs" ADD CONSTRAINT "audiobook_build_jobs_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audiobook_build_jobs" ADD CONSTRAINT "audiobook_build_jobs_temp_asset_id_assets_id_fk" FOREIGN KEY ("temp_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audiobook_build_jobs" ADD CONSTRAINT "audiobook_build_jobs_result_asset_id_assets_id_fk" FOREIGN KEY ("result_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audiobook_chapters" ADD CONSTRAINT "audiobook_chapters_audiobook_export_id_audiobook_exports_id_fk" FOREIGN KEY ("audiobook_export_id") REFERENCES "public"."audiobook_exports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audiobook_chapters" ADD CONSTRAINT "audiobook_chapters_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audiobook_chapters" ADD CONSTRAINT "audiobook_chapters_audio_asset_id_assets_id_fk" FOREIGN KEY ("audio_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audiobook_chapters" ADD CONSTRAINT "audiobook_chapters_voice_profile_id_voice_profiles_id_fk" FOREIGN KEY ("voice_profile_id") REFERENCES "public"."voice_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audiobook_chapters" ADD CONSTRAINT "audiobook_chapters_engine_id_tts_engines_id_fk" FOREIGN KEY ("engine_id") REFERENCES "public"."tts_engines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tts_jobs" ADD CONSTRAINT "tts_jobs_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tts_jobs" ADD CONSTRAINT "tts_jobs_engine_id_tts_engines_id_fk" FOREIGN KEY ("engine_id") REFERENCES "public"."tts_engines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tts_jobs" ADD CONSTRAINT "tts_jobs_voice_profile_id_voice_profiles_id_fk" FOREIGN KEY ("voice_profile_id") REFERENCES "public"."voice_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tts_segments" ADD CONSTRAINT "tts_segments_job_id_tts_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."tts_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tts_segments" ADD CONSTRAINT "tts_segments_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tts_segments" ADD CONSTRAINT "tts_segments_audio_asset_id_assets_id_fk" FOREIGN KEY ("audio_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audiobook_build_jobs_status_idx" ON "audiobook_build_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audiobook_build_jobs_book_id_idx" ON "audiobook_build_jobs" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "audiobook_chapters_export_idx" ON "audiobook_chapters" USING btree ("audiobook_export_id");--> statement-breakpoint
CREATE INDEX "audiobook_chapters_href_idx" ON "audiobook_chapters" USING btree ("chapter_href");--> statement-breakpoint
CREATE UNIQUE INDEX "audiobook_chapters_book_chapter_idx" ON "audiobook_chapters" USING btree ("book_id","chapter_href");--> statement-breakpoint
CREATE INDEX "tts_jobs_status_idx" ON "tts_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tts_jobs_book_id_idx" ON "tts_jobs" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "tts_jobs_chapter_href_idx" ON "tts_jobs" USING btree ("chapter_href");--> statement-breakpoint
CREATE INDEX "tts_segments_job_id_idx" ON "tts_segments" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "tts_segments_segment_hash_idx" ON "tts_segments" USING btree ("segment_hash");--> statement-breakpoint
CREATE INDEX "tts_segments_book_chapter_idx" ON "tts_segments" USING btree ("book_id","chapter_href");
