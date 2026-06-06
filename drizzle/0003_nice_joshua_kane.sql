CREATE TABLE "model_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"version" text NOT NULL,
	"path" text,
	"size_bytes" bigint,
	"checksum" text,
	"license" text DEFAULT 'unknown' NOT NULL,
	"runtime" text NOT NULL,
	"format" text NOT NULL,
	"accelerator_preference" text DEFAULT 'cpu' NOT NULL,
	"memory_estimate_mb" integer,
	"checksum_algorithm" text,
	"source_url" text,
	"install_status" text DEFAULT 'not_configured' NOT NULL,
	"download_progress" real DEFAULT 0 NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"installed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_download_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"model_asset_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"received_bytes" bigint DEFAULT 0 NOT NULL,
	"total_bytes" bigint,
	"source_url" text NOT NULL,
	"target_path" text NOT NULL,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtime_manifests" (
	"id" text PRIMARY KEY NOT NULL,
	"adapter_id" text NOT NULL,
	"runtime" text NOT NULL,
	"version" text NOT NULL,
	"executable_path" text,
	"environment_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"healthcheck_command" text,
	"capabilities_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_download_jobs" ADD CONSTRAINT "model_download_jobs_model_asset_id_model_assets_id_fk" FOREIGN KEY ("model_asset_id") REFERENCES "public"."model_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_assets_kind_idx" ON "model_assets" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "model_assets_runtime_idx" ON "model_assets" USING btree ("runtime");--> statement-breakpoint
CREATE INDEX "model_assets_status_idx" ON "model_assets" USING btree ("install_status");--> statement-breakpoint
CREATE INDEX "model_download_jobs_model_idx" ON "model_download_jobs" USING btree ("model_asset_id");--> statement-breakpoint
CREATE INDEX "model_download_jobs_status_idx" ON "model_download_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "runtime_manifests_adapter_id_idx" ON "runtime_manifests" USING btree ("adapter_id");--> statement-breakpoint
CREATE INDEX "runtime_manifests_runtime_idx" ON "runtime_manifests" USING btree ("runtime");