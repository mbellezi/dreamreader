# Especificacao de Produto

## Visao

DreamReader e um leitor de ebooks desktop, local-first, com uma experiencia de leitura caprichada para portugues do Brasil e um pipeline offline para transformar capitulos em audio usando modelos TTS locais escolhidos pelo usuario.

O produto deve funcionar bem como leitor tradicional antes de tentar ser uma ferramenta de IA. A geracao de audio entra como uma extensao natural da biblioteca e do leitor, nao como uma tela separada ou experimental demais.

## Publico

- Leitores que mantem uma biblioteca local de livros digitais.
- Pessoas que alternam leitura visual e audio.
- Estudantes e pesquisadores que fazem marcacoes, notas e revisitam trechos.
- Usuarios brasileiros que querem bom tratamento de PT-BR em UI, busca, ordenacao, segmentacao e pronuncia.

## Objetivos

- Ler EPUB com boa navegacao, progresso, sumario, marcacoes e retomada de posicao.
- Suportar formatos textuais simples desde cedo: `.txt`, `.md` e `.html`.
- Manter biblioteca local com metadados, capas, colecoes, tags, busca e filtros.
- Salvar progresso por livro, posicao por capitulo, marcacoes, notas e favoritos.
- Gerar audio por capitulo com modelos TTS locais, em fila, com retomada e cache.
- Permitir escolha de motor/voz por livro ou por capitulo.
- Criar, gerenciar e reutilizar vozes locais por voice cloning, com consentimento explicito e compatibilidade por motor.
- Gerar um audiobook M4B por livro conforme os capitulos forem sintetizados.
- Usar um LLM local pequeno para produzir instrucoes estruturadas de prosodia, emocao e ritmo para o TTS.
- Tratar portugues do Brasil como idioma de primeira classe.

## Estado Atual

As fases 0, 1, 2 e 3 estao implementadas. O produto atual e um MVP leitor desktop local-first com audio local basico e prosodia expressiva estruturada:

- App Electron com preload seguro, IPC validado por Zod, PGlite/Drizzle e biblioteca interna em `userData`.
- Importacao de EPUB, TXT, Markdown e HTML por seletor nativo.
- Extracao de metadados basicos, sumario, capitulos legiveis e capa EPUB quando disponivel.
- Lista/grid da biblioteca com busca simples por metadados.
- Leitor com fluxo continuo ou paginado, preferencias visuais, sumario, progresso, retomada de posicao e modo limpo.
- Marcacoes coloridas, notas e favoritos com ancoragem por paragrafo/offset.
- Exportacao de anotacoes em Markdown/JSON no main process; a UI atual expoe Markdown.
- Configuracoes iniciais de idioma, aparencia e preferencias do leitor.
- Fallback renderer com dados de exemplo quando o app roda sem bridge Electron.
- Fila TTS persistente por capitulo, segmentacao/normalizacao PT-BR basica, adapter local WAV, cache de audio, player por capitulo e export M4B real a partir dos capitulos prontos.
- Narracao expressiva opcional com analisador local estruturado, cache de prosodia por segmento, fallback neutro validado por Zod e comparacao entre audio neutro e expressivo na UI.

Ainda planejado:

- Busca no texto completo, filtros avancados, tags/colecoes completas e monitoramento de pastas.
- Runtime GGUF/MLX real para prosodia, TTS neural local, adapters Qwen/F5, voice cloning persistente e empacotamento M4B avancado com capa/metadados finais.

## Nao-objetivos iniciais

- DRM, LCP, Kindle DRM ou remocao/conversao de protecoes.
- Sincronizacao em nuvem.
- Loja, catalogo remoto ou social reading.
- Conversao completa de MOBI/AZW no MVP.
- Editor de EPUB.
- Audiobooks comerciais ou distribuicao publica de vozes geradas.

## Funcionalidades do Leitor

### Biblioteca

- Importar arquivos por seletor, drag-and-drop e pasta monitorada opcional.
- Calcular hash de conteudo para evitar duplicatas.
- Extrair metadados: titulo, autores, idioma, editora, data, identificadores e capa.
- Permitir corrigir metadados manualmente.
- Organizar por colecoes, tags, autores, idioma, status e progresso.
- Buscar por titulo, autor, tags, notas e texto extraido quando disponivel.

### Leitura

- Abrir livro a partir da ultima posicao salva.
- Navegar por sumario, pagina/progressao, capitulo anterior/proximo e busca interna.
- Ajustar fonte, tamanho, largura da coluna, espacamento, margens, alinhamento, tema e hifenizacao.
- Suportar temas claro, escuro, sepia e alto contraste.
- Salvar posicao usando locator persistente, nao apenas indice visual de pagina.
- Criar marcacoes coloridas, notas, favoritos e tags em trechos.
- Exportar notas e marcacoes em Markdown/JSON.

