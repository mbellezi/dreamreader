# Performance em Apple Silicon

## Objetivo

O app deve extrair a melhor performance possivel de Apple Silicon sem amarrar a arquitetura a um unico runtime. A politica e:

1. Preferir runtime nativo/otimizado para Apple Silicon quando estiver maduro.
2. Manter fallback estavel e simples.
3. Medir tudo no dispositivo do usuario/desenvolvimento antes de declarar um caminho como padrao.

## Ordem de Preferencia por Tipo de Modelo

### LLM de Prosodia

1. MLX com modelo pequeno quantizado, se houver modelo equivalente estavel e adapter pronto.
2. `node-llama-cpp` com GGUF + Metal.
3. CPU somente para diagnostico ou fallback.

Observacoes:

- O LLM de prosodia deve ser pequeno. Ele gera JSON curto, nao precisa de raciocinio longo.
- Usar batches de segmentos para reduzir overhead, mas manter contexto curto.
- Ativar prompt/schema caching quando o runtime permitir.
- Temperatura baixa e output estruturado reduzem repeticoes e retries.

### Qwen3-TTS

1. MLX, preferencialmente em processo long-lived.
2. Swift/MLX como alternativa futura se eliminar overhead de Python trouxer ganho claro.
3. PyTorch MPS/CUDA/CPU como fallback por plataforma.

Observacoes:

- Qwen3-TTS tem variantes 0.6B e 1.7B; o app deve tratar tamanho como configuracao de qualidade/performance.
- Benchmarks devem comparar 0.6B vs 1.7B, fp32/bf16/quantizado quando houver conversoes confiaveis.
- Nao assumir que menor dtype sempre e mais rapido em Apple Silicon; medir RTF e qualidade.

### F5-TTS-pt-br

1. PyTorch MPS se o grafo/opset rodar corretamente.
2. CPU fallback com aviso de performance.
3. MLX somente se surgir port/conversao confiavel e validada.

Observacoes:

- F5-TTS-pt-br e forte para PT-BR, mas pode ser o caminho mais dificil de acelerar.
- O adapter deve isolar dependencias e permitir substituir a implementacao sem mudar o pipeline.

## Processos Long-lived

Nao iniciar Python ou carregar modelo por segmento. Cada runtime pesado deve funcionar como sidecar:

- `start`: carrega runtime e modelo.
- `warmup`: roda uma inferencia curta descartavel.
- `synthesize` ou `analyze`: processa lote.
- `cancel`: interrompe job sem matar o processo quando possivel.
- `health`: retorna estado, memoria estimada e acelerador.
- `shutdown`: libera modelo apos timeout configuravel.

Timeout inicial sugerido:

- LLM: desalocar apos 2 a 5 minutos ocioso.
- TTS: desalocar apos 5 a 15 minutos ocioso, porque o custo de carregar modelo tende a ser maior.

## Governador de Recursos

Apple Silicon usa memoria unificada. Isso ajuda, mas tambem significa que UI, Electron, banco, LLM e TTS competem pelo mesmo orcamento fisico.

Politica inicial:

- Um job pesado por vez usando acelerador.
- TTS tem prioridade sobre LLM quando o usuario pediu audio explicitamente.
- Player, leitura e UI tem prioridade sobre qualquer job de background.
- Indexacao e normalizacao rodam em CPU com baixa prioridade.
- Ao detectar memoria baixa, pausar fila de TTS antes de degradar a UI.

Perfis:

- `quiet`: baixa concorrencia, pausas maiores, bom para bateria/fanless.
- `balanced`: padrao.
- `maximum`: usa o maximo aceitavel, com aviso de aquecimento/consumo.

## Metricas Obrigatorias

Registrar por runtime/modelo:

- `coldStartMs`: tempo ate o modelo responder.
- `warmStartMs`: tempo com modelo carregado.
- `peakMemoryMb`: memoria de pico.
- `rtf`: real-time factor para TTS.
- `tokensPerSecond`: LLM.
- `timeToFirstTokenMs`: LLM.
- `segmentsPerMinute`: pipeline completo.
- `failures`: erros por tipo.
- `accelerator`: `mlx`, `metal`, `mps` ou `cpu`.
- `deviceProfile`: chip, memoria, macOS e versoes de runtime.

Essas metricas devem alimentar `performance_profile_json` e a tela de diagnostico.

## Cache Para Performance

Cachear:

- Texto extraido por capitulo.
- Segmentacao.
- Normalizacao PT-BR.
- Analise de prosodia.
- Audio por segmento.
- Manifesto de duracoes.

Invalidar somente o que mudou:

- Mudou dicionario de pronuncia: normalizacao/prosodia/audio dos segmentos afetados.
- Mudou prompt/schema do LLM: prosodia/audio.
- Mudou motor/modelo/voz: audio.
- Mudou texto original: tudo do capitulo afetado.

## Empacotamento no macOS

- Modelos e runtimes ficam fora do ASAR.
- `node-llama-cpp` deve permanecer external no bundling.
- MLX/Python deve ser instalado por ambiente controlado ou runtime empacotado por plataforma.
- O gerenciador de modelos deve aceitar pastas locais ja baixadas.
- O app deve mostrar claramente qual runtime esta ativo: MLX, Metal/GGUF, MPS ou CPU.

## Provas de Conceito

Antes do MVP de audio:

- Benchmark LLM GGUF/Metal vs LLM MLX para gerar `NarrationPlan`.
- Benchmark Qwen3-TTS MLX 0.6B vs 1.7B em um trecho PT-BR.
- Benchmark F5-TTS-pt-br em PyTorch MPS e CPU.
- Testar um capitulo com dialogo, numeros, abreviacoes e acentos.
- Medir se rodar prosodia + TTS em paralelo piora o tempo total; a hipotese inicial e que serializar sera melhor para estabilidade.

