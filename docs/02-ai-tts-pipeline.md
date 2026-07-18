# AI and TTS Pipeline

## Principles

- Audio generation must be a resumable queue, not a blocking action.
- The original book text must be preserved; TTS normalizations are versioned separately.
- Emotion/prosody instructions must be structured, small, and auditable.
- Every TTS engine declares its capabilities, and the pipeline adapts to them.
- For PT-BR, text normalization quality is as important as the model.
- The UI and pipeline must not know model-specific proprietary tags. They produce a canonical plan; adapters translate that plan for Qwen, F5, or another engine.
- On Apple Silicon, generation must use long-lived processes and warmed-up models, preferring MLX/Metal when available.

## Stages

### 1. Extraction

Input:

- `bookId`
- `chapterHref` or an equivalent identifier
- raw text extracted by the reading engine
- language metadata

Output:

- paragraphs and blocks with stable IDs
- clean text that remains close to the original
- mapping between original text, normalized text, and locator

### 2. Segmentation

Goal: create segments that work well for both TTS and resumption.

Initial rules:

- Prefer paragraph and sentence boundaries.
- Avoid segments that are too long.
- Do not split common PT-BR abbreviations.
- Preserve dialogue introduced by em dashes.
- Assign a deterministic `segmentId` based on book, chapter, index, and text hash.

### 3. PT-BR Normalization

Candidate transformations:

- Numbers: `1984` may become “one thousand nine hundred eighty-four” or remain a title, depending on context.
- Dates: `06/06/2026` becomes “sixth of June, two thousand twenty-six” in the target spoken language.
- Times: `14h30` becomes “fourteen hours and thirty minutes.”
- Currencies: `R$ 25,90` becomes “twenty-five reais and ninety centavos.”
- Percentages: `12%` becomes “twelve percent.”
- Ordinals: `1o`, `1º`, `primeiro`.
- Acronyms: preserve, spell, or expand through the dictionary.
- Abbreviations: `Sr.` to “senhor,” `Dra.` to “doutora,” when appropriate.

Rules must be configurable and versioned. Normalization changes invalidate only the affected audio cache.

### 4. LLM Prosody Analysis

The LLM receives small batches of segments and returns validated JSON.

Current Phase 3 state: the app uses `ProsodyService` with the structured local analyzer `llm-prosody-local` to exercise the same contract, cache, and fallback without depending on a real GGUF/MLX model yet. Switching to an LLM runtime must preserve this canonical format.

Conceptual schema:

```json
{
  "segments": [
    {
      "segmentId": "string",
      "emotion": "neutral",
      "intensity": 0.2,
      "pace": "normal",
      "pitch": "neutral",
      "pauseAfterMs": 350,
      "instruction": "Calm tone, clear narration, without exaggeration."
    }
  ]
}
```

Initial values:

- `emotion`: `neutral`, `warm`, `tense`, `sad`, `joyful`, `angry`, `suspense`, `formal`.
- `pace`: `slow`, `normal`, `fast`.
- `pitch`: `low`, `neutral`, `high`.
- `intensity`: number between `0` and `1`.
- `pauseAfterMs`: number between `0` and `1500`.

Fallback: if the LLM fails, use `neutral`, `normal`, `neutral`, `0.2`, and punctuation-based pauses.

### 4.1 Canonical Narration Plan

The normalization and prosody analysis result becomes a `NarrationPlan`. This is the app's stable internal format, independent of the model:

```ts
type NarrationPlan = {
  schemaVersion: "narration-plan/v1"
  bookId: string
  chapterHref: string
  language: "pt-BR" | string
  segments: NarrationSegment[]
}

type NarrationSegment = {
  segmentId: string
  locator: unknown
  originalText: string
  normalizedText: string
  voiceRole?: "narrator" | "dialogue" | "quote" | "heading"
  prosody: {
    emotion: "neutral" | "warm" | "tense" | "sad" | "joyful" | "angry" | "suspense" | "formal"
    intensity: number
    pace: "slow" | "normal" | "fast"
    pitch: "low" | "neutral" | "high"
    pauseBeforeMs: number
    pauseAfterMs: number
    instructionPtBr: string
  }
}
```

Rules:

- `NarrationPlan` is validated with Zod before reaching TTS.
- The LLM may fill only prosody and voice-role fields; it must not change `normalizedText`.
- Normalized text comes from deterministic rules and the pronunciation dictionary.
- The audio cache depends on the plan, adapter, and model versions.

### 5. TTS Engine Adapter

Conceptual interface:

```ts
type TtsEngineCapabilities = {
  id: string
  displayName: string
  runtime: "mlx" | "metal" | "mps" | "pytorch" | "cpu" | "external"
  modelFormat: "mlx" | "gguf" | "safetensors" | "checkpoint" | "unknown"
  languages: string[]
  supportsVoiceClone: boolean
  supportsNaturalLanguageInstruction: boolean
  supportsDiscreteEmotion: boolean
  supportsBatch: boolean
  supportsStreaming: boolean
  supportsSegmentTimestamps: boolean
  supportsSsmlLikeMarkup: boolean
  preferredInputCase?: "lowercase" | "preserve"
  estimatedMemoryMb?: number
}
```

Every adapter receives:

- a `NarrationPlan` or batch of `NarrationSegment`
- language
- voice profile
- prosody instructions
- output path
- quality/performance parameters

And returns:

- per-segment audio
- duration
- logs
- recoverable or fatal error

The adapter is responsible for mapping the canonical plan to the model format:

