# Product Specification

## Vision

DreamReader is a local-first desktop ebook reader with a polished reading experience for Brazilian Portuguese and an offline pipeline for turning chapters into audio using local TTS models selected by the user.

The product must work well as a traditional reader before trying to become an AI tool. Audio generation is a natural extension of the library and reader, not a separate or overly experimental screen.

## Audience

- Readers who maintain a local library of digital books.
- People who alternate between visual reading and audio.
- Students and researchers who create highlights and notes and revisit passages.
- Brazilian users who want proper PT-BR handling in the UI, search, sorting, segmentation, and pronunciation.

## Goals

- Read EPUB with good navigation, progress tracking, table of contents, highlights, and position resumption.
- Support simple text formats from an early stage: `.txt`, `.md`, and `.html`.
- Maintain a local library with metadata, covers, collections, tags, search, and filters.
- Save progress per book, position per chapter, highlights, notes, and favorites.
- Generate chapter audio with queued local TTS models, including resumption and caching.
- Allow engine/voice selection per book or chapter.
- Create, manage, and reuse local voices through voice cloning, with explicit consent and per-engine compatibility.
- Generate one M4B audiobook per book as chapters are synthesized.
- Use a small local LLM to produce structured prosody, emotion, and pacing instructions for TTS.
- Treat Brazilian Portuguese as a first-class language.

## Current State

Phases 0, 1, 2, and 3 are implemented. The current product is a local-first desktop reader MVP with basic local audio and structured expressive prosody:

- Electron app with a secure preload, Zod-validated IPC, PGlite/Drizzle, and an internal library under `userData`.
- EPUB, TXT, Markdown, and HTML import through a native file picker.
- Extraction of basic metadata, table of contents, readable chapters, and EPUB cover when available.
- List/grid library with simple metadata search.
- Reader with continuous or paginated flow, visual preferences, table of contents, progress, position resumption, and clean mode.
- Colored highlights, notes, and favorites anchored by paragraph/offset.
- Annotation export in Markdown/JSON from the main process; the current UI exposes Markdown.
- Initial language, appearance, and reader preference settings.
- Renderer fallback with sample data when the app runs without the Electron bridge.
- Persistent per-chapter TTS queue, basic PT-BR segmentation/normalization, local WAV adapter, audio cache, chapter player, and real M4B export from ready chapters.
- Optional expressive narration with a structured local analyzer, per-segment prosody cache, Zod-validated neutral fallback, and neutral-versus-expressive audio comparison in the UI.

Still planned:

- Full-text search, advanced filters, complete tags/collections, and folder monitoring.
- Real GGUF/MLX runtime for prosody, local neural TTS, Qwen/F5 adapters, persistent voice cloning, and advanced M4B packaging with final cover/metadata.

## Initial Non-goals

- DRM, LCP, Kindle DRM, or protection removal/conversion.
- Cloud synchronization.
- Store, remote catalog, or social reading.
- Full MOBI/AZW conversion in the MVP.
- EPUB editor.
- Commercial audiobooks or public distribution of generated voices.

## Reader Features

### Library

- Import files through a picker, drag-and-drop, and optional monitored folders.
- Calculate a content hash to avoid duplicates.
- Extract metadata: title, authors, language, publisher, date, identifiers, and cover.
- Allow manual metadata correction.
- Organize by collections, tags, authors, language, status, and progress.
- Search by title, author, tags, notes, and extracted text when available.

### Reading

- Open a book from its last saved position.
- Navigate by table of contents, page/progression, previous/next chapter, and internal search.
- Adjust font, size, column width, spacing, margins, alignment, theme, and hyphenation.
- Support light, dark, sepia, and high-contrast themes.
- Save position using a persistent locator, not only a visual page index.
- Create colored highlights, notes, favorites, and tags on passages.
- Export notes and highlights as Markdown/JSON.

### Formats

- MVP: local EPUB, TXT, Markdown, and HTML.
- Beta: PDF through a separate flow with page-based viewing and limited annotation.
- Future: CBZ/CBR, OPDS, and possible format conversion through an optional tool when licensing and packaging permit.

## Brazilian Portuguese

The app must use PT-BR as the primary language of the UI and text pipeline:

- PT-BR UI from the beginning.
- Accent-tolerant sorting and search.
- Language detection and storage per book/chapter.
- Text segmentation that respects common abbreviations: “Sr.”, “Sra.”, “Dr.”, “Dra.”, “etc.”, “p.ex.”.
- TTS normalization for numbers, dates, times, currencies, percentages, ordinals, and acronyms.
- Handling of em dashes, Brazilian quotation marks, dialogue, and ellipses.
- User-editable pronunciation dictionary per book and globally.
- Preservation of proper names and foreign terms when normalization could make speech worse.

## Audio and TTS

### Planned Engines

- Qwen3-TTS 12Hz 0.6B: lighter/faster option.
- Qwen3-TTS 12Hz 1.7B: higher-quality option.
- F5-TTS-pt-br: option specialized for Brazilian Portuguese.

Each engine must be exposed through an adapter with declared capabilities. Examples include custom voice support, text instructions, discrete emotion, batching, streaming, GPU, CPU, and output format.

### Audio Flow

- The user selects a book, chapter, engine, voice/profile, and quality.
- The app breaks the chapter into stable segments.
- A local analyzer or local LLM generates structured instructions for each segment.
- The engine adapter translates those instructions into the model's accepted format.
- TTS generates files per segment and then one chapter file.
- When a chapter finishes, the app updates the book's partial M4B in the background.
- The player saves audio progress and maintains approximate alignment with the text.

### Voice Manager

- List the built-in voices of each engine.
- Create cloned voices from reference audio and a transcript.
- Validate language, minimum duration, audio quality, and engine compatibility.
- Save voices as reusable local profiles.
- Show a cloned voice in the selector only when the engine adapter can use it.
- Allow a name, description, language, preferred engine, tags, and a short preview.
- Allow deletion of a voice and all associated reference assets.
- Allow duplicating/adapting a voice for another engine when the adapter supports conversion or a new embedding.

### Voices, Consent, and Safety

When voice cloning or reference audio is used, the UI must clearly state that the user is responsible for using only authorized voices. The app must keep those files local, support simple deletion, and never upload them automatically.

The voice manager must record the consent confirmation date, reference audio origin, engine used, associated files, and local-use scope. Cloned voice profiles must not be exported with logs or diagnostics.

### M4B Audiobook

- Each book can have a partial M4B file and a final M4B file.
- The partial M4B is updated as chapters become ready.
- The file should include basic metadata: title, authors, cover, language, duration, and chapter markers.
- The app must maintain per-chapter manifests so it can rebuild the M4B if any audio, voice, engine, or chapter order changes.
- M4B updates must be atomic: generate a temporary file, validate it, and replace the previous draft.
- If a chapter is regenerated, the M4B must be marked stale and rebuilt in the background.
- The user must be able to pause/disable automatic M4B assembly per book.

## Non-functional Requirements

- Offline-first: reading, library, TTS, and LLM must work without a network after models/dependencies are installed.
- Privacy: books, highlights, voices, and generated audio remain on the device.
- Resilience: TTS jobs must be resumable after the app closes.
- Performance: import, indexing, and TTS must not block the UI.
- Security: book content and imported files must be treated as untrusted.
- Portability: the architecture must support macOS, Windows, and Linux even if the first development environment is macOS.
