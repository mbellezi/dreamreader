# DreamReader - Regras de Implementacao

Este arquivo deve ser seguido por qualquer agente ou subagente que implemente codigo neste projeto.

Se houver conflito entre este arquivo e uma etapa de algum comando dado ao agente ou etapa de implementacao, pare e registre a divergencia antes de implementar.

## Principios Gerais

- O projeto e local-first, TypeScript-first e orientado por contratos.
- Implemente uma etapa por vez, conforme `docs/04-roadmap.md`.
- Nao implemente escopo futuro dentro do MVP sem pedido explicito.
- Preserve as ideias documentadas, mesmo quando estiverem fora da etapa atual.
- Evite refactors amplos que nao sejam necessarios para a etapa.
- Nao reverta alteracoes do usuario ou de outros agentes sem pedido explicito.
- Nao faca commit final automaticamente.
- Ao concluir uma etapa, informe arquivos alterados, testes executados, migrations aplicadas e pendencias.
- Consulte os documentos em `docs/` antes de implementar uma decisao de produto, arquitetura, TTS, LLM, banco, voz ou M4B.
- Quando houver duvida entre uma implementacao rapida e uma que preserve os contratos documentados, preserve os contratos.

## Stack Obrigatoria

- Desktop: Electron com `electron-vite`.
- Renderer: React 19.
- CSS/UI: Tailwind CSS 4 e `shadcn/ui`.
- Icones: preferir `lucide-react`.
- Backend local: Node.js no main process do Electron.
- Banco: PGlite.
- ORM/migrations: Drizzle ORM.
- Contratos: Zod.
- Workers: `worker_threads`.
- Runtime local GGUF: `node-llama-cpp`, por padrao apenas no main process. Worker controlado pelo main process so depois de POC validada no Electron.
- Runtime local em Apple Silicon: preferir MLX/Metal quando houver adapter estavel e benchmark favoravel; usar `node-llama-cpp` + Metal como baseline GGUF; usar PyTorch MPS quando MLX nao existir; CPU apenas como fallback.
- TTS local: sempre atraves de adapters e sidecars/processos supervisionados pelo main process. Renderer nunca chama Python, Swift, MLX, PyTorch, ffmpeg ou modelos diretamente.

## Fronteiras de Arquitetura

- Renderer nunca acessa banco, filesystem privilegiado, segredos, `node-llama-cpp` ou APIs nativas diretamente.
- Renderer fala com o backend local apenas via preload seguro e IPC validado por Zod.
- Main process concentra acesso a banco, filesystem, segredos, runtime local, workers, sidecars de IA, gerenciador de vozes e montagem de audiobooks.
- Conteudo EPUB/HTML deve ser tratado como nao confiavel. Nao exponha `file://` direto, nao exponha APIs do preload para iframes de conteudo, e bloqueie scripts/navegacao externa por padrao.
- O renderer deve consumir apenas clientes/contratos de IPC. Nao importe services do main process no renderer.
- Use `NarrationPlan` como contrato canonico entre normalizacao/prosodia e TTS. Nao espalhe tags proprietarias de Qwen, F5 ou outro motor pela UI ou por services genericos.
- Vozes clonadas devem ser tratadas como `VoiceProfile` + bindings por engine/adapter. Uma voz so aparece como disponivel quando houver binding compativel e consentimento confirmado.
- M4B e artefato derivado. Capitulos de audio, manifestos e metadados sao a fonte canonica. Atualize M4B por rebuild atomico a partir de manifesto, nao por append in-place.


## i18n

- Nunca escreva textos de produto diretamente no codigo.
- Todo texto visivel ao usuario deve passar por i18n:
  - labels;
  - botoes;
  - menus;
  - placeholders;
  - tooltips;
  - mensagens de erro;
  - mensagens de sucesso;
  - status de jobs;
  - comandos;
  - estados vazios;
  - dialogs;
  - notificacoes.
- Idioma padrao: `pt-BR`.
- Idiomas iniciais: `en`, `pt-BR`.
- Mensagens do backend que aparecem na UI tambem devem usar i18n.
- Strings tecnicas podem ficar no codigo quando forem ids, enums, nomes de tabelas, rotas internas, event names ou constantes de protocolo.

## UX e Frontend

