# DreamReader

DreamReader e um leitor de ebooks desktop, offline-first, feito em Electron, React e Node, com foco forte em leitura em portugues do Brasil e geracao local de audio de capitulos por modelos TTS.

## Estado atual

As fases 0 e 1 do roadmap estao implementadas:

- Fase 0: scaffold Electron/React/Tailwind, IPC validado por Zod, preload seguro, PGlite/Drizzle com migration inicial, protocolo local `dreamreader://asset/...`, contratos compartilhados e testes de base.
- Fase 1: MVP leitor com biblioteca local, importacao de EPUB/TXT/Markdown/HTML, lista/grid com busca, leitura com sumario e preferencias, retomada de posicao, marcacoes/notas/favoritos, exportacao de notas em Markdown e configuracoes iniciais.

O pipeline real de audio local, LLM de prosodia, voice cloning persistente e montagem M4B ainda pertencem as proximas fases. O codigo atual ja possui contratos, schemas e servicos-stub para esses dominios, mas nao executa inferencia local nem sintetiza audio real.

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

## Comandos principais

```bash
npm run dev
npm test
npm run lint
npm run build
npm run db:generate
npm run db:migrate
```

## Direcao inicial

A stack proposta faz sentido, com tres cuidados importantes desde o inicio:

1. O renderer nao deve ter acesso direto a arquivos, banco, Python ou modelos locais. Tudo passa pelo preload e por IPC tipado/validado com Zod.
2. EPUB e HTML de livros sao conteudo nao confiavel. O leitor precisa de isolamento, CSP, protocolo local controlado e scripts desativados por padrao.
3. Em Apple Silicon, o caminho preferencial de performance deve ser MLX/Metal. `node-llama-cpp` com Metal continua como baseline forte para GGUF, mas os adapters devem permitir runtimes MLX quando forem mais rapidos.
4. Modelos TTS/LLM e Python devem ser tratados como componentes externos e versionados por manifestos. Eles nao devem ficar presos dentro do ASAR nem bloquear a UI.
5. Vozes clonadas devem ser perfis locais gerenciados pelo app e aparecer como opcoes de voz somente quando forem compativeis com o motor selecionado.
6. A geracao de capitulos deve alimentar um exportador M4B incremental, com um arquivo parcial por livro atualizado conforme novos capitulos ficam prontos.