### Formatos

- MVP: EPUB, TXT, Markdown e HTML local.
- Beta: PDF com um fluxo separado, usando visualizacao por paginas e anotacao limitada.
- Futuro: CBZ/CBR, OPDS e possivel conversao de formatos via ferramenta opcional, desde que licenca e empacotamento permitam.

## Portugues do Brasil

O app deve ter PT-BR como lingua principal da UI e do pipeline de texto:

- UI em PT-BR desde o inicio.
- Ordenacao e busca tolerantes a acentos.
- Deteccao e armazenamento de idioma por livro/capitulo.
- Segmentacao de texto que respeite abreviacoes comuns: "Sr.", "Sra.", "Dr.", "Dra.", "etc.", "p.ex.".
- Normalizacao TTS para numeros, datas, horas, moedas, porcentagens, ordinais e siglas.
- Tratamento de travessao, aspas brasileiras, dialogos e elipses.
- Dicionario de pronuncia editavel pelo usuario por livro e globalmente.
- Preservacao de nomes proprios e termos estrangeiros quando a normalizacao puder piorar a fala.

## Audio e TTS

### Motores planejados

- Qwen3-TTS 12Hz 0.6B: opcao mais leve/rapida.
- Qwen3-TTS 12Hz 1.7B: opcao de maior qualidade.
- F5-TTS-pt-br: opcao especializada em portugues brasileiro.

Cada motor deve ser exposto por um adapter com capacidades declaradas. Exemplo: suporte a voz customizada, instrucao textual, emocao discreta, lote, streaming, GPU, CPU e formato de saida.

### Fluxo de audio

- Usuario escolhe livro, capitulo, motor, voz/perfil e qualidade.
- O app quebra o capitulo em segmentos estaveis.
- Um analisador local ou LLM local gera instrucoes estruturadas para cada segmento.
- O adapter do motor traduz essas instrucoes para o formato aceito pelo modelo.
- O TTS gera arquivos por segmento e depois um arquivo de capitulo.
- Ao concluir um capitulo, o app atualiza o M4B parcial do livro em segundo plano.
- O player salva progresso de audio e mantem alinhamento aproximado com o texto.

### Gerenciador de Vozes

- Listar vozes embutidas de cada motor.
- Criar vozes clonadas a partir de audio de referencia e transcricao.
- Validar idioma, duracao minima, qualidade do audio e compatibilidade com o motor.
- Salvar vozes como perfis locais reutilizaveis.
- Mostrar uma voz clonada no seletor apenas quando o adapter do motor conseguir usa-la.
- Permitir nome, descricao, idioma, motor preferido, etiquetas e preview curto.
- Permitir excluir voz e todos os assets de referencia associados.
- Permitir duplicar/adaptar uma voz para outro motor quando o adapter suportar conversao ou novo embedding.

### Vozes, consentimento e seguranca

Se houver clonagem de voz ou uso de audio de referencia, a UI deve deixar claro que o usuario e responsavel por usar somente vozes autorizadas. O app deve manter esses arquivos locais, com exclusao simples e sem upload automatico.

O gerenciador de vozes deve registrar data de confirmacao de consentimento, origem do audio de referencia, motor usado, arquivos associados e escopo de uso local. Perfis de voz clonados nao devem ser exportados junto com logs ou diagnosticos.

### Audiobook M4B

- Cada livro pode ter um arquivo M4B parcial e um arquivo M4B final.
- O M4B parcial e atualizado conforme capitulos ficam prontos.
- O arquivo deve incluir metadados basicos: titulo, autores, capa, idioma, duracao e marcadores de capitulo.
- O app deve manter manifestos por capitulo para conseguir reconstruir o M4B se qualquer audio, voz, motor ou ordem de capitulos mudar.
- A atualizacao do M4B deve ser atomica: gerar em arquivo temporario, validar, e substituir o draft anterior.
- Se um capitulo for regerado, o M4B deve ser marcado como desatualizado e remontado em segundo plano.
- O usuario deve poder pausar/desativar a montagem automatica de M4B por livro.

## Requisitos Nao Funcionais

- Offline-first: leitura, biblioteca, TTS e LLM devem funcionar sem rede depois que modelos/dependencias estiverem instalados.
- Privacidade: livros, marcacoes, vozes e audios gerados ficam no dispositivo.
- Resiliencia: jobs de TTS devem ser retomaveis apos fechar o app.
- Performance: importacao, indexacao e TTS nao podem travar a UI.
- Segurança: conteudo de livros e arquivos importados devem ser tratados como nao confiaveis.
- Portabilidade: arquitetura preparada para macOS, Windows e Linux, mesmo que o primeiro ambiente de desenvolvimento seja macOS.
