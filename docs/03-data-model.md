# Modelo de Dados

Este documento descreve o schema Drizzle/PGlite e tambem registra entidades planejadas para fases futuras.

## Estado Atual do Schema

As migrations atuais (`drizzle/0000_*.sql` ate `drizzle/0004_*.sql`) implementam estas tabelas:

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

Essas tabelas cobrem as fases 0, 1, 2, 3 e 4: biblioteca local, assets de capa, posicao de leitura, anotacoes, bookmarks, settings, fila TTS persistente, cache de audio por capitulo, cache de prosodia por segmento, manifestos parciais de audiobook, catalogo de modelos, manifests de runtime, perfis de voz persistentes, samples, bindings e dicionario de pronuncia.

Ainda nao existem no schema atual:

- `voice_clone_jobs`

`voice_clone_jobs` permanece planejada para empacotamento/polimento de sidecars quando a criacao de embeddings deixar de ser sincrona por adapter.

## Entidades

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

Notas:

- `content_hash` deve ser unico quando possivel.
- `manifest_json` armazena metadados extraidos do motor de leitura, sem substituir campos normalizados.

### `reading_positions`

- `id`
- `book_id`
- `locator_json`
- `chapter_href`
- `progression`
- `audio_position_ms`
- `updated_at`

Notas:

- `locator_json` deve ser o dado canonico para retomada de leitura.
- `progression` e auxiliar para UI e ordenacao.

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

Notas:

- Usar soft delete ajuda a evitar perda acidental e facilita exportacao.

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

Usos:

- capas
- arquivos extraidos
- audio por segmento
- audio por capitulo
- amostras de voz autorizadas
- previews de voz
- exports M4B parciais/finais

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

Notas:

- `adapter_id` identifica o contrato de software, por exemplo `qwen3-tts-mlx`, `qwen3-tts-pytorch` ou `f5-tts-pt-br`.
- `runtime`: `mlx`, `metal`, `mps`, `pytorch`, `cpu` ou `external`.
- `accelerator`: `apple_metal`, `apple_mps`, `cpu` ou futuro valor por plataforma.
- `performance_profile_json` guarda metricas observadas localmente: cold start, memoria de pico, RTF, segmentos/minuto e data do benchmark.

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

Notas:

- `kind`: `built_in`, `cloned`, `imported`, `generated`.
- `source`: texto livre/estruturado sobre origem local do audio, sem upload.
- Vozes visiveis para o usuario vivem aqui, mas compatibilidade por motor fica em `voice_engine_bindings`.

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

Usos:

- Audios de referencia usados em voice cloning.
- Transcricoes manuais ou revisadas.
- Metricas de qualidade: ruido, clipping, sample rate, canal, idioma detectado.

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

Notas:

- `binding_kind`: `reference_audio`, `speaker_embedding`, `preset`, `voice_design_prompt`.
- Uma voz so aparece como disponivel para um motor quando existe binding `ready` para aquele adapter/engine.
- Recriar binding para outro motor nao altera o perfil canonico da voz.

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

Notas:

- A chave de cache usa `segment_hash`, `analyzer_id`, `analyzer_version` e `prompt_version`.
- `prosody_json` armazena a prosodia canonica validada por Zod antes de chegar ao TTS.
- Linhas com fallback tambem sao persistidas, para evitar repetir analises que ja falharam de forma recuperavel.
- `raw_response_json` guarda a resposta estruturada local sem incluir texto completo do livro quando isso puder ser evitado.

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

Notas:

- `format` inicialmente `m4b`.
- `draft_asset_id` aponta para M4B parcial.
- `asset_id` aponta para M4B final, quando todos os capitulos escolhidos estiverem prontos.
- `manifest_json` guarda ordem dos capitulos, assets de audio, duracoes, hashes, voz, engine e metadados.

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

Notas:

- Esta tabela permite reconstruir o M4B sem depender de varrer arquivos.
- Se um capitulo for regerado, `audio_hash` muda e o export fica `stale`.

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

Notas:

- `reason`: `chapter_completed`, `chapter_regenerated`, `metadata_changed`, `manual_rebuild`.
- Falha aqui nao altera o status dos capitulos de audio.

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

Notas:

- `scope`: `global` ou `book`.
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

Usos:

- LLM GGUF.
- Pesos Qwen3-TTS.
- Pesos F5-TTS-pt-br.
- Tokenizers e vocoders.

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

Usos:

- Persistir downloads iniciados pelo main process.
- Expor progresso visual no renderer sem acesso direto ao filesystem.
- Registrar falhas recuperaveis de download de modelos.

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

Usos:

- Registrar sidecars Python MLX/PyTorch.
- Registrar binarios Swift/MLX futuros.
- Registrar runtime GGUF via `node-llama-cpp`.
- Permitir troca de runtime sem mudar jobs, UI ou schema de prosodia.

## Indices

Indices implementados nas migrations atuais:

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

Indices planejados para fases futuras:

- `annotations.tags`
- `voice_engine_bindings.voice_profile_id`
- `voice_engine_bindings.engine_id`
- `voice_engine_bindings.status`
- `voice_clone_jobs.status`
- `model_assets.kind`
- `model_assets.runtime`

## Politica de Migracoes

- Toda alteracao de schema passa por Drizzle migration.
- Dados derivados, como texto extraido e audio, devem ser reconstruiveis.
- Dados do usuario, como notas, marcacoes, colecoes, vozes e dicionario de pronuncia, exigem migracoes conservadoras e backup antes de mudancas grandes.
