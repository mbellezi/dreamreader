# Roadmap

This roadmap describes the current repository state and planned scope. Phases 0, 1, 2, 3, and 4 are implemented in the current codebase; the remaining phases are still planned.

## Phase 0: Technical Foundation — Implemented

Goal: reduce architectural risk before building product features.

Implemented:

- Electron scaffold with `electron-vite`, React 19, TypeScript, Tailwind CSS 4, and `lucide-react`.
- Electron window with `sandbox`, `contextIsolation`, and `nodeIntegration: false`.
- Secure preload through `contextBridge`, exposing the `window.dreamreader` API.
- IPC registered in the main process with requests validated by shared Zod schemas.
- Zod contracts in `src/shared/contracts/` for the library, reader, annotations, settings, TTS, voices, models, and audiobook features.
- Persistent PGlite database at `app.getPath("userData")/db/pglite`.
- Drizzle ORM with the initial migration at `drizzle/0000_fearless_swordsman.sql`.
- Local file structure in `userData`: library, covers, extracted content, audio cache, audiobooks, voices, models, logs, and backups.
- Local `dreamreader://asset/:assetId` protocol for serving registered assets without exposing `file://`.
- Main-process services for the library, runtimes/models, TTS, voices, and audiobooks.
- Contract tests, preload locator tests, EPUB import tests, pagination tests, annotation tests, and renderer state-helper tests.

Prepared scope, but not yet executed at this stage:

- `NarrationPlan` contracts, TTS adapters, voice cloning, TTS jobs, runtime diagnostics, and M4B.
- TTS, voice, model, and audiobook stubs for validating future IPC and UI boundaries.
- Real neural TTS inference, voice processing, and M4B assembly were reserved for phases 4 and 5.

## Phase 1: Reader MVP — Implemented

Implemented:

- Local library with EPUB, TXT, Markdown, and HTML import.
- Copy of imported books into the internal library by content hash.
- Duplicate detection by `content_hash`.
- Basic EPUB metadata extraction: title, authors, language, table of contents, and cover when available.
- Support for EPUBs with NCX/anchors, including splitting chapters contained in the same HTML file.
- Book list/grid with simple search.
- Reading screen with table of contents, previous/next chapter, and return to the previous position.
- Reader preferences: theme, font, size, column width, column count, line height, spacing, margins, continuous/paginated flow, alignment, and hyphenation.
- Paginated reading mode with tested geometry and page anchoring across reflow.
- Position restoration through a persistent locator and 0..1 progress.
- Color highlights, notes, and favorites based on text selection.
- Paragraph/offset-based highlight resolution to avoid highlighting the wrong repeated occurrence.
- Basic annotation export as Markdown or JSON from the main process; the UI exposes Markdown.
- Initial language, appearance, and reader-preference settings.
- Fallback renderer with sample data in `localStorage` when the Electron bridge is unavailable.
- Modular renderer: `App.tsx` handles high-level orchestration; panes, controls, DOM helpers, and pure rules live in dedicated files.
- Initial `pt-BR` and `en` i18n support.

Known reader MVP limits:

- Current search covers library metadata; full-text search is planned for beta.
- Collections/tags exist in the planned model but do not have a complete MVP UI.
- The reader uses its own HTML/text extraction and rendering; Readium/epub.js were not adopted in the current MVP.
- EPUB/HTML content is converted to text in the current renderer; iframe isolation/sandboxing for rich content remains future hardening work.

## Phase 2: Basic Local Audio — Implemented

Implemented:

- Persistent TTS jobs in `tts_jobs`.
- Persistent TTS segments in `tts_segments`.
- Serial chapter job queue, resuming interrupted jobs when the app opens.
- Initial `dreamreader-local-wav` adapter using the canonical `NarrationPlan`.
- Block/sentence segmentation and basic PT-BR normalization: abbreviations, dates, times, currency, and percentages.
- Chapter audio player in the inspector audio tab.
- Per-chapter audio cache in `audio-cache/`, with metadata in `assets` and `audiobook_chapters`.
- Cancellation, retry, and cache reuse for repeated jobs.
- Model/runtime diagnostics showing the available local adapter and unconfigured future engines.
- Long-lived local adapter lifecycle with warmup and unload timeout.
- Partial audiobook manifest per book in `audiobook_exports` and `audiobook_chapters`; rebuild creates a real AAC M4B with `ffmpeg-static`.

Known Phase 2 limits:

- The current adapter generates deterministic local WAV to validate queue/cache/player behavior; it is not a neural Qwen/F5 engine and does not synthesize natural speech.
- M4B export uses a real AAC/M4B encoder through `ffmpeg-static`; advanced packaging, covers, and fine tuning remain future work.

