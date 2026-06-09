CREATE TABLE "pronunciation_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text DEFAULT 'global' NOT NULL,
	"book_id" text,
	"pattern" text NOT NULL,
	"replacement" text NOT NULL,
	"match_kind" text DEFAULT 'word' NOT NULL,
	"case_sensitive" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_engine_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"voice_profile_id" text NOT NULL,
	"engine_id" text NOT NULL,
	"adapter_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"binding_kind" text NOT NULL,
	"binding_asset_id" text,
	"settings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"compatibility_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_samples" (
	"id" text PRIMARY KEY NOT NULL,
	"voice_profile_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"transcript" text,
	"language" text,
	"duration_ms" integer NOT NULL,
	"quality_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"consent_confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pronunciation_entries" ADD CONSTRAINT "pronunciation_entries_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_engine_bindings" ADD CONSTRAINT "voice_engine_bindings_voice_profile_id_voice_profiles_id_fk" FOREIGN KEY ("voice_profile_id") REFERENCES "public"."voice_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_engine_bindings" ADD CONSTRAINT "voice_engine_bindings_engine_id_tts_engines_id_fk" FOREIGN KEY ("engine_id") REFERENCES "public"."tts_engines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_engine_bindings" ADD CONSTRAINT "voice_engine_bindings_binding_asset_id_assets_id_fk" FOREIGN KEY ("binding_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_samples" ADD CONSTRAINT "voice_samples_voice_profile_id_voice_profiles_id_fk" FOREIGN KEY ("voice_profile_id") REFERENCES "public"."voice_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_samples" ADD CONSTRAINT "voice_samples_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pronunciation_entries_scope_idx" ON "pronunciation_entries" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "pronunciation_entries_book_id_idx" ON "pronunciation_entries" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "voice_engine_bindings_profile_id_idx" ON "voice_engine_bindings" USING btree ("voice_profile_id");--> statement-breakpoint
CREATE INDEX "voice_engine_bindings_engine_id_idx" ON "voice_engine_bindings" USING btree ("engine_id");--> statement-breakpoint
CREATE INDEX "voice_engine_bindings_status_idx" ON "voice_engine_bindings" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_engine_bindings_voice_engine_idx" ON "voice_engine_bindings" USING btree ("voice_profile_id","engine_id");--> statement-breakpoint
CREATE INDEX "voice_samples_profile_id_idx" ON "voice_samples" USING btree ("voice_profile_id");--> statement-breakpoint
CREATE INDEX "voice_samples_asset_id_idx" ON "voice_samples" USING btree ("asset_id");