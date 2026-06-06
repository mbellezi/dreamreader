# Roadmap

## Fase 0: Provas de Conceito

Objetivo: reduzir riscos antes de construir muita UI.

- Scaffold Electron com `electron-vite`, React, Tailwind 4 e shadcn/ui.
- IPC tipado com Zod entre renderer/preload/main.
- PGlite persistente em `userData` com Drizzle migration inicial.
- Importar um EPUB e extrair metadados/capa.
- Comparar Readium Web e `epub.js` para abrir EPUB local, salvar locator e criar highlight.
- Rodar `node-llama-cpp` no main process com um GGUF pequeno e resposta JSON validada.
- Rodar LLM de prosodia em dois caminhos no Mac: GGUF via `node-llama-cpp` + Metal e, se houver modelo pronto, MLX.
- Rodar TTS PT-BR em processo long-lived com Qwen3-TTS MLX e F5-TTS-pt-br via PyTorch MPS/CPU.
- Criar o contrato `NarrationPlan` + adapters TTS com schemas Zod.
- Criar POC de voice cloning: audio de referencia, transcricao, preview e voz disponivel no seletor.
- Criar POC de M4B: gerar dois capitulos curtos, montar M4B parcial, adicionar terceiro capitulo e remontar atomicamente.
- Medir RTF de TTS, tokens/s de LLM, cold start, memoria de pico e estabilidade termica em Apple Silicon.
- Validar que o governador de recursos impede TTS e LLM de rodarem inferencia pesada simultaneamente por padrao.

## Fase 1: MVP Leitor

- Biblioteca local com importacao de EPUB, TXT, Markdown e HTML.
- Lista/grid de livros com busca simples.
- Tela de leitura com sumario, temas, preferencias e retomada de posicao.
- Marcacoes, notas e favoritos.
- Persistencia local completa em PGlite.
- Exportacao basica de notas em Markdown.
- Configuracoes iniciais de idioma e aparencia.

## Fase 2: Audio Local Basico

- Fila de jobs de TTS por capitulo.
- Adapter inicial para uma engine TTS usando o contrato canonico.
- Segmentacao e normalizacao PT-BR basicas.
- Player de audio por capitulo.
- Cache de audio por capitulo.
- Cancelamento e retomada de jobs.
- Tela de diagnostico de modelos.
- Processo TTS long-lived com warmup e timeout de desalocacao.
- M4B parcial por livro usando capitulos ja gerados.

## Fase 3: Prosodia com LLM

- LLM local para gerar instrucoes estruturadas por segmento.
- Schema Zod para `NarrationPlan` e prosodia.
- Fallback neutro quando o LLM falhar.
- UI para ligar/desligar "narração expressiva".
- Comparacao de qualidade entre audio neutro e audio com instrucoes.
- Cache da analise de prosodia por segmento.

## Fase 4: Multi-engine TTS

- Adapter Qwen3-TTS 0.6B.
- Adapter Qwen3-TTS 1.7B.
- Adapter F5-TTS-pt-br.
- Tabela de capacidades por adapter e runtime: MLX, PyTorch MPS, CPU fallback.
- Seletor de motor por livro/capitulo.
- Perfis de voz.
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
