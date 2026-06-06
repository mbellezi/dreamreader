# Abstracoes de TTS e Prosodia

## Objetivo

Padronizar conversao para TTS, analise de emocao/prosodia e troca de modelos. O app deve depender de contratos internos, nao de APIs especificas de Qwen, F5 ou qualquer runtime futuro.

## Camadas

```text
Texto do livro
  -> TextExtractor
  -> PtBrNormalizer
  -> ProsodyAnalyzer
  -> NarrationPlan
  -> VoiceManager
  -> TtsAdapter
  -> AudioSegmentStore
  -> ChapterAudioAssembler
  -> AudiobookAssembler
```

## Contratos

### `PtBrNormalizer`

Responsavel por transformar texto original em texto falavel.

```ts
type PtBrNormalizer = {
  normalize(input: NormalizeInput): Promise<NormalizeResult>
}
```

Regras:

- Deterministico.
- Versionado.
- Nao depende de LLM.
- Usa dicionario global e por livro.
- Retorna mapa entre texto original, texto normalizado e locator.

### `ProsodyAnalyzer`

Responsavel por sugerir emocao, ritmo, intensidade, pausas e papel de voz.

```ts
type ProsodyAnalyzer = {
  id: string
  analyze(input: ProsodyInput): Promise<ProsodyResult>
}
```

Implementacoes:

- `neutral-prosody`: regras por pontuacao, sem LLM.
- `llm-prosody-gguf`: `node-llama-cpp` + Metal/GGUF.
- `llm-prosody-mlx`: sidecar MLX para Apple Silicon, se aprovado em benchmark.

Regras:

- Nunca altera texto.
- Retorna JSON validado por Zod.
- Falha vira prosodia neutra.
- Output e cacheado por segmento.

### `NarrationPlan`

Formato canonico entre prosodia e TTS.

```ts
type NarrationPlan = {
  schemaVersion: "narration-plan/v1"
  source: {
    bookId: string
    chapterHref: string
    contentHash: string
    language: string
  }
  normalization: {
    normalizerId: string
    version: string
    dictionaryVersion: string
  }
  prosody: {
    analyzerId: string
    version: string
    promptVersion?: string
  }
  segments: NarrationSegment[]
}
```

Este plano e o principal contrato de interoperabilidade. Um adapter novo so precisa aceitar `NarrationPlan` e declarar capacidades.

### `TtsAdapter`

Responsavel por traduzir o plano canonico para um motor real.

```ts
type TtsAdapter = {
  id: string
  getCapabilities(): Promise<TtsEngineCapabilities>
  prepare(model: ModelAsset, voice: VoiceProfile): Promise<void>
  synthesize(input: TtsSynthesisInput): AsyncIterable<TtsProgressEvent>
  cancel(jobId: string): Promise<void>
  dispose(): Promise<void>
}
```

Regras:

- Adapter nao acessa UI.
- Adapter nao decide fila global.
- Adapter pode ignorar campos nao suportados, mas precisa logar.
- Adapter retorna eventos de progresso por segmento.
- Adapter deve ser testavel com fixtures de `NarrationPlan`.
- Adapter declara se consegue criar ou usar voice cloning.

### `VoiceManager`

Responsavel por criar, listar, validar e excluir vozes disponiveis.

```ts
type VoiceManager = {
  listVoices(filter: VoiceFilter): Promise<VoiceProfile[]>
  listCompatibleVoices(engineId: string): Promise<VoiceProfile[]>
  createFromReference(input: VoiceCloneInput): AsyncIterable<VoiceCloneEvent>
  createBinding(input: VoiceBindingInput): AsyncIterable<VoiceCloneEvent>
  preview(voiceProfileId: string, engineId: string): Promise<AudioAsset>
  deleteVoice(voiceProfileId: string): Promise<void>
}
```

Regras:

- Uma voz e um perfil canonico; o uso por motor depende de bindings.
- Voz clonada precisa de consentimento confirmado antes de ficar disponivel.
- Voz sem binding compativel aparece como indisponivel para aquele motor, nao como erro.
- Preview usa texto curto padrao em PT-BR e fica cacheado.

### `AudiobookAssembler`

Responsavel por transformar capitulos gerados em um M4B de livro.

```ts
type AudiobookAssembler = {
  updateManifest(input: ChapterAudioReady): Promise<AudiobookManifest>
  buildDraft(bookId: string): AsyncIterable<AudiobookBuildEvent>
  buildFinal(bookId: string): AsyncIterable<AudiobookBuildEvent>
  markStale(bookId: string, reason: string): Promise<void>
}
```

Regras:

- Usa capitulos prontos como fonte; nao depende dos segmentos originais para montar o M4B.
- Atualiza M4B parcial por rebuild atomico, nao por append in-place.
- Mantem marcadores de capitulo e metadados do livro.
- Falha na montagem nao invalida audio de capitulos.
- Qualquer alteracao em voz, engine, ordem, capa ou metadados marca o export como `stale`.

## Mapeamento de Prosodia

O app usa categorias semanticas pequenas:

- emocao: `neutral`, `warm`, `tense`, `sad`, `joyful`, `angry`, `suspense`, `formal`
- ritmo: `slow`, `normal`, `fast`
- pitch: `low`, `neutral`, `high`
- intensidade: `0..1`
- pausa antes/depois em ms

Cada adapter converte isso:

- Modelo com instrucao natural: gerar frase curta de instrucao.
- Modelo com tags discretas: mapear para tag mais proxima.
- Modelo sem controle emocional: ignorar com log `unsupported_prosody_field`.
- Modelo com voz de referencia: preservar prosodia discreta e priorizar consistencia de voz.

## Manifesto de Adapter

Cada adapter deve ter um manifesto:

```json
{
  "adapterId": "qwen3-tts-mlx",
  "displayName": "Qwen3-TTS MLX",
  "runtime": "mlx",
  "modelFormats": ["mlx"],
  "languages": ["pt-BR", "pt", "en"],
  "capabilities": {
    "voiceClone": true,
    "naturalLanguageInstruction": true,
    "discreteEmotion": true,
    "batch": true,
    "streaming": true,
    "segmentTimestamps": false
  }
}
```

O app registra adapters por manifesto e healthcheck. Isso permite trocar implementacao Python por Swift/MLX sem mudar a UI.

## Testes de Contrato

Todo adapter precisa passar por fixtures:

- narracao neutra PT-BR
- dialogo com travessao
- numeros, datas, moeda e siglas
- emocao intensa que deve ser suavizada
- campo de prosodia nao suportado
- voz clonada compativel e voz clonada incompativel com o motor
- cancelamento no meio de um lote
- retomada usando cache parcial
- rebuild M4B apos novo capitulo
- rebuild M4B apos regerar capitulo com outra voz

Saidas esperadas:

- audio ou evento mockado por segmento
- manifesto de duracoes
- manifesto M4B com capitulos e metadados
- logs estruturados
- nenhum acesso ao renderer

## Beneficio Arquitetural

Com essa divisao:

- Trocar Qwen3 0.6B por 1.7B muda modelo/configuracao, nao pipeline.
- Trocar PyTorch por MLX muda adapter/runtime, nao UI.
- F5-TTS-pt-br pode ter regras especificas sem contaminar o restante.
- Vozes clonadas viram perfis reutilizaveis e nao ficam presas a uma tela de geracao.
- O M4B do livro e reconstruivel a partir de capitulos e manifestos.
- O LLM de prosodia pode ser desligado sem quebrar TTS.
- O cache continua valido por versoes claras de normalizador, prosodia, adapter e modelo.
