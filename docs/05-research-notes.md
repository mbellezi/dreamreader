# Notas de Pesquisa

Data: 2026-06-06.

## Fontes Verificadas

- Qwen3-TTS no Hugging Face: a pagina do modelo lista downloads para `Qwen3-TTS-12Hz-1.7B` e `0.6B`, variantes Base, CustomVoice e VoiceDesign, e uso via pacote Python `qwen-tts`.
  - https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base

- F5-TTS-pt-br no Hugging Face: modelo especializado em portugues brasileiro, baseado em F5-TTS, com licenca `cc-by-nc-4.0`. A pagina recomenda lower case e `num2words` para numeros.
  - https://huggingface.co/firstpixel/F5-TTS-pt-br

- Chatterbox Multilingual MLX: conversao `mlx-community/chatterbox-fp16` do Chatterbox para `mlx-audio`, com suporte a 23 idiomas incluindo portugues via `lang_code=pt`, voz de referencia opcional e controles de expressividade.
  - https://huggingface.co/mlx-community/chatterbox-fp16

- PGlite: documentacao indica uso em Node/Bun/Deno e browser, persistencia por filesystem/IndexedDB, queries parametrizadas e extensoes.
  - https://pglite.dev/docs/
  - https://pglite.dev/docs/orm-support

- `node-llama-cpp` com Electron: documentacao informa suporte a Electron, mas restringe uso ao main process; tambem recomenda tratar o pacote como external no bundling.
  - https://node-llama-cpp.withcat.ai/guide/electron

- `node-llama-cpp` com Metal: em macOS Apple Silicon, Metal vem habilitado por padrao nos binarios prebuilt e o Accelerate fica sempre habilitado no Mac.
  - https://node-llama-cpp.withcat.ai/guide/Metal

- Apple MLX: framework de arrays e ML otimizado para a arquitetura de memoria unificada do Apple Silicon, com APIs Python, Swift, C++ e C.
  - https://opensource.apple.com/projects/mlx/
  - https://ml-explore.github.io/mlx/build/html/index.html

- PyTorch MPS no Mac: Apple documenta aceleracao por Metal Performance Shaders em Apple Silicon, com device `mps`.
  - https://developer.apple.com/metal/pytorch/

- `qwen-tts`: CLI cross-platform que seleciona MLX em Apple Silicon, CUDA em NVIDIA e CPU como fallback, orquestrando pipeline Python.
  - https://andreisuslov.github.io/qwen-tts/

- Qwen3-TTS em MLX/Swift: ha implementacoes comunitarias para Apple Silicon usando MLX/Swift, incluindo recursos de VoiceDesign, CustomVoice, Base e streaming. Devem ser tratadas como candidatas de POC, nao como dependencia assumida.
  - https://github.com/AtomGradient/swift-qwen3-tts

- Readium Web: toolkit para construir Web Readers, com TS toolkit para manifestos, navigators, Preferences API e Decorator API.
  - https://github.com/readium/web

- `epub.js`: biblioteca JS para renderizar EPUB no browser, com funcoes comuns de leitura como renderizacao, persistencia e paginacao.
  - https://github.com/futurepress/epub.js

- `electron-vite`: documentacao cobre entradas de main, preload e renderer, ESM e configuracoes de build.
  - https://electron-vite.org/guide/dev
  - https://electron-vite.org/guide/build.html

## Implicacoes

- A stack proposta e coerente para um app local-first.
- O maior risco nao e React/Electron; e empacotar modelos, Python, dependencias nativas e GPU de forma portavel.
- F5-TTS-pt-br pode ser excelente para PT-BR, mas a licenca `cc-by-nc-4.0` precisa ser considerada se houver uso comercial.
- Qwen3-TTS parece oferecer variantes mais flexiveis, mas ainda exige validacao de qualidade em PT-BR e custo de inferencia.
- Chatterbox Multilingual MLX e um candidato forte para Apple Silicon quando a prioridade e voz clonavel multilíngue com suporte direto a portugues, mas ainda precisa de benchmark de qualidade/RTF no app.
- O uso de `node-llama-cpp` deve ser desenhado como servico do main process desde o inicio.
- Para melhor performance em Apple Silicon, a arquitetura deve permitir MLX como runtime preferencial onde houver suporte estavel, mantendo `node-llama-cpp` + Metal como baseline GGUF.
- PyTorch MPS e uma opcao importante para modelos que ainda nao tenham runtime MLX confiavel, especialmente F5-TTS-pt-br.
- Runtimes de modelo devem ser adapters trocaveis e medidos localmente; a UI nao pode depender de tags ou formatos proprietarios de um modelo.
- A escolha Readium Web vs `epub.js` merece uma prova de conceito curta antes da UI final.
