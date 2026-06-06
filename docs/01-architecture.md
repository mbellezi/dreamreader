# Arquitetura

## Stack Base

- Desktop: Electron com `electron-vite`.
- Renderer: React 19, TypeScript, Tailwind CSS 4, `shadcn/ui` e `lucide-react`.
- Backend local: Node.js no main process do Electron.
- Banco local: PGlite.
- ORM e migrations: Drizzle ORM.
- Contratos runtime: Zod.
- Trabalho pesado: `worker_threads` e processos Python supervisionados.
- LLM local: runtime abstrato, com `node-llama-cpp` + Metal como baseline GGUF e MLX como alvo preferencial de performance em Apple Silicon quando houver modelo/adapter estavel.
- TTS local: runtime abstrato, com adapters por motor. Em Apple Silicon, preferir MLX/Metal; usar PyTorch MPS quando MLX nao existir; CPU apenas como fallback.
- Governador de recursos: servico do main process que controla concorrencia, memoria unificada e uso do acelerador.

## Estado Atual Implementado

As fases 0 e 1 estao implementadas com esta arquitetura:

- `src/main/index.ts` cria a janela Electron com `sandbox`, `contextIsolation` e `nodeIntegration: false`.
- `src/preload/index.ts` expoe `window.dreamreader` via `contextBridge` e traduz respostas IPC tipadas para a UI.
- `src/main/ipc/register.ts` registra handlers IPC e valida os payloads de entrada com schemas Zod de `src/shared/contracts/`.
- `src/main/db/client.ts` inicializa PGlite persistente e aplica migrations Drizzle.
- `src/main/services/library-service.ts` implementa importacao, listagem, abertura, recursos de leitura, posicao, anotacoes, bookmarks, exportacao de anotacoes e settings.
- `src/main/protocol/asset-protocol.ts` serve assets registrados via `dreamreader://asset/:assetId`.
- `src/renderer/App.tsx` orquestra estado e navegacao; componentes ficam em `src/renderer/components/`, tipos de UI em `src/renderer/app/` e helpers puros em `src/renderer/lib/`.
- `src/renderer/lib/dreamreader.ts` atua como cliente usado pelo renderer; quando a bridge Electron nao existe, usa fallback local com dados de exemplo em `localStorage`.
- Servicos de TTS, vozes, modelos e audiobook existem como stubs/contratos para fases futuras; eles nao executam inferencia local, processamento real de voz nem montagem M4B ainda.

## Limites Entre Processos

### Renderer

Responsavel por:

- UI da biblioteca, leitor, anotacoes e configuracoes.
- Estado visual e cache leve de consultas.
- Renderizacao controlada do conteudo do livro.
- Futuramente: fila/player de audio e telas de diagnostico de modelos.

Nao deve:

- Acessar `fs`, PGlite, Python, `node-llama-cpp` ou modelos diretamente.
- Abrir arquivos via `file://` sem mediacao.
- Executar scripts embutidos em EPUB.

### Preload

Responsavel por:

- Expor uma API pequena via `contextBridge`.
- Validar payloads com Zod quando fizer sentido no limite do processo.
- Transformar erros do main em erros tipados para a UI.

### Main Process

Responsavel por:

- IPC handlers.
- Banco PGlite e migrations Drizzle.
- Importacao, extracao e armazenamento de livros.
- Protocolo local seguro para recursos de livros.
- Persistencia de posicao, anotacoes, bookmarks e settings.
- Gerenciamento inicial/stub de modelos locais, jobs TTS, perfis de voz e export M4B.
- Futuramente: fila persistente de jobs, supervisao de workers Node e subprocessos Python, execucao real de runtimes LLM/TTS, governador de recursos, voice cloning completo e montagem incremental de audiobooks M4B.

### Workers

Usos recomendados:

- Extracao e normalizacao de texto.
- Indexacao para busca.
- Segmentacao de capitulos.
- Preparacao de prompts para o LLM.
- Pos-processamento de audio e montagem de capitulos.

Observacao: `node-llama-cpp` tem restricoes especificas no Electron. A integracao futura deve validar se ele pode rodar dentro de um `worker_thread` controlado pelo main. Se nao puder, o main process deve manter uma fila serializada para inferencia.

### Runtimes Locais de IA

Usar runtimes locais como servicos supervisionados pelo main process:

