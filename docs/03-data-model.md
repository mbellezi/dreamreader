# Data Model

This document describes the Drizzle/PGlite schema and also records entities planned for future phases.

## Current Schema State

The current migrations (`drizzle/0000_*.sql` through `drizzle/0004_*.sql`) implement these tables:

- `books`
- `assets`
- `reading_positions`
- `annotations`
- `bookmarks`
- `collections`
- `collection_books`
- `settings`
- `tts_engines`
- `tts_jobs`
- `tts_segments`
- `prosody_analyses`
- `voice_profiles`
- `voice_samples`
- `voice_engine_bindings`
- `audiobook_exports`
- `audiobook_chapters`
- `audiobook_build_jobs`
- `pronunciation_entries`
- `model_assets`
- `model_download_jobs`
- `runtime_manifests`

These tables cover Phases 0, 1, 2, 3, and 4: local library, cover assets, reading position, annotations, bookmarks, settings, persistent TTS queue, per-chapter audio cache, per-segment prosody cache, partial audiobook manifests, model catalog, runtime manifests, persistent voice profiles, samples, bindings, and pronunciation dictionary.

The current schema does not yet contain:

- `voice_clone_jobs`

`voice_clone_jobs` remains planned for sidecar packaging/polish when embedding creation is no longer synchronous per adapter.

## Entities

### `books`

- `id`
- `content_hash`
- `file_type`
- `title`
- `subtitle`
- `authors`
- `language`
- `publisher`
- `published_at`
- `description`
- `original_path`
- `library_path`
- `cover_asset_id`
- `manifest_json`
- `added_at`
- `updated_at`
- `last_opened_at`

Notes:

- `content_hash` should be unique whenever possible.
- `manifest_json` stores metadata extracted by the reading engine without replacing normalized fields.

### `reading_positions`

- `id`
- `book_id`
- `locator_json`
- `chapter_href`
- `progression`
- `audio_position_ms`
- `updated_at`

Notes:

- `locator_json` must be the canonical data for reading resumption.
- `progression` is auxiliary data for the UI and sorting.

### `annotations`

- `id`
- `book_id`
- `locator_json`
- `quote`
- `color`
- `note`
- `tags`
- `created_at`
- `updated_at`
- `deleted_at`

Notes:

- Soft deletion helps prevent accidental loss and simplifies export.

### `bookmarks`

- `id`
- `book_id`
- `locator_json`
- `label`
- `created_at`

### `collections`

- `id`
- `name`
- `description`
- `created_at`
- `updated_at`

### `collection_books`

- `collection_id`
- `book_id`
- `position`
- `created_at`

### `assets`

- `id`
- `kind`
- `book_id`
- `path`
- `mime_type`
- `content_hash`
- `size_bytes`
- `created_at`

Uses:

- covers
- extracted files
- per-segment audio
- per-chapter audio
- authorized voice samples
- voice previews
- partial/final M4B exports

### `tts_engines`

- `id`
- `display_name`
- `version`
- `adapter_id`
- `runtime`
- `model_format`
- `accelerator`
- `capabilities_json`
- `performance_profile_json`
- `installed`
- `install_path`
- `created_at`
- `updated_at`

Notes:

- `adapter_id` identifies the software contract, for example `qwen3-tts-mlx`, `qwen3-tts-pytorch`, or `f5-tts-pt-br`.
- `runtime`: `mlx`, `metal`, `mps`, `pytorch`, `cpu`, or `external`.
- `accelerator`: `apple_metal`, `apple_mps`, `cpu`, or a future platform-specific value.
- `performance_profile_json` stores locally observed metrics: cold start, peak memory, RTF, segments/minute, and benchmark date.

### `voice_profiles`

- `id`
- `name`
- `description`
- `language`
- `kind`
- `source`
- `tags`
- `settings_json`
- `consent_confirmed_at`
- `consent_note`
- `preview_asset_id`
- `created_from_engine_id`
- `created_at`
- `updated_at`

Notes:

