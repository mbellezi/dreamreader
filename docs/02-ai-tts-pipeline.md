# Pipeline de IA e TTS

## Principios

- Geracao de audio deve ser uma fila retomavel, nao uma acao bloqueante.
- O texto original do livro deve ser preservado; normalizacoes para TTS ficam versionadas separadamente.
- Instrucoes de emocao/prosodia devem ser estruturadas, pequenas e auditaveis.
- Cada engine TTS declara suas capacidades, e o pipeline se adapta a elas.
- Para PT-BR, a qualidade da normalizacao do texto e tao importante quanto o modelo.
- A UI e o pipeline nao devem conhecer tags proprietarias de cada modelo. Eles produzem um plano canonico; adapters traduzem esse plano para Qwen, F5 ou outro motor.
- Em Apple Silicon, a geracao deve usar processos long-lived e modelos pre-aquecidos, preferindo MLX/Metal quando disponivel.

## Etapas

### 1. Extracao

Entrada:

- `bookId`
- `chapterHref` ou identificador equivalente
- texto bruto extraido do motor de leitura
- metadados de idioma

Saida:

- paragrafos e blocos com IDs estaveis
- texto limpo, mas ainda proximo ao original
- mapa entre texto original, texto normalizado e locator

### 2. Segmentacao

Objetivo: criar segmentos que sejam bons para TTS e bons para retomada.

Regras iniciais:

- Preferir quebras por paragrafo e frase.
- Evitar segmentos longos demais.
- Nao separar abreviacoes comuns de PT-BR.
- Preservar dialogos com travessao.
- Atribuir `segmentId` deterministico com base em livro, capitulo, indice e hash do texto.

### 3. Normalizacao PT-BR

Transformacoes candidatas:

- Numeros: `1984` pode virar "mil novecentos e oitenta e quatro" ou permanecer como titulo conforme contexto.
- Datas: `06/06/2026` vira "seis de junho de dois mil e vinte e seis".
- Horas: `14h30` vira "quatorze horas e trinta minutos".
- Moedas: `R$ 25,90` vira "vinte e cinco reais e noventa centavos".
- Porcentagens: `12%` vira "doze por cento".
- Ordinais: `1o`, `1º`, `primeiro`.
- Siglas: manter, soletrar ou expandir via dicionario.
- Abreviacoes: `Sr.` para "senhor", `Dra.` para "doutora", quando apropriado.

As regras devem ser configuraveis e versionadas. Mudancas de normalizacao invalidam apenas o cache de audio afetado.

### 4. Analise de Prosodia por LLM

O LLM recebe pequenos lotes de segmentos e retorna JSON validado.

Schema conceitual:

```json
{
  "segments": [
    {
      "segmentId": "string",
      "emotion": "neutral",
      "intensity": 0.2,
      "pace": "normal",
      "pitch": "neutral",
      "pauseAfterMs": 350,
      "instruction": "Tom calmo, narracao clara, sem exagero."
    }
  ]
}
```

Valores iniciais:

- `emotion`: `neutral`, `warm`, `tense`, `sad`, `joyful`, `angry`, `suspense`, `formal`.
- `pace`: `slow`, `normal`, `fast`.
- `pitch`: `low`, `neutral`, `high`.
- `intensity`: numero entre `0` e `1`.
- `pauseAfterMs`: numero entre `0` e `1500`.

Fallback: se o LLM falhar, usar `neutral`, `normal`, `neutral`, `0.2` e pausas baseadas em pontuacao.

### 4.1 Plano Canonico de Narracao

O resultado da normalizacao e da analise de prosodia vira um `NarrationPlan`. Este e o formato interno estavel do app, independente do modelo:

```ts
type NarrationPlan = {
  schemaVersion: "narration-plan/v1"
  bookId: string
  chapterHref: string
  language: "pt-BR" | string
  segments: NarrationSegment[]
}

type NarrationSegment = {
  segmentId: string
  locator: unknown
  originalText: string
  normalizedText: string
  voiceRole?: "narrator" | "dialogue" | "quote" | "heading"
  prosody: {
    emotion: "neutral" | "warm" | "tense" | "sad" | "joyful" | "angry" | "suspense" | "formal"
    intensity: number
    pace: "slow" | "normal" | "fast"
    pitch: "low" | "neutral" | "high"
    pauseBeforeMs: number
    pauseAfterMs: number
    instructionPtBr: string
  }
}
```

Regras:

- `NarrationPlan` e validado com Zod antes de chegar ao TTS.
- O LLM so pode preencher campos de prosodia e papel de voz; ele nao altera `normalizedText`.
- O texto normalizado vem de regras deterministicas e dicionario de pronuncia.
- O cache de audio depende da versao do plano, do adapter e do modelo.

### 5. Adapter de Engine TTS

Interface conceitual:

```ts
type TtsEngineCapabilities = {
  id: string
  displayName: string
  runtime: "mlx" | "metal" | "mps" | "pytorch" | "cpu" | "external"
  modelFormat: "mlx" | "gguf" | "safetensors" | "checkpoint" | "unknown"
  languages: string[]
  supportsVoiceClone: boolean
  supportsNaturalLanguageInstruction: boolean
  supportsDiscreteEmotion: boolean
  supportsBatch: boolean
  supportsStreaming: boolean
  supportsSegmentTimestamps: boolean
  supportsSsmlLikeMarkup: boolean
  preferredInputCase?: "lowercase" | "preserve"
  estimatedMemoryMb?: number
}
```

Cada adapter recebe:

- `NarrationPlan` ou lote de `NarrationSegment`
- idioma
- perfil de voz
- instrucoes de prosodia
- caminho de saida
- parametros de qualidade/performance

E retorna:

