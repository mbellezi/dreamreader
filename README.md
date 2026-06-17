# DreamReader

DreamReader e um leitor de ebooks desktop, offline-first, feito em Electron, React e Node, com foco forte em leitura em portugues do Brasil e geracao local de audio de capitulos por modelos TTS.

## Estado atual

As fases 0, 1, 2 e 3 do roadmap estao implementadas:

- Fase 0: scaffold Electron/React/Tailwind, IPC validado por Zod, preload seguro, PGlite/Drizzle com migration inicial, protocolo local `dreamreader://asset/...`, contratos compartilhados e testes de base.
- Fase 1: MVP leitor com biblioteca local, importacao de EPUB/TXT/Markdown/HTML, lista/grid com busca, leitura com sumario e preferencias, retomada de posicao, marcacoes/notas/favoritos, exportacao de notas em Markdown e configuracoes iniciais.
- Fase 2: audio local basico com jobs TTS persistidos em PGlite, fila por capitulo, segmentacao/normalizacao PT-BR, adapter local WAV, cache de audio por capitulo, player no leitor, cancelamento/retry/retomada, diagnostico de modelos e manifesto parcial de audiobook.
- Fase 3: prosodia expressiva com analisador local estruturado, cache por segmento em PGlite, fallback neutro validado por Zod e comparacao entre audio neutro e expressivo na UI.

Os motores neurais Qwen/Chatterbox/F5 funcionam por instalacao local de Python, sidecars e pesos em `.dreamreader-local/`. O encoder M4B real e o empacotamento final ainda pertencem as proximas fases. Para preparar Qwen3-TTS/Chatterbox/F5-TTS-pt-br locais, rode `npm run setup:python-tts`; isso detecta macOS Apple Silicon, Windows ou Linux, instala um CPython 3.12 standalone, verifica o FFmpeg empacotado e cria pastas de modelos em `.dreamreader-local/`, que nao entra no git.

## Setup de desenvolvimento

Existe um agregador para a instalacao inicial de desenvolvimento, mas as etapas continuam disponiveis separadamente para controle fino de plataforma, sidecars e modelos. O agregador mostra no terminal a fase atual, uma descricao curta e o comando que sera executado antes de iniciar cada etapa.

Fluxo recomendado para uma maquina de desenvolvimento:

```bash
npm run setup:dev
npm run dev
```

Para conferir as fases sem executar downloads/instalacoes:

```bash
npm run setup:dev -- --dry-run
```

`npm run setup:dev` executa, em sequencia:

- `npm install`: instala as dependencias Node/Electron/React do projeto.
- `npm run download:readium-cli`: baixa o Readium CLI da plataforma atual para `vendor/readium/<platform-arch>/`.
- `npm run setup:python-tts -- --install-sidecars`: instala o runtime Python local e as dependencias dos sidecars TTS.
- `npm run download:tts-models`: baixa/prepara os modelos locais de TTS configurados pelo projeto.

Para um setup minimo de leitura/importacao de EPUB em desenvolvimento, `npm install` + `npm run download:readium-cli` ja sao suficientes antes de `npm run dev`. Para preparar builds multiplataforma, rode tambem `npm run download:readium-cli -- --all`.

## Documentacao

- `docs/00-product-spec.md`: produto, publico, funcionalidades e nao-objetivos.
- `docs/01-architecture.md`: arquitetura Electron, limites entre processos, IPC, banco, modelos e empacotamento.
- `docs/02-ai-tts-pipeline.md`: pipeline de normalizacao PT-BR, tags de prosodia, TTS e cache de audio.
- `docs/03-data-model.md`: schema PGlite/Drizzle atual e entidades planejadas.
- `docs/04-roadmap.md`: estado das fases implementadas e proximas fases.
- `docs/05-research-notes.md`: fontes e verificacoes tecnicas usadas nas decisoes iniciais.
- `docs/06-apple-silicon-performance.md`: estrategia de performance para LLM/TTS em Apple Silicon.
- `docs/07-tts-prosody-abstractions.md`: contratos de abstracao para prosodia, TTS e modelos locais.
- `docs/08-audiobook-m4b.md`: montagem incremental de audiobooks M4B por livro.

 ## Backend de TTS

