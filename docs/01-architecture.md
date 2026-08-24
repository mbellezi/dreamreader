# Architecture

## Base Stack

- Desktop: Electron with `electron-vite`.
- Renderer: React 19, TypeScript, Tailwind CSS 4, `shadcn/ui`, and `lucide-react`.
- Local backend: Node.js in the Electron main process.
- Local database: PGlite.
- ORM and migrations: Drizzle ORM.
- Runtime contracts: Zod.
- Heavy work: `worker_threads` and supervised Python processes.
- Local LLM: abstract runtime, with `node-llama-cpp` plus Metal as the GGUF baseline and MLX as the preferred Apple Silicon performance target when a stable model/adapter exists.
- Local TTS: abstract runtime with per-engine adapters. On Apple Silicon, prefer MLX/Metal; use PyTorch MPS when MLX is unavailable; use CPU only as a fallback.
- Resource governor: main-process service that controls concurrency, unified memory, and accelerator usage.

## Current Implemented State

Phases 0, 1, 2, and 3 are implemented with this architecture:

- `src/main/index.ts` creates the Electron window with `sandbox`, `contextIsolation`, and `nodeIntegration: false`.
- `src/preload/index.ts` exposes `window.dreamreader` through `contextBridge` and translates typed IPC responses for the UI.
- `src/main/ipc/register.ts` registers IPC handlers and validates input payloads with Zod schemas from `src/shared/contracts/`.
- `src/main/db/client.ts` initializes persistent PGlite and applies Drizzle migrations.
- `src/main/services/library-service.ts` implements import, listing, opening, reading resources, position, annotations, bookmarks, annotation export, and settings.
- `src/main/protocol/asset-protocol.ts` serves registered assets through `dreamreader://asset/:assetId`.
- `src/renderer/App.tsx` orchestrates state and navigation; components live under `src/renderer/components/`, UI types under `src/renderer/app/`, and pure helpers under `src/renderer/lib/`.
- `src/renderer/lib/dreamreader.ts` is the client used by the renderer; when the Electron bridge is unavailable, it uses a local fallback with sample data in `localStorage`.
- `src/main/services/tts-service.ts` implements a persistent per-chapter TTS queue, basic segmentation/normalization, a local WAV adapter, and per-chapter audio caching.
- `src/main/services/prosody-service.ts` applies neutral or expressive prosody to `NarrationPlan`, validates the structured response with Zod, and persists per-segment cache entries in `prosody_analyses`.
- `src/main/services/audiobook-service.ts` persists ready chapters, partial manifests, and audiobook build jobs. Rebuild generates a real AAC M4B through `ffmpeg-static`, keeping the database manifest as the reconstructable source.
- Voice and model services still retain part of their behavior as stubs/diagnostics for future phases; real GGUF/MLX prosody runtime, neural engines, and voice cloning do not yet run external inference/processing.

## Process Boundaries

### Renderer

Responsible for:

- Library, reader, annotation, and settings UI.
- Visual state and lightweight query caching.
- Controlled rendering of book content.
- Future: audio queue/player and model diagnostic screens.

Must not:

- Directly access `fs`, PGlite, Python, `node-llama-cpp`, or models.
- Open files through `file://` without mediation.
- Execute scripts embedded in EPUB files.

### Preload

Responsible for:

- Exposing a small API through `contextBridge`.
- Validating payloads with Zod when appropriate at the process boundary.
- Converting main-process errors into typed errors for the UI.

### Main Process

Responsible for:

- IPC handlers.
- PGlite database and Drizzle migrations.
- Book import, extraction, and storage.
- Secure local protocol for book resources.
- Persistence of position, annotations, bookmarks, and settings.
- Initial/stub management of local models, TTS jobs, structured prosody, voice profiles, and M4B export.
- Future: supervision of Node workers and Python subprocesses, real neural LLM/TTS runtime execution, resource governor, complete voice cloning, and real incremental M4B audiobook assembly.

### Workers

Recommended uses:

- Text extraction and normalization.
- Search indexing.
- Chapter segmentation.
- Prompt preparation for the LLM.
- Audio post-processing and chapter assembly.

Note: `node-llama-cpp` has Electron-specific restrictions. The future integration must validate whether it can run inside a `worker_thread` controlled by the main process. If it cannot, the main process must maintain a serialized inference queue.

