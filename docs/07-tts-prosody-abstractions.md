# TTS and Prosody Abstractions

## Objective

Standardize conversion to TTS, emotion/prosody analysis, and model swapping. The app should depend on internal contracts, not APIs specific to Qwen, F5, or any future runtime.

## Layers

```text
Book text
  -> TextExtractor
  -> PtBrNormalizer
  -> ProsodyAnalyzer
  -> NarrationPlan
  -> VoiceManager
  -> TtsAdapter
  -> AudioSegmentStore
  -> ChapterAudioAssembler
  -> AudiobookAssembler
```

## Contracts

### `PtBrNormalizer`

Responsible for transforming original text into speakable text.

```ts
type PtBrNormalizer = {
  normalize(input: NormalizeInput): Promise<NormalizeResult>
}
```

Rules:

- Deterministic.
- Versioned.
- Does not depend on an LLM.
- Uses a global and per-book dictionary.
- Returns a map between original text, normalized text, and locator.

### `ProsodyAnalyzer`

Responsible for suggesting emotion, pace, intensity, pauses, and voice role.

```ts
type ProsodyAnalyzer = {
  id: string
  analyze(input: ProsodyInput): Promise<ProsodyResult>
}
```

Implementations:

- `neutral-prosody`: punctuation-based rules, without an LLM.
- `llm-prosody-gguf`: `node-llama-cpp` + Metal/GGUF.
- `llm-prosody-mlx`: MLX sidecar for Apple Silicon, if approved by benchmarking.

Rules:

- Never alter the text.
- Return JSON validated by Zod.
- Convert failures to neutral prosody.
- Cache output by segment.

### `NarrationPlan`

Canonical format between prosody and TTS.

```ts
type NarrationPlan = {
  schemaVersion: "narration-plan/v1"
  source: {
    bookId: string
    chapterHref: string
    contentHash: string
    language: string
  }
  normalization: {
    normalizerId: string
    version: string
    dictionaryVersion: string
  }
  prosody: {
    analyzerId: string
    version: string
    promptVersion?: string
  }
  segments: NarrationSegment[]
}
```

This plan is the primary interoperability contract. A new adapter only needs to accept `NarrationPlan` and declare its capabilities.

### `TtsAdapter`

Responsible for translating the canonical plan to a real engine.

```ts
type TtsAdapter = {
  id: string
  getCapabilities(): Promise<TtsEngineCapabilities>
  prepare(model: ModelAsset, voice: VoiceProfile): Promise<void>
  synthesize(input: TtsSynthesisInput): AsyncIterable<TtsProgressEvent>
  cancel(jobId: string): Promise<void>
  dispose(): Promise<void>
}
```

Rules:

- The adapter does not access the UI.
- The adapter does not decide the global queue.
- The adapter may ignore unsupported fields, but must log them.
- The adapter returns per-segment progress events.
- The adapter must be testable with `NarrationPlan` fixtures.
- The adapter declares whether it can create or use voice cloning.

### `VoiceManager`

Responsible for creating, listing, validating, and deleting available voices.

```ts
type VoiceManager = {
  listVoices(filter: VoiceFilter): Promise<VoiceProfile[]>
  listCompatibleVoices(engineId: string): Promise<VoiceProfile[]>
  createFromReference(input: VoiceCloneInput): AsyncIterable<VoiceCloneEvent>
  createBinding(input: VoiceBindingInput): AsyncIterable<VoiceCloneEvent>
  preview(voiceProfileId: string, engineId: string): Promise<AudioAsset>
  deleteVoice(voiceProfileId: string): Promise<void>
}
```

Rules:

- A voice is a canonical profile; use by an engine depends on bindings.
- A cloned voice requires confirmed consent before becoming available.
- A voice without a compatible binding appears unavailable for that engine, not as an error.
- Preview uses a short standard PT-BR text and is cached.

### `AudiobookAssembler`

Responsible for turning generated chapters into a book M4B.

```ts
type AudiobookAssembler = {
  updateManifest(input: ChapterAudioReady): Promise<AudiobookManifest>
  buildDraft(bookId: string): AsyncIterable<AudiobookBuildEvent>
  buildFinal(bookId: string): AsyncIterable<AudiobookBuildEvent>
  markStale(bookId: string, reason: string): Promise<void>
}
```

