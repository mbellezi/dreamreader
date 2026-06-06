# Roadmap

Este roadmap descreve o estado atual do repositorio e o escopo planejado. As fases 0, 1, 2 e 3 estao implementadas no codigo atual; as fases seguintes continuam planejadas.

## Fase 0: Fundacao Tecnica - Implementada

Objetivo: reduzir riscos de arquitetura antes de construir funcionalidades de produto.

Implementado:

- Scaffold Electron com `electron-vite`, React 19, TypeScript, Tailwind CSS 4 e `lucide-react`.
- Janela Electron com `sandbox`, `contextIsolation` e `nodeIntegration: false`.
- Preload seguro via `contextBridge`, expondo a API `window.dreamreader`.
- IPC registrado no main process com requests validados por schemas Zod compartilhados.
- Contratos Zod em `src/shared/contracts/` para biblioteca, leitor, anotacoes, configuracoes, TTS, vozes, modelos e audiobook.
- Banco PGlite persistente em `app.getPath("userData")/db/pglite`.
- Drizzle ORM com migration inicial em `drizzle/0000_fearless_swordsman.sql`.
- Estrutura local de arquivos em `userData`: biblioteca, capas, extraidos, cache de audio, audiobooks, vozes, modelos, logs e backups.
- Protocolo local `dreamreader://asset/:assetId` para servir assets registrados sem expor `file://`.
- Servicos do main process para biblioteca, runtime/modelos, TTS, vozes e audiobook.
- Testes de contratos, locator preload, importacao EPUB, paginacao, anotacoes e helpers de estado do renderer.

Escopo preparado, mas sem execucao real ainda:

- Contratos de `NarrationPlan`, adapters TTS, voice cloning, jobs TTS, diagnosticos de runtime e M4B.
- Stubs de TTS, vozes, modelos e audiobook para validar fronteiras IPC e UI futura.
- A inferencia real de TTS neural, processamento de voz e montagem M4B ficam nas fases 4 e 5.

## Fase 1: MVP Leitor - Implementada

Implementado:

- Biblioteca local com importacao de EPUB, TXT, Markdown e HTML.
- Copia de livros importados para a biblioteca interna por hash de conteudo.
- Deteccao de duplicatas por `content_hash`.
- Extracao de metadados basicos de EPUB: titulo, autores, idioma, sumario e capa quando disponivel.
- Suporte a EPUBs com NCX/anchors, incluindo divisao de capitulos em um mesmo arquivo HTML.
- Lista/grid de livros com busca simples.
- Tela de leitura com sumario, capitulo anterior/proximo e retorno para posicao anterior.
- Preferencias do leitor: tema, fonte, tamanho, largura de coluna, numero de colunas, entrelinha, espacamento, margens, fluxo continuo/paginado, alinhamento e hifenizacao.
- Modo de leitura paginado com geometria testada e ancoragem de pagina para reflow.
- Retomada de posicao por locator persistente e progressao 0..1.
- Marcacoes coloridas, notas e favoritos baseados em selecao de texto.
- Resolucao de marcacoes por paragrafo/offset para evitar destacar ocorrencias repetidas erradas.
- Exportacao basica de anotacoes em Markdown ou JSON pelo main; a UI expoe Markdown.
- Configuracoes iniciais de idioma, aparencia e preferencias do leitor.
- Fallback renderer com dados de exemplo em `localStorage` quando a bridge Electron nao esta disponivel.
- Renderer modularizado: `App.tsx` orquestra alto nivel; panes, controles, helpers DOM e regras puras vivem em arquivos dedicados.
- i18n inicial em `pt-BR` e `en`.

Limites conhecidos do MVP leitor:

- Busca atual cobre metadados na biblioteca; busca no texto completo fica para fase beta.
- Colecoes/tags existem no modelo planejado, mas nao tem UI completa no MVP atual.
- O leitor usa extracao/renderizacao propria de HTML/texto; Readium/epub.js nao foram adotados no MVP atual.
- Conteudo EPUB/HTML e convertido para texto no renderer atual; isolamento de iframe/sandbox para conteudo rico permanece como endurecimento futuro.

## Fase 2: Audio Local Basico - Implementada

Implementado:

