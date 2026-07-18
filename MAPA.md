# DreamReader — Project Map

This map guides agents and subagents to the right context before changing the project.

## Documentation

- `README.md`: product overview, stack, and main commands.
- `docs/00-product-spec.md`: product specification.
- `docs/01-architecture.md`: Electron, renderer, main process, worker, and sidecar architecture.
- `docs/02-ai-tts-pipeline.md`: planned AI/TTS pipeline, normalization, prosody, and audio cache.
- `docs/03-data-model.md`: local data model, PGlite, and Drizzle.
- `docs/04-roadmap.md`: implementation phases.
- `docs/05-research-notes.md`: research notes and initial technical verification.
- `docs/06-apple-silicon-performance.md`: local LLM/TTS strategy for Apple Silicon.
- `docs/07-tts-prosody-abstractions.md`: prosody, TTS, and local-model contracts.
- `docs/08-audiobook-m4b.md`: incremental M4B assembly.
- `docs/09-readium-poc.md`: Readium Web POC (CLI, manifest, and ts-toolkit).
- `docs/10-thorium-reader-troubleshooting.md`: Thorium/Readium reader pitfalls (same-origin iframe + allow-scripts, StrictMode, and fragile dev PGlite).
- `docs/11-build-bundles.md`: cross-platform bundle build instructions.

## Code

- `src/shared/contracts/`: canonical shared Zod contracts.
- `src/main/`: Electron main process, database, IPC, and local services.
- `src/preload/`: secure bridge between renderer and main process.
- `src/renderer/App.tsx`: high-level UI orchestration.
- `src/renderer/components/`: modular panes, controls, and React components.
- `src/renderer/app/`: shared internal UI types.
- `src/renderer/lib/`: preload client, pure helpers, pagination, annotations, and fallback renderer.
- `src/main/db/schema.ts`: canonical Drizzle schema.
- `drizzle/`: generated migrations.
- `tests/`: contract and regression tests.

## Working Rules

- Read `RULES.md` and `GUIDELINES_GTP.md` before editing.
- Preserve the contracts in `src/shared/contracts/` as the source of truth.
- The renderer never accesses the database, privileged filesystem, models, or sidecars directly.
- Future phases must follow `docs/04-roadmap.md`; do not anticipate heavy scope without an explicit request.