### Local AI Runtimes

Use local runtimes as services supervised by the main process:

- Prefer communication through stdio JSON-RPC or pipes.
- Avoid opening a local HTTP port in the MVP.
- Use one adapter per engine/runtime: Qwen3-TTS MLX, MOSS-TTS-v1.5 MLX, Qwen3-TTS PyTorch, F5-TTS-pt-br PyTorch/MPS, GGUF LLM through `node-llama-cpp`, MLX LLM, and future engines.
- Return per-segment progress, structured logs, and recoverable errors.
- Keep processes long-lived to avoid startup/model-load cost for every segment.
- Expose a health check, version, estimated memory, accelerator in use, and throughput metrics.

## Apple Silicon and Performance

See `docs/06-apple-silicon-performance.md` for the detailed policy. Architectural summary:

- Detect the chip, unified memory, macOS version, Metal availability, MLX, and MPS during initial diagnostics.
- Prefer MLX-format models for Qwen3 TTS and, if benchmarks approve, for the prosody LLM.
- Use `node-llama-cpp` with Metal for GGUF when the Electron/Node integration is simpler or more stable.
- Use PyTorch MPS for F5-TTS-pt-br while no reliable MLX adapter exists.
- Serialize heavy inference by default: one active TTS job or one active LLM job per accelerator.
- Allow concurrency only for lightweight CPU stages: extraction, segmentation, normalization, JSON validation, and manifest assembly.
- Cache prosody analysis and audio by segment to reduce recomputation.

### Resource Governor

The `ResourceGovernor` should live in the main process and decide when a job may acquire resources:

- `accelerator`: `mlx`, `metal`, `mps`, `cpu`.
- `memoryBudgetMb`: estimated budget per model and job.
- `thermalPolicy`: `quiet`, `balanced`, `maximum`.
- `exclusiveGpu`: true for large TTS/LLM models in the MVP.
- `priority`: reading/player and UI always take precedence over background jobs.

The renderer must never decide model concurrency. It only requests jobs and receives progress.

## IPC

Channels must be named by domain and validated with shared Zod schemas:

- `library.importFiles`
- `library.listBooks`
- `library.updateBookMetadata`
- `reader.openBook`
- `reader.getResource`
- `reader.saveLocator`
- `annotations.create`
- `annotations.update`
- `annotations.delete`
- `annotations.export`
- `bookmarks.create`
- `tts.enqueueChapter`
- `tts.cancelJob`
- `tts.getJob`
- `tts.listJobs`
- `voices.list`
- `voices.createFromReference`
- `voices.preview`
- `voices.update`
- `voices.delete`
- `voices.listCompatible`
- `audiobook.getExport`
- `audiobook.enableAutoBuild`
- `audiobook.rebuild`
- `audiobook.reveal`
- `models.list`
- `models.diagnostics`
- `models.installFromPath`
- `settings.get`
- `settings.update`

The renderer must import only IPC types and clients, never service implementations.

## Database and Files

Suggested structure under `app.getPath("userData")`:

```text
DreamReader/
  db/pglite/
  library/books/
  library/covers/
  library/extracted/
  audio-cache/
  audiobooks/
  voices/
  models/
  logs/
  backups/
```

Recommended pattern:

- Copy imported books into the internal library by hash.
- Keep the original path as a reference, but do not depend on it.
- Cache covers and extracted manifests.
- Store generated audio outside the database, with metadata in PGlite.
- Store partial/final M4B files outside the database, with manifests and metadata in PGlite.
- Store voice references and embeddings under `voices/`, separate from the audio cache.
- Store models outside the ASAR and outside the database.

## Voices and Voice Cloning

The app must treat a voice as a versioned local resource:

- `VoiceProfile`: user-visible identity with name, language, description, tags, and consent.
- `VoiceSample`: reference audio/transcript, quality, and origin.
- `VoiceBinding`: adapter-specific material such as an embedding, speaker ID, preset, or processed reference.

A voice may exist as a canonical profile with one or more bindings. For example, the same voice may have one binding for Qwen3-TTS Base and another for F5-TTS-pt-br if both are created/validated. The voice selector shows only profiles that have a binding compatible with the selected engine.

