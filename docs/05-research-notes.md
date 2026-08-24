# Research Notes

Date: 2026-06-06.

## Verified Sources

- Qwen3-TTS on Hugging Face: the model page lists downloads for `Qwen3-TTS-12Hz-1.7B` and `0.6B`, with Base, CustomVoice, and VoiceDesign variants, and usage through the `qwen-tts` Python package.
  - https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base

- F5-TTS-pt-br on Hugging Face: a Brazilian Portuguese model based on F5-TTS, licensed under `cc-by-nc-4.0`. The page recommends lowercase text and `num2words` for numbers.
  - https://huggingface.co/firstpixel/F5-TTS-pt-br

- Chatterbox Multilingual MLX: an `mlx-community/chatterbox-fp16` conversion of Chatterbox for `mlx-audio`, supporting 23 languages including Portuguese through `lang_code=pt`, optional reference voice, and expressiveness controls.
  - https://huggingface.co/mlx-community/chatterbox-fp16
- MOSS-TTS-v1.5: 8B multilingual TTS from OpenMOSS with 31 languages, zero-shot cloning, punctuation-aware prosody, and explicit `[pause X.Ys]` control. `mlx-audio` supports the upstream checkpoint directly on Apple Silicon.
  - https://github.com/OpenMOSS/MOSS-TTS
  - https://huggingface.co/OpenMOSS-Team/MOSS-TTS-v1.5
  - https://github.com/Blaizzy/mlx-audio/tree/main/mlx_audio/tts/models/moss_tts

- PGlite: documentation indicates support for Node/Bun/Deno and the browser, filesystem/IndexedDB persistence, parameterized queries, and extensions.
  - https://pglite.dev/docs/
  - https://pglite.dev/docs/orm-support

- `node-llama-cpp` with Electron: documentation states that Electron is supported, but usage is restricted to the main process; it also recommends treating the package as external during bundling.
  - https://node-llama-cpp.withcat.ai/guide/electron

- `node-llama-cpp` with Metal: on Apple Silicon macOS, Metal is enabled by default in prebuilt binaries and Accelerate is always enabled on Mac.
  - https://node-llama-cpp.withcat.ai/guide/Metal

- Apple MLX: an array and machine-learning framework optimized for Apple Silicon's unified-memory architecture, with Python, Swift, C++, and C APIs.
  - https://opensource.apple.com/projects/mlx/
  - https://ml-explore.github.io/mlx/build/html/index.html

- PyTorch MPS on Mac: Apple documents acceleration through Metal Performance Shaders on Apple Silicon with the `mps` device.
  - https://developer.apple.com/metal/pytorch/

- `qwen-tts`: a cross-platform CLI that selects MLX on Apple Silicon, CUDA on NVIDIA, and CPU as a fallback while orchestrating the Python pipeline.
  - https://andreisuslov.github.io/qwen-tts/

- Qwen3-TTS with MLX/Swift: community implementations for Apple Silicon using MLX/Swift, including VoiceDesign, CustomVoice, Base, and streaming. These should be treated as POC candidates, not assumed dependencies.
  - https://github.com/AtomGradient/swift-qwen3-tts

- Readium Web: a toolkit for building Web Readers, with a TypeScript toolkit for manifests, navigators, the Preferences API, and the Decorator API.
  - https://github.com/readium/web

- `epub.js`: a JavaScript library for rendering EPUB in the browser, with common reading features such as rendering, persistence, and pagination.
  - https://github.com/futurepress/epub.js

- `electron-vite`: documentation covering main, preload, and renderer entry points, ESM, and build configuration.
  - https://electron-vite.org/guide/dev
  - https://electron-vite.org/guide/build.html

## Implications

- The proposed stack is coherent for a local-first app.
- The greatest risk is not React/Electron; it is packaging models, Python, native dependencies, and GPU support portably.
- F5-TTS-pt-br may be excellent for Brazilian Portuguese, but the `cc-by-nc-4.0` license must be considered for commercial use.
- Qwen3-TTS appears to offer more flexible variants, but still requires quality validation in Brazilian Portuguese and inference-cost measurement.
- Chatterbox Multilingual MLX is a strong Apple Silicon candidate when clonable multilingual voice with direct Portuguese support is the priority, but it still needs quality and RTF benchmarking in the app.
- `node-llama-cpp` should be designed as a main-process service from the beginning.
- For better Apple Silicon performance, the architecture should allow MLX as the preferred runtime wherever support is stable, while retaining `node-llama-cpp` + Metal as a GGUF baseline.
- PyTorch MPS is an important option for models that do not yet have a reliable MLX runtime, especially F5-TTS-pt-br.
- Model runtimes should be swappable adapters measured locally; the UI cannot depend on a model's proprietary tags or formats.
- Readium Web versus `epub.js` deserves a short proof of concept before finalizing the UI.