- Preferir comunicacao por stdio JSON-RPC ou pipes.
- Evitar abrir porta HTTP local no MVP.
- Um adapter por motor/runtime: Qwen3-TTS MLX, Qwen3-TTS PyTorch, F5-TTS-pt-br PyTorch/MPS, LLM GGUF via `node-llama-cpp`, LLM MLX e futuros motores.
- Retornar progresso por segmento, logs estruturados e erros recuperaveis.
- Manter processos long-lived para nao pagar custo de startup/model load a cada segmento.
- Expor healthcheck, versao, memoria estimada, acelerador usado e metricas de throughput.

## Apple Silicon e Performance

Ver `docs/06-apple-silicon-performance.md` para a politica detalhada. Resumo arquitetural:

- Detectar chip, memoria unificada, macOS, disponibilidade de Metal, MLX e MPS no diagnostico inicial.
- Preferir modelos em formato MLX para TTS Qwen3 e, se os benchmarks aprovarem, para o LLM de prosodia.
- Usar `node-llama-cpp` com Metal para GGUF quando a integracao Electron/Node for mais simples ou mais estavel.
- Usar PyTorch MPS para F5-TTS-pt-br enquanto nao houver adapter MLX confiavel.
- Serializar inferencia pesada por padrao: um job TTS ativo ou um job LLM ativo por acelerador.
- Permitir concorrencia somente para etapas CPU leves: extracao, segmentacao, normalizacao, validacao de JSON e montagem de manifests.
- Cachear analise de prosodia e audio por segmento para reduzir recomputacao.

### Governador de Recursos

O `ResourceGovernor` deve ficar no main process e decidir quando um job pode adquirir recursos:

- `accelerator`: `mlx`, `metal`, `mps`, `cpu`.
- `memoryBudgetMb`: orcamento estimado por modelo e job.
- `thermalPolicy`: `quiet`, `balanced`, `maximum`.
- `exclusiveGpu`: verdadeiro para TTS/LLM grandes no MVP.
- `priority`: leitura/player e UI sempre vencem jobs de background.

O renderer nunca deve decidir concorrencia de modelo. Ele apenas pede jobs e recebe progresso.

## IPC

Os canais devem ser nomeados por dominio e validados com schemas Zod compartilhados:

- `library.importFiles`
- `library.listBooks`
- `library.updateBookMetadata`
- `reader.openBook`
- `reader.getResource`
- `reader.saveLocator`
- `annotations.create`
- `annotations.update`
- `annotations.delete`
- `annotations.export`
- `bookmarks.create`
- `tts.enqueueChapter`
- `tts.cancelJob`
- `tts.getJob`
- `tts.listJobs`
- `voices.list`
- `voices.createFromReference`
- `voices.preview`
- `voices.update`
- `voices.delete`
- `voices.listCompatible`
- `audiobook.getExport`
- `audiobook.enableAutoBuild`
- `audiobook.rebuild`
- `audiobook.reveal`
- `models.list`
- `models.diagnostics`
- `models.installFromPath`
- `settings.get`
- `settings.update`

O renderer deve importar apenas tipos e clientes de IPC, nunca implementacoes de servico.

## Banco e Arquivos

Estrutura sugerida dentro de `app.getPath("userData")`:

```text
DreamReader/
  db/pglite/
  library/books/
  library/covers/
  library/extracted/
  audio-cache/
  audiobooks/
  voices/
  models/
  logs/
  backups/
```

Padrao recomendado:

- Copiar livros importados para a biblioteca interna por hash.
- Guardar o caminho original como referencia, mas nao depender dele.
- Cachear capas e manifestos extraidos.
- Guardar audios gerados fora do banco, com metadados no PGlite.
- Guardar M4B parcial/final fora do banco, com manifestos e metadados no PGlite.
- Guardar referencias e embeddings de vozes em `voices/`, separados do cache de audio.
- Guardar modelos fora do ASAR e fora do banco.

## Vozes e Voice Cloning

O app deve tratar voz como um recurso local versionado:

- `VoiceProfile`: identidade visivel para o usuario, com nome, idioma, descricao, tags e consentimento.
- `VoiceSample`: audio/transcricao de referencia, qualidade e origem.
- `VoiceBinding`: material especifico de um adapter, como embedding, speaker id, preset ou referencia processada.

Uma voz pode existir como perfil canonico e ter um ou mais bindings. Exemplo: a mesma voz pode ter um binding para Qwen3-TTS Base e outro para F5-TTS-pt-br, se ambos forem criados/validados. O seletor de vozes mostra apenas perfis que tenham binding compativel com o motor escolhido.