## Phase 3: LLM Prosody — Implemented

Implemented:

- `ProsodyService` in the main process for applying neutral or expressive prosody to a `NarrationPlan`.
- Structured local analyzer `llm-prosody-local`, Zod-validated, generating emotion, pace, pitch, intensity, pauses, and voice-role instructions per segment.
- Persistent analysis cache in `prosody_analyses`, keyed by segment hash, analyzer, version, and prompt/schema.
- Neutral per-segment fallback when analysis fails, returns invalid JSON, or does not cover every segment.
- UI toggle for expressive narration in the audio panel.
- Comparison between neutral and expressive audio when both exist for a chapter.
- Job metadata with prosody mode, cache hits, generated analyses, and fallbacks.
- Local WAV adapter that uses the plan's prosody to produce a deterministic audible difference between neutral and expressive modes.

Known Phase 3 limits:

- The deterministic analyzer remains available as a fallback when the real runtime is not installed.
- Expressive quality is still conservative and is intended to validate flow, persistence, and UI comparison.

## Phase 4: Multi-engine TTS and Voices — Implemented

- Persistent model catalog in `model_assets`.
- Persistent download jobs in `model_download_jobs`, with progress saved and shown in the audio panel.
- Local model UI with visual states `queued`, `downloading`, `available`, and `failed`.
- Direct download of the recommended `Qwen3-4B-Instruct-2507 GGUF Q4_K_M` for prosody.
- Real GGUF prosody provider through `node-llama-cpp`, enabled when the local file and optional runtime are available.
- Automatic fallback to the structured local analyzer when Qwen GGUF or `node-llama-cpp` is not installed.
- Registration of `qwen3-tts-06b-mlx`, `qwen3-tts-17b-mlx`, `qwen3-tts-17b-base-mlx`, `chatterbox-multilingual-mlx`, and `f5-tts-pt-br` in `tts_engines`.
- Runtime manifest registration in `runtime_manifests` for future Python/Swift/MLX/PyTorch sidecars.
- Sidecar adapters `qwen3-tts-mlx`, `chatterbox-mlx`, and `f5-tts-pt-br` using a protocol supervised by the main process.
- Neural synthesis enabled when the TTS model is installed and `runtime_manifest` points to a compatible local executable.
- Standalone local Python runtime in `.dreamreader-local/`, ignored by git, for Qwen3-TTS/Chatterbox/F5-TTS-pt-br sidecars and local model weights.
- Validation that sidecar output paths stay inside the job directory before importing assets.
- Per-chapter engine, voice, quality, and expressive-narration selectors in the audio panel.
- Persistent voice profiles, authorized samples, and per-engine bindings in `voice_profiles`, `voice_samples`, and `voice_engine_bindings`.
- Qwen3-TTS Base (`0.6B` and `1.7B Base`) requires a cloned voice with reference audio and a transcript; prompt presets are restricted to `1.7B VoiceDesign`.
- Chatterbox Multilingual MLX supports Portuguese through `lang_code=pt`, a default voice or optional reference cloning, and parametric prosody through `exaggeration`/`cfgWeight`.
- Local cloned-voice manager in the main process, with mandatory consent, sample copy into `voices/`, compatible binding, and local WAV preview.
- Global and per-book pronunciation dictionary in `pronunciation_entries`, applied to the `NarrationPlan` and versioned in the cache key.
- Per-chapter audio/cache deletion, removing jobs, segments, audio assets, and the audiobook entry.
- M4B manifest rebuild/invalidation when chapter audio is regenerated, removed, or changes voice/engine/prosody/dictionary.
- M4B rebuild failure does not invalidate already generated chapter audio.

Known Phase 4 limits:

- Qwen3-TTS/Chatterbox/F5-TTS sidecars are configurable local executables; the repository does not package Python/MLX/PyTorch or model weights.
- Multi-file TTS snapshot downloads remain a local-folder installation process.
- M4B export creates a real `.m4b` from ready chapters; covers, quality tuning, and advanced packaging remain pending.

## Phase 5: Alpha Packaging

- macOS installer first, followed by Windows/Linux.
- Strategy for Python and native dependencies.
- Local folder-based model manager.
- Logs and diagnostic package.
- Library backup/export without copying books, with books as an optional choice.
- Regression tests for import, position, annotations, and TTS.

## Phase 6: Beta

- Full-text search.
- PDF as a separate workflow.
- Accessibility improvements.
- Optional folder monitoring.
- Import/export of annotations in external formats.
- UI and performance polish.
