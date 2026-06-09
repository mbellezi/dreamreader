CREATE TABLE "prosody_analyses" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"chapter_href" text NOT NULL,
	"segment_id" text NOT NULL,
	"segment_hash" text NOT NULL,
	"analyzer_id" text NOT NULL,
	"analyzer_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"voice_role" text,
	"prosody_json" jsonb NOT NULL,
	"raw_response_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fallback_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prosody_analyses" ADD CONSTRAINT "prosody_analyses_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prosody_analyses_segment_hash_idx" ON "prosody_analyses" USING btree ("segment_hash");--> statement-breakpoint
CREATE INDEX "prosody_analyses_book_chapter_idx" ON "prosody_analyses" USING btree ("book_id","chapter_href");--> statement-breakpoint
CREATE UNIQUE INDEX "prosody_analyses_cache_idx" ON "prosody_analyses" USING btree ("segment_hash","analyzer_id","analyzer_version","prompt_version");