- `kind`: `built_in`, `cloned`, `imported`, `generated`.
- `source`: free-form/structured text describing the local audio origin, without upload.
- User-visible voices live here, but per-engine compatibility lives in `voice_engine_bindings`.

### `voice_samples`

- `id`
- `voice_profile_id`
- `asset_id`
- `transcript`
- `language`
- `duration_ms`
- `quality_json`
- `consent_confirmed_at`
- `created_at`

Uses:

- Reference audio used in voice cloning.
- Manual or reviewed transcripts.
- Quality metrics: noise, clipping, sample rate, channel, and detected language.

### `voice_engine_bindings`

- `id`
- `voice_profile_id`
- `engine_id`
- `adapter_id`
- `status`
- `binding_kind`
- `binding_asset_id`
- `settings_json`
- `compatibility_json`
- `created_at`
- `updated_at`

Notes:

- `binding_kind`: `reference_audio`, `speaker_embedding`, `preset`, `voice_design_prompt`.
- A voice appears as available for an engine only when a `ready` binding exists for that adapter/engine.
- Recreating a binding for another engine does not change the canonical voice profile.

### `voice_clone_jobs`

- `id`
- `voice_profile_id`
- `engine_id`
- `status`
- `progress`
- `settings_json`
- `error_code`
- `error_message`
- `created_at`
- `started_at`
- `finished_at`
- `updated_at`

### `tts_jobs`

- `id`
- `book_id`
- `chapter_href`
- `engine_id`
- `voice_profile_id`
- `voice_binding_id`
- `status`
- `progress`
- `settings_json`
- `narration_plan_version`
- `resource_policy_json`
- `error_code`
- `error_message`
- `created_at`
- `started_at`
- `finished_at`
- `updated_at`

### `tts_segments`

- `id`
- `job_id`
- `book_id`
- `chapter_href`
- `segment_index`
- `segment_hash`
- `locator_json`
- `original_text`
- `normalized_text`
- `prosody_json`
- `adapter_payload_json`
- `audio_asset_id`
- `duration_ms`
- `status`
- `error_message`
- `created_at`
- `updated_at`

### `prosody_analyses`

- `id`
- `book_id`
- `chapter_href`
- `segment_id`
- `segment_hash`
- `analyzer_id`
- `analyzer_version`
- `prompt_version`
- `status`
- `voice_role`
- `prosody_json`
- `raw_response_json`
- `fallback_reason`
- `created_at`
- `updated_at`

Notes:

- The cache key uses `segment_hash`, `analyzer_id`, `analyzer_version`, and `prompt_version`.
- `prosody_json` stores canonical prosody validated by Zod before it reaches TTS.
- Fallback rows are also persisted to avoid repeating analyses that have already failed in a recoverable way.
- `raw_response_json` stores the structured local response without including full book text whenever that can be avoided.

### `audiobook_exports`

- `id`
- `book_id`
- `status`
- `auto_build_enabled`
- `format`
- `asset_id`
- `draft_asset_id`
- `manifest_json`
- `metadata_json`
- `chapters_ready`
- `chapters_total`
- `duration_ms`
- `stale`
- `error_code`
- `error_message`
- `created_at`
- `updated_at`
- `last_built_at`

Notes:

- `format` is initially `m4b`.
- `draft_asset_id` points to the partial M4B.
- `asset_id` points to the final M4B when all selected chapters are ready.
- `manifest_json` stores chapter order, audio assets, durations, hashes, voice, engine, and metadata.

### `audiobook_chapters`

- `id`
- `audiobook_export_id`
- `book_id`
- `chapter_href`
- `chapter_index`
- `title`
- `audio_asset_id`
- `voice_profile_id`
- `voice_binding_id`
- `engine_id`
- `duration_ms`
- `start_ms`
- `end_ms`
- `content_hash`
- `audio_hash`
- `status`
- `created_at`
- `updated_at`

Notes:

- This table allows the M4B to be rebuilt without scanning files.
- If a chapter is regenerated, `audio_hash` changes and the export becomes `stale`.