No macOS Apple Silicon, `setup:python-tts` usa MLX/MPS por padrao. Em Windows e Linux, escolha o backend de instalacao com `--backend=cuda` ou `--backend=vulkan`:

```bash
npm run setup:python-tts -- --backend=cuda
npm run setup:python-tts -- --backend=vulkan --install-sidecars
npm run download:tts-models -- --backend=cuda
```

## Importacao de vozes

Os pacotes de vozes ficam em `voices/` como arquivos `.zip` compatíveis com o formato `DreamReader Voice`, por exemplo `voices/Lucas_PT-BR_curto_.zip` e `voices/Tiago_PT-BR_longo_.zip`.

Para importar pela interface:

1. Abra o app com `npm run dev`.
2. Entre em **Estúdio** e abra a aba **Vozes**.
3. Na seção **Vozes cadastradas**, clique em **Importar vozes**.
4. No seletor de arquivos, abra a pasta `voices/` do projeto e selecione um ou mais arquivos `.zip`.
5. Confirme a importação. As vozes importadas aparecem em **Vozes cadastradas** e ficam disponíveis nos motores compatíveis instalados.

Para ouvir prévias ou usar essas vozes na geração de áudio, instale antes o modelo e o sidecar do motor desejado em **Estúdio > Motores**. Pacotes com áudio de referência criam bindings para motores com clonagem de voz instalados; pacotes com prompt de voz ficam disponíveis para o Qwen VoiceDesign quando esse motor estiver instalado.

## Comandos principais

```bash
npm install
npm run setup:dev
npm run dev
npm test
npm run test:tts-models
npm run lint
npm run build
npm run download:readium-cli
npm run setup:python-tts
npm run download:tts-models
npm run db:generate
npm run db:migrate
```

Use `--install-sidecars` quando quiser instalar tambem as dependencias Python dos sidecars. O backend CUDA usa o indice oficial de wheels CUDA do PyTorch por padrao e pode ser alterado com `DREAMREADER_TORCH_CUDA_INDEX_URL`.

## Empacotamento de audio

O backend usa `music-metadata` para checar duracao/sample rate/canais de audio sem depender de `ffprobe` no `PATH`. Para reamostrar audio de referencia de voz, usa o binario de `ffmpeg-static`, tambem sem depender de `ffmpeg` instalado no sistema.

Ao gerar bundles Electron, o binario de `ffmpeg-static` precisa ser empacotado e ficar fora do ASAR para poder ser executado. A configuracao atual de `electron-builder` usa `asarUnpack` para `node_modules/ffmpeg-static/**`; mantenha essa regra em qualquer configuracao futura de empacotamento. Antes de distribuir publicamente, revisar tambem o impacto de licenca do `ffmpeg-static` (`GPL-3.0-or-later`).

## Direcao inicial

A stack proposta faz sentido, com tres cuidados importantes desde o inicio:

1. O renderer nao deve ter acesso direto a arquivos, banco, Python ou modelos locais. Tudo passa pelo preload e por IPC tipado/validado com Zod.
2. EPUB e HTML de livros sao conteudo nao confiavel. O leitor precisa de isolamento, CSP, protocolo local controlado e scripts desativados por padrao.
3. Em Apple Silicon, o caminho preferencial de performance deve ser MLX/Metal. `node-llama-cpp` com Metal continua como baseline forte para GGUF, mas os adapters devem permitir runtimes MLX quando forem mais rapidos.
4. Modelos TTS/LLM e Python devem ser tratados como componentes externos e versionados por manifestos. Eles nao devem ficar presos dentro do ASAR nem bloquear a UI.
5. Vozes clonadas devem ser perfis locais gerenciados pelo app e aparecer como opcoes de voz somente quando forem compativeis com o motor selecionado.
6. A geracao de capitulos deve alimentar um exportador M4B incremental, com um arquivo parcial por livro atualizado conforme novos capitulos ficam prontos.
