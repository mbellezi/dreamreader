# DreamReader - Mapa do Projeto

Este mapa orienta agentes e subagentes sobre onde procurar contexto antes de alterar o projeto.

## Documentacao

- `README.md`: visao geral do produto, stack e comandos principais.
- `docs/00-product-spec.md`: especificacao de produto.
- `docs/01-architecture.md`: arquitetura Electron, renderer, main, workers e sidecars.
- `docs/02-ai-tts-pipeline.md`: pipeline planejado de IA/TTS, normalizacao, prosodia e cache de audio.
- `docs/03-data-model.md`: modelo de dados local, PGlite e Drizzle.
- `docs/04-roadmap.md`: fases de implementacao.
- `docs/05-research-notes.md`: notas de pesquisa e verificacoes tecnicas iniciais.
- `docs/06-apple-silicon-performance.md`: estrategia para LLM/TTS local em Apple Silicon.
- `docs/07-tts-prosody-abstractions.md`: contratos de prosodia, TTS e modelos locais.
- `docs/08-audiobook-m4b.md`: montagem incremental de M4B.
- `docs/09-readium-poc.md`: POC do Readium Web (CLI, manifesto, ts-toolkit).
- `docs/10-thorium-reader-troubleshooting.md`: armadilhas do leitor Thorium/Readium (iframe same-origin + allow-scripts, StrictMode, fragilidade do PGlite de dev).

## Codigo

- `src/shared/contracts/`: contratos Zod canonicos compartilhados.
- `src/main/`: main process do Electron, banco, IPC e services locais.
- `src/preload/`: ponte segura entre renderer e main.
- `src/renderer/App.tsx`: orquestracao de alto nivel da UI.
- `src/renderer/components/`: panes, controles e componentes React modulares.
- `src/renderer/app/`: tipos internos compartilhados pela UI.
- `src/renderer/lib/`: cliente do preload, helpers puros, paginacao, anotacoes e fallback renderer.
- `src/main/db/schema.ts`: schema Drizzle canonico.
- `drizzle/`: migrations geradas.
- `tests/`: testes de contratos e regressao.

## Regras de Trabalho

- Leia `RULES.md` e `GUIDELINES_GTP.md` antes de editar.
- Preserve os contratos em `src/shared/contracts/` como fonte da verdade.
- Renderer nunca acessa banco, filesystem privilegiado, modelos ou sidecars diretamente.
- Fases futuras devem seguir `docs/04-roadmap.md`; nao antecipe escopo pesado sem pedido explicito.