### `audiobook_build_jobs`

- `id`
- `audiobook_export_id`
- `book_id`
- `status`
- `progress`
- `reason`
- `temp_asset_id`
- `result_asset_id`
- `error_code`
- `error_message`
- `created_at`
- `started_at`
- `finished_at`
- `updated_at`

Notes:

- `reason`: `chapter_completed`, `chapter_regenerated`, `metadata_changed`, `manual_rebuild`.
- A failure here does not change the status of audio chapters.

### `pronunciation_entries`

- `id`
- `scope`
- `book_id`
- `pattern`
- `replacement`
- `match_kind`
- `case_sensitive`
- `created_at`
- `updated_at`

Notes:

- `scope`: `global` or `book`.
- `match_kind`: `literal`, `word`, `regex`.

### `settings`

- `key`
- `value_json`
- `updated_at`

### `model_assets`

- `id`
- `kind`
- `name`
- `provider`
- `version`
- `path`
- `size_bytes`
- `checksum`
- `license`
- `runtime`
- `format`
- `accelerator_preference`
- `memory_estimate_mb`
- `checksum_algorithm`
- `source_url`
- `install_status`
- `download_progress`
- `metadata_json`
- `installed_at`
- `created_at`
- `updated_at`

Uses:

- GGUF LLM.
- Qwen3-TTS weights.
- F5-TTS-pt-br weights.
- Tokenizers and vocoders.

### `model_download_jobs`

- `id`
- `model_asset_id`
- `status`
- `progress`
- `received_bytes`
- `total_bytes`
- `source_url`
- `target_path`
- `error_code`
- `error_message`
- `created_at`
- `started_at`
- `finished_at`
- `updated_at`

Uses:

- Persist downloads started by the main process.
- Expose visual progress in the renderer without direct filesystem access.
- Record recoverable model-download failures.

### `runtime_manifests`

- `id`
- `adapter_id`
- `runtime`
- `version`
- `executable_path`
- `environment_json`
- `healthcheck_command`
- `capabilities_json`
- `created_at`
- `updated_at`

Uses:

- Register MLX/PyTorch Python sidecars.
- Register future Swift/MLX binaries.
- Register the GGUF runtime through `node-llama-cpp`.
- Allow runtime replacement without changing jobs, UI, or the prosody schema.

## Indexes

Indexes implemented in the current migrations:

- `books.content_hash`
- `books.title`
- `books.language`
- `annotations.book_id`
- `reading_positions.book_id`
- `tts_engines.adapter_id`
- `tts_engines.runtime`
- `voice_profiles.language`
- `voice_profiles.kind`
- `audiobook_exports.book_id`
- `audiobook_exports.status`
- `assets.content_hash`
- `assets.book_id`
- `tts_jobs.status`
- `tts_jobs.book_id`
- `tts_jobs.chapter_href`
- `tts_segments.job_id`
- `tts_segments.segment_hash`
- `tts_segments.book_id + chapter_href`
- `prosody_analyses.segment_hash`
- `prosody_analyses.book_id + chapter_href`
- `prosody_analyses.segment_hash + analyzer_id + analyzer_version + prompt_version`
- `audiobook_build_jobs.status`
- `audiobook_build_jobs.book_id`
- `audiobook_chapters.audiobook_export_id`
- `audiobook_chapters.chapter_href`
- `audiobook_chapters.book_id + chapter_href`

Indexes planned for future phases:

- `annotations.tags`
- `voice_engine_bindings.voice_profile_id`
- `voice_engine_bindings.engine_id`
- `voice_engine_bindings.status`
- `voice_clone_jobs.status`
- `model_assets.kind`
- `model_assets.runtime`

## Migration Policy

- Every schema change goes through a Drizzle migration.
- Derived data, such as extracted text and audio, must be reconstructable.
- User data, such as notes, highlights, collections, voices, and the pronunciation dictionary, requires conservative migrations and backups before large changes.