- Qwen3-TTS VoiceDesign: convert `instructionPtBr` into a short natural-language instruction in the expected/supported language.
- Qwen3-TTS CustomVoice: map emotion/pacing to presets when available.
- Qwen3-TTS Base: use a voice/reference and ignore unsupported fields without failing.
- Chatterbox Multilingual MLX: map emotion/intensity to `exaggeration`, pacing to `cfgWeight`, PT-BR to `lang_code=pt`, and use plan pauses during chapter assembly.
- F5-TTS-pt-br: apply the recommended normalization, lowercase when necessary, voice/emotion references, and discrete markers when available.

Unsupported fields must never break generation. They become no-ops with a structured log.

### 5.1 Local Models and Downloads

The main process registers recommended models in `model_assets` and controls downloads through `model_download_jobs`.

Implemented:

- `Qwen3-4B-Instruct-2507 GGUF Q4_K_M` for prosody analysis through `node-llama-cpp`.
- Qwen3-TTS 0.6B, Qwen3-TTS 1.7B, Chatterbox Multilingual MLX, and F5-TTS-pt-br as real TTS models that can be registered from local folders.
- Neural synthesis sidecars for Qwen3-TTS, Chatterbox Multilingual MLX, and F5-TTS-pt-br through a protocol supervised by the main process.
- Multi-file snapshot downloads for TTS models installed under `.dreamreader-local/models`.
- Download progress saved in the database and displayed visually in the UI.
- Local prosody fallback when the GGUF model or optional runtime is unavailable.

Still pending:

- Active health-check execution before enabling neural synthesis.

### 6. Voice Manager

The voice manager sits above the adapters. It creates canonical profiles and engine-specific bindings.

Creation flow:

- The user selects a target engine and provides a voice name.
- The user adds authorized reference audio.
- The user provides or reviews the passage transcript.
- The app validates language, noise, duration, format, and usage permission.
- The adapter creates a voice binding: embedding, speaker reference, preset, or processed files.
- The app generates a short preview and saves the profile as an available voice.

Rules:

- A cloned voice appears in the selector only when a compatible binding exists for the active adapter.
- A voice may have multiple bindings for different engines.
- The UI must clearly indicate whether a voice is built-in, cloned, imported, or unavailable for the current engine.
- Deleting a voice must remove bindings, previews, and references unless the user chooses to retain original files outside the library.
- Consent and audio origin are required metadata for voice cloning.

### 7. Cache, Chapters, and M4B

Per-segment cache key:

- book content hash
- chapter
- `segmentId`
- TTS engine
- model version
- voice profile
- normalization version
- prosody prompt/schema version

The final chapter may be assembled as:

- per-segment files for fine-grained alignment
- one file per chapter for simple playback
- duration manifest for text/audio synchronization
- chapter entry in the book's M4B manifest

Initial output format:

- Generate intermediate WAV.
- Export M4A/AAC per chapter when encoder packaging is resolved.
- Generate the book's partial M4B from ready M4A/AAC chapters.
- Optionally retain WAV for debugging, with automatic cleanup.

### 8. Incremental M4B Assembly

When a chapter finishes:

- record duration, codec, voice, engine, hash, and order in the book manifest;
- mark the M4B as `stale`;
- enqueue a low-priority assembly job;
- generate a new temporary M4B from ready chapters;
- include cover, metadata, and chapter markers;
- validate duration and chapter count;
- atomically replace the previous partial M4B.

The partial M4B represents “chapters available so far.” It does not need to contain chapters that have not been generated. As new chapters arrive, the assembler rebuilds the file. This is safer than attempting an in-place append to an MP4 container.

## Job Queue

States:

- `queued`
- `preparing`
- `analyzing`
- `synthesizing`
- `assembling`
- `updating_m4b`
- `completed`
- `failed`
- `cancelled`

Requirements:

- Resume an interrupted job.
- Cancel without corrupting generated cache.
- Rerun failed segments.
- Limit concurrency per engine.
- Expose progress per chapter and segment.
- Respect the Apple Silicon resource governor: heavy TTS and LLM work is exclusive by default.
- Keep the model loaded while nearby jobs exist, with a configurable unload timeout.
- Trigger an M4B update after a chapter completes when auto-build is enabled for the book.
- Separate M4B failure from TTS failure: chapter audio remains valid even when M4B assembly fails.

## Expected UI

- “Generate chapter audio” action.
- Engine, voice, quality, and expressive-instruction selection.
- Voice manager with voice-cloning creation, previews, compatibility, and deletion.
- Global audio queue.
- Indicator for chapters with available audio.
- Partial/final M4B indicator per book.
- Player with position resumption.
- Option to delete generated audio per book/chapter.
- Option to rebuild or disable automatic M4B.
- Global and per-book pronunciation dictionary.

## Technical Risks

- Platform-specific Python/PyTorch packaging.
- CPU inference time.
- Unified memory/GPU contention between LLM and TTS on Apple Silicon.
- Quality and authorized use of cloned voices.
- M4B rebuild cost for long books.
- PT-BR quality in old spelling, poetry, dialogue, and proper names.
- Prosody instructions may make audio worse when exaggerated.
- Model licenses may restrict commercial distribution.

Mitigation:

- Prototype a short chapter with each engine before finalizing packaging.
- Start with subtle, conservative instructions.
- Save PT-BR regression samples: dialogue, numbers, names, abbreviations, poetry, and academic text.
- Measure RTF, peak memory, cold-start time, and perceived thermal usage on Apple Silicon.
- Use manifests and atomic replacement for M4B, keeping individual chapters as the reconstructable source.