- audio por segmento
- duracao
- logs
- erro recuperavel ou fatal

O adapter e responsavel por mapear o plano canonico para o formato do modelo:

- Qwen3-TTS VoiceDesign: converter `instructionPtBr` para instrucao natural curta no idioma esperado/suportado.
- Qwen3-TTS CustomVoice: mapear emocao/ritmo para presets, quando houver.
- Qwen3-TTS Base: usar voz/referencia e ignorar campos nao suportados sem falhar.
- F5-TTS-pt-br: aplicar normalizacao recomendada, lower case quando necessario, referencias de voz/emocao e marcadores discretos se disponiveis.

Campos nao suportados nunca devem quebrar a geracao. Eles viram no-op com log estruturado.

### 6. Gerenciador de Vozes

O gerenciador de vozes fica acima dos adapters. Ele cria perfis canonicos e bindings especificos por engine.

Fluxo de criacao:

- Usuario escolhe motor alvo e informa nome da voz.
- Usuario adiciona audio de referencia autorizado.
- Usuario informa ou revisa a transcricao do trecho.
- O app valida idioma, ruido, duracao, formato e permissao de uso.
- O adapter cria um binding de voz: embedding, speaker reference, preset ou arquivos processados.
- O app gera um preview curto e salva o perfil como voz disponivel.

Regras:

- Voz clonada so aparece no seletor se existir binding compativel com o adapter ativo.
- Uma voz pode ter multiplos bindings para motores diferentes.
- A UI deve deixar claro quando uma voz e embutida, clonada, importada ou indisponivel para o motor atual.
- Excluir uma voz deve remover bindings, previews e referencias, salvo se o usuario optar por manter arquivos originais fora da biblioteca.
- Consentimento e origem do audio devem ser metadados obrigatorios para voice cloning.

### 7. Cache, Capitulos e M4B

Chave de cache por segmento:

- hash do conteudo do livro
- capitulo
- `segmentId`
- motor TTS
- versao do modelo
- perfil de voz
- versao da normalizacao
- versao do prompt/schema de prosodia

O capitulo final pode ser montado como:

- arquivos por segmento para alinhamento fino
- arquivo unico por capitulo para playback simples
- manifesto de duracoes para sincronizar texto e audio
- entrada de capitulo no manifesto M4B do livro

Formato de saida inicial:

- Gerar WAV intermediario.
- Exportar M4A/AAC por capitulo quando o empacotamento do encoder estiver resolvido.
- Gerar M4B parcial do livro a partir dos capitulos M4A/AAC prontos.
- Manter WAV opcional para debug, com limpeza automatica.

### 8. Montagem Incremental de M4B

Quando um capitulo termina:

- registrar duracao, codec, voz, engine, hash e ordem no manifesto do livro;
- marcar o M4B como `stale`;
- enfileirar job de montagem com prioridade baixa;
- gerar um novo M4B temporario a partir dos capitulos prontos;
- incluir capa, metadados e marcadores de capitulo;
- validar duracao e numero de capitulos;
- substituir atomicamente o M4B parcial anterior.

O M4B parcial representa "capitulos disponiveis ate agora". Ele nao precisa conter capitulos ainda nao gerados. Quando novos capitulos chegam, o assembler remonta o arquivo. Isso e mais seguro do que tentar append in-place em um container MP4.

## Fila de Jobs

Estados:

- `queued`
- `preparing`
- `analyzing`
- `synthesizing`
- `assembling`
- `updating_m4b`
- `completed`
- `failed`
- `cancelled`

Requisitos:

- Retomar job interrompido.
- Cancelar sem corromper cache ja gerado.
- Reexecutar segmentos falhos.
- Limitar concorrencia por engine.
- Expor progresso por capitulo e por segmento.
- Respeitar o governador de recursos para Apple Silicon: TTS e LLM pesados sao exclusivos por padrao.
- Manter modelo carregado enquanto houver jobs proximos, com timeout de desalocacao configuravel.
- Disparar atualizacao M4B apos capitulo concluido, se o livro estiver com auto-build habilitado.
- Separar falha de M4B de falha de TTS: audio do capitulo continua valido mesmo se a montagem M4B falhar.

## UI Esperada

- Acao "Gerar audio do capitulo".
- Escolha de motor, voz, qualidade e uso de instrucoes expressivas.
- Gerenciador de vozes com criacao por voice cloning, previews, compatibilidade e exclusao.
- Fila global de audio.
- Indicador de audio ja disponivel por capitulo.
- Indicador de M4B parcial/final por livro.
- Player com retomar de posicao.
- Opcao de excluir audio gerado por livro/capitulo.
- Opcao de reconstruir ou desativar M4B automatico.
- Dicionario de pronuncia global e por livro.

## Riscos Tecnicos

- Empacotamento de Python/PyTorch por plataforma.
- Tempo de inferencia em CPU.
- Contencao de memoria unificada/GPU entre LLM e TTS em Apple Silicon.
- Qualidade e uso autorizado de vozes clonadas.
- Rebuild de M4B pode ser caro em livros longos.
- Qualidade de PT-BR em textos com ortografia antiga, poesia, dialogos e nomes proprios.
- Instrucoes de prosodia podem piorar o audio se forem exageradas.
- Licenca de modelos pode limitar distribuicao comercial.

Mitigacao:

- Prototipar um capitulo curto com cada engine antes de fechar empacotamento.
- Comecar com instrucoes discretas e conservadoras.
- Salvar exemplos de regressao para PT-BR: dialogo, numeros, nomes, abreviacoes, poesia e texto academico.
- Medir RTF, memoria de pico, tempo de cold start e consumo termico percebido em Apple Silicon.
- Usar manifestos e substituicao atomica para M4B, mantendo capitulos individuais como fonte reconstruivel.