Rules:

- Uses ready chapters as the source; it does not depend on original segments to assemble the M4B.
- Updates the M4B by atomic rebuild, not in-place append.
- Keeps chapter markers and book metadata.
- A build failure does not invalidate chapter audio.
- Any change to voice, engine, order, cover, or metadata marks the export as `stale`.

## Prosody Mapping

The app uses small semantic categories:

- emotion: `neutral`, `warm`, `tense`, `sad`, `joyful`, `angry`, `suspense`, `formal`
- pace: `slow`, `normal`, `fast`
- pitch: `low`, `neutral`, `high`
- intensity: `0..1`
- pause before/after in milliseconds

Each adapter converts these values:

- Model with natural-language instruction: generate a short instruction sentence.
- Model with discrete tags: map to the closest tag.
- Model with parametric controls: map intensity/emotion to numeric parameters and apply pauses in the assembler.
- Model without emotional control: ignore it and log `unsupported_prosody_field`.
- Model with a reference voice: preserve discrete prosody and prioritize voice consistency.

## Adapter Manifest

Each adapter must have a manifest:

```json
{
  "adapterId": "qwen3-tts-mlx",
  "displayName": "Qwen3-TTS MLX",
  "runtime": "mlx",
  "modelFormats": ["mlx"],
  "languages": ["pt-BR", "pt", "en"],
  "capabilities": {
    "voiceClone": true,
    "naturalLanguageInstruction": true,
    "discreteEmotion": true,
    "batch": true,
    "streaming": true,
    "segmentTimestamps": false
  }
}
```

The app registers adapters by manifest and healthcheck. This allows a Python implementation to be replaced by Swift/MLX without changing the UI.

Current Phase 4 state:

- `qwen3-tts-06b-mlx`, `qwen3-tts-17b-mlx`, `qwen3-tts-17b-base-mlx`, `chatterbox-multilingual-mlx`, `moss-tts-v15-mlx`, and `f5-tts-pt-br` are already registered as real engines.
- `qwen3-tts-06b-mlx` and `qwen3-tts-17b-base-mlx` operate as Qwen Base: they require a cloned reference voice (`ref_audio` + `ref_text`) and do not receive natural-language prosody instructions in the sidecar.
- `qwen3-tts-17b-mlx` operates as VoiceDesign: available voices are voice prompts, not audio cloning.
- `chatterbox-multilingual-mlx` operates through MLX/`mlx-audio`: it uses `lang_code=pt` for Brazilian Portuguese, accepts an optional reference, and maps prosody to `exaggeration`, `cfgWeight`, and pauses.
- `moss-tts-v15-mlx` operates through MLX/`mlx-audio` on Apple Silicon: it uses explicit language tags, accepts an optional authorized reference, preserves native pause markup, and consumes natural-language narration instructions when present.
- Neural synthesis remains blocked until a sidecar/healthcheck is configured.
- Expressive prosody attempts to use `Qwen3-4B-Instruct-2507 GGUF Q4_K_M` through `node-llama-cpp`; without the runtime or local file, the app returns to the local structured analyzer.
- The audio panel displays model download progress in real time.

## Contract Tests

Every adapter must pass fixtures for:

- neutral PT-BR narration
- dialogue with an em dash
- numbers, dates, currency, and acronyms
- intense emotion that should be softened
- unsupported prosody field
- compatible and incompatible cloned voices
- cancellation in the middle of a batch
- resumption using partial cache
- M4B rebuild after a new chapter
- M4B rebuild after regenerating a chapter with another voice

Expected outputs:

- audio or a mocked event per segment
- duration manifest
- M4B manifest with chapters and metadata
- structured logs
- no renderer access

## Architectural Benefit

With this separation:

- Switching Qwen3 0.6B to 1.7B changes the model/configuration, not the pipeline.
- Switching PyTorch for MLX changes the adapter/runtime, not the UI.
- F5-TTS-pt-br can have specialized rules without contaminating the rest of the system.
- Cloned voices become reusable profiles instead of being tied to a generation screen.
- The book M4B can be rebuilt from chapters and manifests.
- The prosody LLM can be disabled without breaking TTS.
- The cache remains valid through explicit normalizer, prosody, adapter, and model versions.
