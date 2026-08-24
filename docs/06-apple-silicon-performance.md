# Apple Silicon Performance

## Objective

The app should extract the best possible performance from Apple Silicon without tying the architecture to a single runtime. The policy is:

1. Prefer a native/optimized Apple Silicon runtime when it is mature.
2. Keep a stable, simple fallback.
3. Measure everything on the user's/developer's device before declaring a path the default.

## Preference Order by Model Type

### Prosody LLM

1. MLX with a small quantized model, when a stable equivalent model and adapter are available.
2. `node-llama-cpp` with GGUF + Metal.
3. CPU only for diagnostics or fallback.

Notes:

- The prosody LLM should be small. It generates short JSON and does not need long reasoning.
- Batch segments to reduce overhead while keeping context short.
- Enable prompt/schema caching when the runtime supports it.
- Low temperature and structured output reduce repetitions and retries.

### Qwen3-TTS

1. MLX, preferably in a long-lived process.
2. Swift/MLX as a future alternative if eliminating Python overhead provides a clear gain.
3. PyTorch MPS/CUDA/CPU as a platform fallback.

Notes:

- Qwen3-TTS has 0.6B and 1.7B variants; the app should treat size as a quality/performance setting.
- Benchmarks should compare 0.6B versus 1.7B and fp32/bf16/quantized variants when reliable conversions exist.
- Do not assume a smaller dtype is always faster on Apple Silicon; measure RTF and quality.

### F5-TTS-pt-br

1. PyTorch MPS when the graph/opset runs correctly.
2. CPU fallback with a performance warning.
3. MLX only if a reliable, validated port/conversion appears.

Notes:

- F5-TTS-pt-br is strong for Brazilian Portuguese, but it may be the hardest path to accelerate.
- The adapter should isolate dependencies and allow the implementation to be replaced without changing the pipeline.

### Chatterbox Multilingual

1. MLX through `mlx-audio`, preferably in a supervised sidecar process.
2. PyTorch only as a fallback/POC outside the main path.

Notes:

- The `mlx-community/chatterbox-fp16` model supports Portuguese through `lang_code=pt`.
- Prosody should use the model's exposed controls (`exaggeration` and CFG), preserving the app's canonical plan.
- A reference voice is optional; when used, the sample should match the selected language to avoid unwanted accent transfer.

### MOSS-TTS-v1.5

1. MLX through `mlx-audio` on Apple Silicon.
2. Keep upstream PyTorch/CUDA as a future non-Mac adapter behind the same engine contract.

Notes:

- The upstream 8B checkpoint is supported directly by `mlx-audio`; no separate converted model ID is required.
- Always provide the known language tag (`Portuguese` for PT-BR) because v1.5's multilingual quality is stronger with explicit tags.
- Treat the model as an exclusive heavy accelerator job and expect a substantially larger unified-memory budget than Qwen3-TTS 0.6B/1.7B.
- Direct synthesis and authorized zero-shot reference cloning use the same adapter; native `[pause X.Ys]` markup is preserved.

## Long-lived Processes

Do not start Python or load a model per segment. Each heavy runtime should run as a sidecar:

- `start`: load the runtime and model.
- `warmup`: run a short disposable inference.
- `synthesize` or `analyze`: process a batch.
- `cancel`: interrupt a job without killing the process when possible.
- `health`: return state, estimated memory, and accelerator.
- `shutdown`: release the model after a configurable timeout.

Suggested initial timeouts:

- LLM: unload after 2 to 5 idle minutes.
- TTS: unload after 5 to 15 idle minutes because model loading tends to cost more.

## Resource Governor

Apple Silicon uses unified memory. This helps, but it also means that the UI, Electron, database, LLM, and TTS compete for the same physical budget.

Initial policy:

- One heavy accelerator job at a time.
- TTS takes priority over the LLM when the user explicitly requests audio.
- Player, reading, and UI take priority over any background job.
- Indexing and normalization run on CPU at low priority.
- When memory is low, pause the TTS queue before degrading the UI.

Profiles:

- `quiet`: low concurrency and longer pauses, suitable for battery/fanless systems.
- `balanced`: default.
- `maximum`: uses the highest acceptable level, with a heat/power warning.

## Required Metrics

Record for each runtime/model:

- `coldStartMs`: time until the model responds.
- `warmStartMs`: time with the model already loaded.
- `peakMemoryMb`: peak memory.
- `rtf`: real-time factor for TTS.
- `tokensPerSecond`: LLM throughput.
- `timeToFirstTokenMs`: LLM latency.
- `segmentsPerMinute`: complete pipeline throughput.
- `failures`: errors by type.
- `accelerator`: `mlx`, `metal`, `mps`, or `cpu`.
- `deviceProfile`: chip, memory, macOS, and runtime versions.

These metrics should feed `performance_profile_json` and the diagnostics screen.

## Performance Cache

Cache:

- Extracted chapter text.
- Segmentation.
- PT-BR normalization.
- Prosody analysis.
- Audio per segment.
- Duration manifest.

Invalidate only what changed:

- Pronunciation dictionary changed: normalization/prosody/audio for affected segments.
- LLM prompt/schema changed: prosody/audio.
- Engine/model/voice changed: audio.
- Original text changed: everything for the affected chapter.

## macOS Packaging

- Models and runtimes stay outside ASAR.
- `node-llama-cpp` must remain external during bundling.
- MLX/Python should be installed through a controlled environment or a platform-packaged runtime.
- The model manager should accept already-downloaded local folders.
- The app should clearly show which runtime is active: MLX, Metal/GGUF, MPS, or CPU.

## Proofs of Concept

Before the audio MVP:

- Benchmark GGUF/Metal LLM versus MLX LLM for generating a `NarrationPlan`.
- Benchmark Qwen3-TTS MLX 0.6B versus 1.7B on a Brazilian Portuguese excerpt.
- Benchmark MOSS-TTS-v1.5 MLX on the same excerpt, including cold start, warm RTF, peak unified memory, cloning stability, and long-form punctuation/pause behavior.
- Benchmark F5-TTS-pt-br on PyTorch MPS and CPU.
- Test a chapter containing dialogue, numbers, abbreviations, and accents.
- Measure whether running prosody + TTS in parallel worsens total time; the initial hypothesis is that serialization will be more stable.
