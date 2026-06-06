# DreamReader

DreamReader e um leitor de ebooks desktop, offline-first, feito em Electron, React e Node, com foco forte em leitura em portugues do Brasil e geracao local de audio de capitulos por modelos TTS.

Este repositorio ainda esta na fase de especificacao. Os documentos iniciais vivem em `docs/`:

- `docs/00-product-spec.md`: produto, publico, funcionalidades e nao-objetivos.
- `docs/01-architecture.md`: arquitetura Electron, limites entre processos, IPC, banco, modelos e empacotamento.
- `docs/02-ai-tts-pipeline.md`: pipeline de normalizacao PT-BR, tags de prosodia, TTS e cache de audio.
- `docs/03-data-model.md`: entidades iniciais para PGlite/Drizzle.
- `docs/04-roadmap.md`: fases sugeridas de implementacao.
- `docs/05-research-notes.md`: fontes e verificacoes tecnicas usadas nas decisoes iniciais.
- `docs/06-apple-silicon-performance.md`: estrategia de performance para LLM/TTS em Apple Silicon.
- `docs/07-tts-prosody-abstractions.md`: contratos de abstracao para prosodia, TTS e modelos locais.
- `docs/08-audiobook-m4b.md`: montagem incremental de audiobooks M4B por livro.

## Direcao inicial

A stack proposta faz sentido, com tres cuidados importantes desde o inicio:

1. O renderer nao deve ter acesso direto a arquivos, banco, Python ou modelos locais. Tudo passa pelo preload e por IPC tipado/validado com Zod.
2. EPUB e HTML de livros sao conteudo nao confiavel. O leitor precisa de isolamento, CSP, protocolo local controlado e scripts desativados por padrao.
3. Em Apple Silicon, o caminho preferencial de performance deve ser MLX/Metal. `node-llama-cpp` com Metal continua como baseline forte para GGUF, mas os adapters devem permitir runtimes MLX quando forem mais rapidos.
4. Modelos TTS/LLM e Python devem ser tratados como componentes externos e versionados por manifestos. Eles nao devem ficar presos dentro do ASAR nem bloquear a UI.
5. Vozes clonadas devem ser perfis locais gerenciados pelo app e aparecer como opcoes de voz somente quando forem compativeis com o motor selecionado.
6. A geracao de capitulos deve alimentar um exportador M4B incremental, com um arquivo parcial por livro atualizado conforme novos capitulos ficam prontos.