O processo de criacao de voz deve rodar como job local:

- importar audio de referencia;
- opcionalmente transcrever ou solicitar transcricao manual;
- validar duracao, ruido, formato e idioma;
- confirmar consentimento;
- gerar preview curto;
- criar binding por adapter;
- registrar metricas e falhas.

## Audiobook M4B

Ver `docs/08-audiobook-m4b.md` para detalhes. Resumo arquitetural:

- Cada capitulo concluido gera audio canonico de capitulo e atualiza um manifesto do livro.
- Um `AudiobookAssembler` observa capitulos prontos e gera um M4B parcial em segundo plano.
- Como M4B e container MP4, a estrategia padrao e remontar o arquivo a partir do manifesto em arquivo temporario e substituir atomicamente o draft anterior.
- O arquivo parcial deve ser reproduzivel mesmo antes do livro inteiro estar pronto.
- Ao concluir todos os capitulos selecionados, o draft vira export final ou e remuxado como final.
- Mudancas de voz, motor, ordem de capitulos, capa ou metadados invalidam o M4B e disparam rebuild.

## Motor de Leitura

Estado atual do MVP:

- O app usa um motor proprio simples no `LibraryService`: EPUB e lido com `JSZip` + `fast-xml-parser`; TXT/Markdown/HTML viram um manifesto interno.
- EPUBs com spine ou NCX sao convertidos em capitulos legiveis; anchors de NCX podem dividir secoes dentro do mesmo arquivo HTML.
- O preload busca recursos pelo IPC `reader.getResource` e converte HTML para texto simples para o renderer atual.
- O renderer implementa leitura continua e paginada, preferencias, sumario, locators, marcacoes por selecao e retomada de posicao.
- Readium Web/TS Toolkit e `epub.js` nao foram adotados no MVP atual.

Endurecimento futuro:

- Abrir EPUB local sem expor `file://`.
- Salvar e restaurar locator.
- Criar marcacao em texto selecionado.
- Navegar por sumario.
- Aplicar temas e preferencias.
- Isolar conteudo rico em iframe sandboxed quando a renderizacao HTML completa for necessaria.
- Bloquear scripts e navegacao externa dentro de conteudo de livro.

## Seguranca de Conteudo

EPUB e HTML importado devem ser tratados como conteudo nao confiavel:

- Usar protocolo local controlado, por exemplo `dreamreader://book/:bookId/...`.
- Resolver recursos por ID de livro e caminho whitelisted.
- Desativar scripts de publicacoes por padrao.
- Aplicar CSP estrita.
- Renderizar conteudo em iframe sandboxed quando possivel.
- Bloquear navegacao externa automatica; links externos devem pedir confirmacao.
- Nunca expor APIs do preload para iframes de conteudo do livro.

## LLM Local

O LLM local nao deve "interpretar" o livro para o usuario. Seu papel inicial e operacional:

- Classificar tom local de segmentos.
- Sugerir ritmo, pausas e intensidade.
- Gerar instrucoes curtas e estruturadas para o TTS.
- Respeitar schema Zod e limites de tokens.

Modelos candidatos iniciais:

- Baseline: GGUF pequeno e multilingue, como Qwen3 0.6B/1.7B Instruct quantizado, rodando via `node-llama-cpp` com Metal.
- Caminho de performance Apple Silicon: modelo equivalente em MLX, rodando em sidecar Python/Swift quando os benchmarks mostrarem ganho real.

O output do LLM deve ser validado e normalizado. Se falhar, usar prosodia neutra.

## Empacotamento

Pontos de atencao:

- `node-llama-cpp` nao deve ser bundleado pelo Vite.
- Binarios nativos precisam manter estrutura de arquivos.
- Modelos devem ficar fora do ASAR.
- Python/PyTorch/TTS/MLX provavelmente exigem empacotamento por plataforma.
- MLX e modelos MLX devem ser instalados em `userData/models` ou em pasta escolhida pelo usuario, nunca dentro do ASAR.
- O MVP pode exigir instalacao manual de modelos, com um gerenciador local simples que aponta para pastas ja baixadas.

## Observabilidade Local

- Logs estruturados por dominio: `library`, `reader`, `tts`, `llm`, `db`, `ipc`.
- Tela de diagnostico simples no app.
- Exportacao de pacote de diagnostico sem incluir livros, audios ou vozes por padrao.
