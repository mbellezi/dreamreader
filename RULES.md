# DreamReader - Implementation Rules

This file must be followed by every agent or subagent that implements code in this project.

If this file conflicts with a step in any command given to the agent or with an implementation step, stop and report the conflict before implementing.

## General Principles

- The project is local-first, TypeScript-first, and contract-oriented.
- Implement one stage at a time, following `docs/04-roadmap.md`.
- Do not implement future scope within the MVP without an explicit request.
- Preserve documented ideas even when they fall outside the current stage.
- Avoid broad refactors that are not required for the current stage.
- Do not revert changes made by the user or other agents without an explicit request.
- When completing a stage, report changed files, tests run, migrations applied, and pending items.
- Consult the documents under `docs/` before implementing a product, architecture, TTS, LLM, database, voice, or M4B decision.
- When choosing between a quick implementation and one that preserves the documented contracts, preserve the contracts.

## Required Stack

- Desktop: Electron with `electron-vite`.
- Renderer: React 19.
- CSS/UI: Tailwind CSS 4 and `shadcn/ui`.
- Icons: prefer `lucide-react`.
- Local backend: Node.js in the Electron main process.
- Database: PGlite.
- ORM/migrations: Drizzle ORM.
- Contracts: Zod.
- Workers: `worker_threads`.
- Local GGUF runtime: `node-llama-cpp`, by default only in the main process. A worker controlled by the main process may be used only after a proof of concept has been validated in Electron.
- Local runtime on Apple Silicon: prefer MLX/Metal when a stable adapter exists and benchmarks are favorable; use `node-llama-cpp` with Metal as the GGUF baseline; use PyTorch MPS when MLX is unavailable; use CPU only as a fallback.
- Local TTS: always use adapters and sidecars/processes supervised by the main process. The renderer must never call Python, Swift, MLX, PyTorch, FFmpeg, or models directly.

## Architecture Boundaries

- The renderer must never directly access the database, privileged filesystem, secrets, `node-llama-cpp`, or native APIs.
- The renderer communicates with the local backend only through a secure preload and IPC validated by Zod.
- The main process centralizes access to the database, filesystem, secrets, local runtime, workers, AI sidecars, voice manager, and audiobook assembly.
- EPUB/HTML content must be treated as untrusted. Do not expose direct `file://` access, do not expose preload APIs to content iframes, and block scripts and external navigation by default.
- Reader exception: the Thorium/Readium reader requires same-origin iframes through `blob:` with `allow-scripts`, and it is not compatible with React StrictMode. Before modifying the EPUB reader, read `docs/10-thorium-reader-troubleshooting.md`. Do not re-sandbox Readium iframes to remove `allow-scripts`, and do not reintroduce `<StrictMode>` in `src/renderer/main.tsx` without reading that document.
- The renderer must consume only IPC clients/contracts. Do not import main-process services into the renderer.
- Use `NarrationPlan` as the canonical contract between normalization/prosody and TTS. Do not spread proprietary Qwen, F5, or other engine tags throughout the UI or generic services.
- Cloned voices must be represented as `VoiceProfile` plus engine/adapter bindings. A voice is available only when it has a compatible binding and confirmed consent.
- M4B is a derived artifact. Audio chapters, manifests, and metadata are the canonical source. Update M4B through an atomic rebuild from the manifest, not through in-place appends.

## Isolation, Modularity, and Testability

- Keep entry-point and orchestration files small. In the renderer, `src/renderer/App.tsx` should coordinate high-level state, data, navigation, and callbacks; it must not accumulate panes, reusable controls, DOM helpers, or pure business/UI rules.
- When adding or changing a screen, separate responsibilities by module:
  - UI components under `src/renderer/components/`;
  - internal layer types and contracts under `src/renderer/app/` when shared by the UI;
  - pure rules and helpers without React/DOM under `src/renderer/lib/`;
  - component-specific DOM helpers close to the component that uses them.
- Break down large components according to user-visible responsibilities or clear technical boundaries. For example, the library, reader, inspector, dialogs, toolbars, and shared controls should live in separate files as they grow.
- Do not mix extensive JSX with testable pure rules. Extract calculations, status decisions, initial item selection, normalization, state mapping, and DOM-independent geometry into pure functions.
- Extracted rules should receive data through parameters and return simple data whenever possible. Avoid global state, `window`, `document`, or IPC dependencies when a decision can be pure.
- When refactoring to reduce complexity, preserve publicly observable behavior and cover the extraction with regression tests proportional to the risk.
- Every relevant new pure rule must have a unit test under `tests/`. For components, prefer composition or non-GUI flow tests when behavior extends beyond static rendering.
- Before completing a modularity refactor, run at least `npm test` and `npm run lint` when applicable. For renderer changes, also run `npm run build` when the change affects imports, bundling, or file boundaries.