- Construa a experiencia real, nao landing pages.
- Use componentes `shadcn/ui` e Tailwind CSS 4.
- Use icons em botoes de ferramentas quando fizer sentido.
- Use controles adequados:
  - toggles/checkboxes para booleanos;
  - selects/menus para opcoes;
  - tabs para views;
  - inputs/sliders/steppers para numeros;
  - tooltips para icones nao obvios.
- Nao coloque texto de produto hardcoded dentro de componentes.
- Evite UI dominada por uma unica familia de cor.
- Garanta que texto nao sobreponha outros elementos.
- Garanta dimensoes estaveis para toolbars, listas, grids, boards, botoes e tiles.
- Prefira telas densas, claras e utilitarias. Este e um app de conhecimento, nao uma pagina de marketing.
- Teste componentes importantes em estados vazios, carregando, erro e sucesso.

## Banco, Drizzle e Migrations

- Toda mudanca de schema Drizzle exige nova migration via:

```bash
npm run db:generate
```

- Apos gerar migration, aplique pelo fluxo padrao do projeto.
- Nao considere a task concluida apenas porque `db:migrate` terminou sem erro.
- Verifique explicitamente no banco real:
  - historico em `drizzle.__drizzle_migrations`;
  - estrutura alterada em `information_schema` ou consulta direta na tabela afetada;
  - indices, constraints, tipos e extensoes quando aplicavel.
- Inclua no resumo final quais verificacoes foram feitas.
- Use repositorios do modulo de banco do projeto; nao espalhe SQL ad hoc pela UI ou services.
- Dimensoes de embeddings diferentes devem ficar separadas por configuracao/indice.
- PGlite/Drizzle e fonte canonica local no MVP. Arquivos derivados, como audio, voz processada e M4B, ficam no filesystem com metadados no banco.

## Jobs e Workers

- Processamento pesado deve rodar em `worker_threads`.
- Inferencia de TTS/LLM e processos de audio podem rodar em sidecars supervisionados pelo main process quando isso for exigido pelo runtime ou pela performance.
- Jobs devem ser persistidos no banco.
- Jobs devem suportar:
  - status;
  - progresso;
  - erro;
  - cancelamento quando possivel;
  - retry simples quando fizer sentido.
- UI deve acompanhar jobs sem bloquear.
- Workers nao devem acessar UI.
- Payloads de workers devem ser validados por Zod quando cruzarem fronteiras.
- Jobs pesados de LLM/TTS devem respeitar o governador de recursos, especialmente em Apple Silicon. Nao rode inferencias pesadas em paralelo sem justificativa e benchmark.
- Falha de montagem M4B nao deve invalidar o audio de capitulo ja gerado.


## Testes

- Criar testes de regressao sempre que pertinente.
- Preferir testes de:
  - dominio;
  - contratos Zod;
  - repositorios;
  - services;
  - workers;
  - adapters;
  - composicao de componentes;
  - fluxos sem GUI manual.
- Testes baseados em GUI so quando a natureza do problema exigir.
- Para adapters, sidecars e motores locais, testar contratos com mocks quando possivel.
- Para migrations, sempre testar aplicacao e verificacao real no banco.

## Seguranca e Privacidade

- Nao logar segredos.
- Nao armazenar API keys em texto puro no banco.
- Validar todos os payloads externos.
- Canais IPC, sidecars e qualquer interface local devem autenticar/autorizar ou limitar clientes quando aplicavel.
- Rejeitar paths inseguros.
- Respeitar politicas de privacidade local/remoto do perfil ativo.
- Nao enviar conteudo a provedor remoto se o perfil/tarefa exigir offline.
- Livros, marcacoes, audios, vozes clonadas, samples de referencia e manifests de M4B devem permanecer locais por padrao.
- Nao incluir livros, audios, samples de voz, embeddings de voz ou vozes clonadas em logs, diagnosticos ou exports tecnicos sem confirmacao explicita do usuario.
- Voice cloning exige consentimento explicito registrado antes da voz ficar disponivel para geracao.

## Entrega de Cada Etapa

Ao terminar uma etapa, informe:

- arquivos criados/alterados;
- comandos executados;
- testes executados;
- migrations geradas;
- verificacao pos-migration feita;
- pendencias;
- se esta pronto para commit.

Nao faca commit automaticamente.
