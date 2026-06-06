# Audiobook M4B

## Objetivo

Criar um arquivo M4B por livro conforme os audios dos capitulos forem sendo gerados. O usuario deve poder ouvir/exportar um audiobook parcial enquanto o restante do livro ainda esta em fila.

## Principios

- O M4B e derivado, nao fonte canonica.
- A fonte canonica sao os capitulos de audio, manifestos e metadados no banco.
- Atualizacao deve ser atomica: criar arquivo temporario, validar e substituir.
- Falha de montagem M4B nao invalida audio de capitulo.
- O app deve conseguir reconstruir o M4B a qualquer momento.

## Fluxo

1. TTS conclui um capitulo.
2. O capitulo e salvo como asset de audio com duracao, codec, voz, engine e hash.
3. `audiobook_chapters` e atualizado.
4. `audiobook_exports.stale` vira `true`.
5. Se auto-build estiver ligado, o assembler entra na fila.
6. O assembler cria um M4B temporario com capitulos prontos.
7. O app valida duracao, capitulos e metadados.
8. O arquivo temporario substitui o draft anterior.
9. Se todos os capitulos selecionados estiverem prontos, o export pode ser marcado como final.

## Parcial vs Final

### M4B Parcial

- Contem apenas capitulos ja gerados.
- Pode ser substituido varias vezes.
- Deve exibir claramente que esta incompleto.
- Deve manter marcadores de capitulo para os capitulos incluidos.

### M4B Final

- Contem todos os capitulos selecionados.
- Deve ser estavel ate audio, voz, motor, capa, ordem ou metadados mudarem.
- Pode ser reconstruido manualmente pelo usuario.

## Metadados

Campos minimos:

- titulo
- autores
- idioma
- capa
- data de geracao
- engine TTS
- voz/perfil
- duracao total
- capitulos com titulo, inicio e fim

Campos opcionais:

- subtitulo
- editora
- ano de publicacao
- descricao
- narrador/voz
- comentario sobre geracao local

## Codec e Container

Direcao inicial:

- Intermediario: WAV por segmento para debug e montagem.
- Capitulo: M4A/AAC quando encoder estiver disponivel.
- Livro: M4B com AAC e chapter markers.

Se o encoder/empacotamento nao estiver pronto no MVP, o app pode manter WAV/M4A por capitulo e deixar M4B como job pendente, sem bloquear a geracao de audio.

## Invalidacao

Marcar export como `stale` quando:

- capitulo for regerado;
- voz mudar;
- motor/modelo mudar;
- normalizador ou prosodia mudar e afetar audio;
- ordem de capitulos mudar;
- capa/metadados mudarem;
- encoder/configuracao de qualidade mudar.

## UI

- Mostrar status por livro: sem audio, parcial, desatualizado, completo, erro.
- Mostrar progresso: capitulos prontos/total e duracao pronta.
- Acao de reconstruir M4B.
- Toggle de auto-build por livro e global.
- Acao de abrir/revelar arquivo.
- Aviso quando o M4B parcial nao contem todos os capitulos.

## Jobs

Estados:

- `queued`
- `building`
- `validating`
- `completed`
- `failed`
- `cancelled`

Prioridade:

- Baixa por padrao.
- Nunca deve interromper leitura/player.
- Pode pausar se TTS precisar de CPU/IO.

## Testes

- Montar M4B com um capitulo.
- Atualizar M4B apos adicionar outro capitulo.
- Regerar um capitulo com outra voz e confirmar `stale`.
- Reconstruir final com capa e marcadores.
- Cancelar build sem corromper draft anterior.
- Simular falha de encoder e preservar capitulos de audio.