The voice creation process must run as a local job:

- import reference audio;
- optionally transcribe it or request a manual transcript;
- validate duration, noise, format, and language;
- confirm consent;
- generate a short preview;
- create an adapter binding;
- record metrics and failures.

## M4B Audiobook

See `docs/08-audiobook-m4b.md` for details. Architectural summary:

- Every completed chapter produces canonical chapter audio and updates the book manifest.
- An `AudiobookAssembler` observes ready chapters and generates a partial M4B in the background.
- Because M4B is an MP4 container, the default strategy is to rebuild the file from the manifest into a temporary file and atomically replace the previous draft.
- The partial file must be playable even before the full book is ready.
- When all selected chapters are complete, the draft becomes the final export or is remuxed as final.
- Changes to voice, engine, chapter order, cover, or metadata invalidate the M4B and trigger a rebuild.

## Reading Engine

Current MVP state:

- The app uses a simple custom engine in `LibraryService`: EPUB is read with `JSZip` plus `fast-xml-parser`; TXT/Markdown/HTML become an internal manifest.
- EPUB files with a spine or NCX are converted into readable chapters; NCX anchors may split sections within the same HTML file.
- The preload fetches resources through `reader.getResource` IPC and converts HTML to plain text for the current renderer.
- The renderer implements continuous and paginated reading, preferences, table of contents, locators, selection-based highlights, and position resumption.
- Readium Web/TS Toolkit and `epub.js` were not adopted in the current MVP.

Future hardening:

- Open local EPUB without exposing `file://`.
- Save and restore a locator.
- Create a highlight from selected text.
- Navigate through the table of contents.
- Apply themes and preferences.
- Isolate rich content in a sandboxed iframe when full HTML rendering is needed.
- Block scripts and external navigation inside book content.

## Content Security

Imported EPUB and HTML must be treated as untrusted content:

- Use a controlled local protocol, for example `dreamreader://book/:bookId/...`.
- Resolve resources by book ID and a whitelisted path.
- Disable publication scripts by default.
- Apply a strict CSP.
- Render content in a sandboxed iframe whenever possible.
- Block automatic external navigation; external links must request confirmation.
- Never expose preload APIs to book-content iframes.

## Local LLM

The local LLM must not “interpret” the book for the user. Its initial role is operational:

- Classify the local tone of segments.
- Suggest pacing, pauses, and intensity.
- Generate short, structured instructions for TTS.
- Respect the Zod schema and token limits.

Initial candidate models:

- Baseline: a small multilingual GGUF model, such as a quantized Qwen3 0.6B/1.7B Instruct, running through `node-llama-cpp` with Metal.
- Apple Silicon performance path: an equivalent MLX model running in a Python/Swift sidecar when benchmarks show a real gain.

The LLM output must be validated and normalized. If it fails, use neutral prosody.

Current state:

- Phase 3 implements the contract with the structured local analyzer `llm-prosody-local`, persistent cache, and neutral fallback.
- Integration with a GGUF model through `node-llama-cpp` or MLX remains planned for the runtime/models stage.

## Packaging

Points requiring attention:

- `node-llama-cpp` must not be bundled by Vite.
- Native binaries must retain their file structure.
- Models must remain outside the ASAR.
- Audio metadata must be read through a Node library (`music-metadata`) without depending on `ffprobe` in `PATH`.
- Audio conversion/resampling uses `ffmpeg-static`; when generating Electron bundles, package this binary outside the ASAR (`asarUnpack: node_modules/ffmpeg-static/**`) so the main process can execute it.
- Before public/commercial distribution, review the licensing impact of the `ffmpeg-static` binary (`GPL-3.0-or-later`) or replace it with a build/license compatible with the distribution.
- Python/PyTorch/TTS/MLX will probably require platform-specific packaging.
- MLX and MLX models must be installed under `userData/models` or a user-selected folder, never inside the ASAR.
- The MVP may require manual model installation, with a simple local manager pointing to folders that are already downloaded.

## Local Observability

- Structured logs by domain: `library`, `reader`, `tts`, `llm`, `db`, `ipc`.
- Simple in-app diagnostics screen.
- Diagnostic package export that excludes books, audio, and voices by default.
