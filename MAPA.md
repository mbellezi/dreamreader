# DreamReader - Mapa do Projeto

Este mapa orienta agentes e subagentes sobre onde procurar contexto antes de alterar o projeto.

## Documentacao

- `README.md`: visao geral do produto, stack e comandos principais.
- `docs/00-product-spec.md`: especificacao de produto.
- `docs/01-architecture.md`: arquitetura Electron, renderer, main, workers e sidecars.
- `docs/02-data-model.md`: modelo de dados local, PGlite e Drizzle.
- `docs/03-ipc-contracts.md`: canais IPC e fronteiras de seguranca.
- `docs/04-roadmap.md`: fases de implementacao.
- `docs/05-pt-br-language.md`: requisitos de portugues brasileiro.
- `docs/06-local-ai-apple-silicon.md`: estrategia para LLM/TTS local em Apple Silicon.
- `docs/07-voice-cloning.md`: modelo de vozes e consentimento.
- `docs/08-audiobook-m4b.md`: montagem incremental de M4B.

## Codigo

- `src/shared/contracts/`: contratos Zod canonicos compartilhados.
- `src/main/`: main process do Electron, banco, IPC e services locais.
- `src/preload/`: ponte segura entre renderer e main.
- `src/renderer/`: UI React e cliente do preload.
- `src/main/db/schema.ts`: schema Drizzle canonico.
- `drizzle/`: migrations geradas.
- `tests/`: testes de contratos e regressao.

## Regras de Trabalho

- Leia `RULES.md` e `GUIDELINES_GTP.md` antes de editar.
- Preserve os contratos em `src/shared/contracts/` como fonte da verdade.
- Renderer nunca acessa banco, filesystem privilegiado, modelos ou sidecars diretamente.
- Fases futuras devem seguir `docs/04-roadmap.md`; nao antecipe escopo pesado sem pedido explicito.