## i18n

- Never write product text directly in the code.
- Every user-visible string must go through i18n:
  - labels;
  - buttons;
  - menus;
  - placeholders;
  - tooltips;
  - error messages;
  - success messages;
  - job statuses;
  - commands;
  - empty states;
  - dialogs;
  - notifications.
- Default language: `pt-BR`.
- Initial languages: `en`, `pt-BR`.
- Backend messages displayed in the UI must also use i18n.
- Technical strings may remain in code when they are IDs, enums, table names, internal routes, event names, or protocol constants.

## UX and Frontend

- Build the real product experience, not landing pages.
- Use `shadcn/ui` components and Tailwind CSS 4.
- Use icons in tool buttons when appropriate.
- Use appropriate controls:
  - toggles/checkboxes for boolean values;
  - selects/menus for options;
  - tabs for views;
  - inputs/sliders/steppers for numbers;
  - tooltips for non-obvious icons.
- Do not hardcode product text inside components.
- Avoid a UI dominated by a single color family.
- Ensure text does not overlap other elements.
- Ensure stable dimensions for toolbars, lists, grids, boards, buttons, and tiles.
- Prefer dense, clear, utilitarian screens. This is a knowledge application, not a marketing page.
- Test important components in empty, loading, error, and success states.

## Database, Drizzle, and Migrations

- Every Drizzle schema change requires a new migration generated with:

```bash
npm run db:generate
```

- After generating a migration, apply it through the project's standard flow.
- Do not consider a task complete merely because `db:migrate` finished without an error.
- Explicitly verify the real database:
  - migration history in `drizzle.__drizzle_migrations`;
  - the changed structure in `information_schema` or through a direct query against the affected table;
  - indexes, constraints, types, and extensions when applicable.
- Include the performed verification steps in the final summary.
- Use repositories from the database module; do not spread ad hoc SQL throughout the UI or services.
- Keep embeddings with different dimensions separated by configuration/index.
- PGlite/Drizzle is the canonical local source for the MVP. Derived files such as audio, processed voices, and M4B remain on the filesystem with metadata stored in the database.

## Jobs and Workers

- Heavy processing must run in `worker_threads`.
- TTS/LLM inference and audio processing may run in sidecars supervised by the main process when required by the runtime or performance characteristics.
- Jobs must be persisted in the database.
- Jobs must support:
  - status;
  - progress;
  - errors;
  - cancellation when possible;
  - simple retry when appropriate.
- The UI must track jobs without blocking.
- Workers must not access the UI.
- Worker payloads must be validated with Zod when they cross boundaries.
- Heavy LLM/TTS jobs must respect the resource governor, especially on Apple Silicon. Do not run heavy inference tasks in parallel without justification and benchmarks.
- An M4B assembly failure must not invalidate already generated chapter audio.

## Tests

- Create regression tests whenever relevant.
- Prefer tests for:
  - domain logic;
  - Zod contracts;
  - repositories;
  - services;
  - workers;
  - adapters;
  - component composition;
  - flows that do not require a manual GUI.
- Use GUI-based tests only when required by the nature of the problem.
- For adapters, sidecars, and local engines, test contracts with mocks whenever possible.
- For migrations, always test real application and verification against the database.

## Security and Privacy

- Do not log secrets.
- Do not store API keys as plain text in the database.
- Validate all external payloads.
- IPC channels, sidecars, and every local interface must authenticate/authorize or restrict clients when applicable.
- Reject unsafe paths.
- Respect the active profile's local/remote privacy policies.
- Do not send content to a remote provider when the profile or task requires offline operation.
- Books, annotations, audio, cloned voices, reference samples, and M4B manifests must remain local by default.
- Do not include books, audio, voice samples, voice embeddings, or cloned voices in logs, diagnostics, or technical exports without explicit user confirmation.
- Voice cloning requires explicitly recorded consent before a voice becomes available for generation.

## Delivery for Each Stage

When completing a stage, report:

- files created or changed;
- commands run;
- tests run;
- migrations generated;
- post-migration verification performed;
- pending items.