- Jobs de TTS persistidos no banco em `tts_jobs`.
- Segmentos de TTS persistidos em `tts_segments`.
- Fila serial de jobs por capitulo, retomando jobs interrompidos ao abrir o app.
- Adapter inicial `dreamreader-local-wav` usando `NarrationPlan` canonico.
- Segmentacao por bloco/frase e normalizacao PT-BR basica: abreviacoes, datas, horas, moeda e porcentagem.
- Player de audio por capitulo na aba de audio do inspetor.
- Cache de audio por capitulo em `audio-cache/`, com metadata em `assets` e `audiobook_chapters`.
- Cancelamento, retry e reutilizacao de cache para jobs repetidos.
- Diagnostico de modelos/runtimes exibindo o adapter local disponivel e engines futuras nao configuradas.
- Ciclo long-lived do adapter local com warmup e timeout de desalocacao.
- Manifesto parcial de audiobook por livro em `audiobook_exports` e `audiobook_chapters`; rebuild gera asset JSON manifest-only enquanto o encoder M4B real nao existe.

Limites conhecidos da fase 2:

- O adapter atual gera WAV local deterministico para validar fila/cache/player; nao e uma engine neural Qwen/F5 nem sintetiza voz natural.
- O export M4B ainda e manifest-only; encoder AAC/M4B real fica para empacotamento/engines futuras.

## Fase 3: Prosodia com LLM - Implementada

Implementado:

- `ProsodyService` no main process para aplicar prosodia neutra ou expressiva sobre `NarrationPlan`.
- Analisador local estruturado `llm-prosody-local`, validado por Zod, para gerar instrucoes de emocao, ritmo, pitch, intensidade, pausas e papel de voz por segmento.
- Cache persistente de analise em `prosody_analyses`, com chave por hash de segmento, analyzer, versao e prompt/schema.
- Fallback neutro por segmento quando a analise falha, retorna JSON invalido ou nao cobre todos os segmentos.
- UI para ligar/desligar narracao expressiva no painel de audio.
- Comparacao entre audio neutro e audio expressivo quando ambos existem para o capitulo.
- Metadados de job com modo de prosodia, cache hits, analises geradas e fallbacks.
- Adapter WAV local usando a prosodia do plano para produzir diferenca audivel deterministica entre neutro e expressivo.

Limites conhecidos da fase 3:

- O analisador deterministico continua disponivel como fallback quando o runtime real nao esta instalado.
- A qualidade expressiva ainda e conservadora e serve para validar fluxo, persistencia e comparacao na UI.

## Fase 4: Multi-engine TTS e Vozes

Implementado nesta etapa inicial da fase 4:

- Catalogo persistente de modelos em `model_assets`.
- Jobs persistentes de download em `model_download_jobs`, com progresso salvo e exibido no painel de audio.
- UI de modelos locais com estado visual `na fila`, `baixando`, `disponivel` e `falhou`.
- Download direto do `Qwen3-4B-Instruct-2507 GGUF Q4_K_M` recomendado para prosodia.
- Provider real de prosodia GGUF via `node-llama-cpp`, ativado quando o arquivo local e o runtime opcional estao disponiveis.
- Fallback automatico para o analisador local estruturado quando o Qwen GGUF ou `node-llama-cpp` nao estao instalados.
- Registro dos motores `qwen3-tts-06b-mlx`, `qwen3-tts-17b-mlx` e `f5-tts-pt-br` em `tts_engines`.
- Registro de manifests de runtime em `runtime_manifests` para futuros sidecars Python/Swift/MLX/PyTorch.

Pendencias ainda dentro da fase 4:

- Adapter Qwen3-TTS 0.6B.
- Adapter Qwen3-TTS 1.7B.
- Adapter F5-TTS-pt-br.
- Sidecars reais de sintese para MLX/PyTorch.
- Seletor de motor por livro/capitulo.
- Persistencia completa de perfis de voz, samples e bindings.
- Gerenciador de vozes clonadas com consentimento, samples, previews e bindings por engine.
- Dicionario de pronuncia global e por livro.
- Exclusao e limpeza de audio/cache.
- Reconstrucao M4B quando voz, motor ou capitulo mudarem.

## Fase 5: Empacotamento Alpha

- Instalador macOS primeiro, depois Windows/Linux.
- Estrategia para Python e dependencias nativas.
- Gerenciador local de modelos por pasta.
- Logs e pacote de diagnostico.
- Backup/exportacao de biblioteca sem copiar livros, opcionalmente com livros.
- Testes de regressao para importacao, posicao, anotacoes e TTS.

## Fase 6: Beta

- Busca no texto completo.
- PDF como fluxo separado.
- Melhorias de acessibilidade.
- Monitoramento opcional de pastas.
- Importacao/exportacao de marcacoes em formatos externos.
- Polimento de UI e performance.
