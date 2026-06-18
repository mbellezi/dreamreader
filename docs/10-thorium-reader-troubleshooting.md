# Leitor Thorium/Readium - Armadilhas e Diagnostico

Este documento registra descobertas nao obvias sobre o leitor de EPUB
(`@edrlab/thorium-web` + `@readium/navigator`) que ja causaram o bug
"leitor preso na capa, sem paginacao e sem navegacao pelo Sumario".

Leia antes de mexer em:

- `src/renderer/components/thorium/ThoriumReaderPane.tsx`
- `src/renderer/main.tsx` (montagem do React)
- `src/main/protocol/asset-protocol.ts` (protocolo `dreamreader://` + manifesto/positions)
- CSP em `src/renderer/index.html`

## Como o leitor funciona (modelo mental)

- Cada recurso do spine e renderizado num `<iframe>` cujo conteudo e uma URL
  `blob:` montada por `FrameBlobBuilder` (NAO carrega `dreamreader://` direto no
  iframe). O blob herda a origem do renderer, entao o iframe fica **same-origin**
  com o app.
- O Readium dirige esse iframe a partir do realm do pai (renderer) via acesso
  direto ao DOM (`contentWindow.addEventListener`, `contentDocument`). Por isso o
  iframe precisa ser same-origin e manter `sandbox="allow-same-origin allow-scripts"`.
- A paginacao em colunas e os comandos `go_next`/`go_prev`/`go()` sao
  implementados pelos *injectables* (`ColumnSnapper` etc.). Se eles nao montam,
  a navegacao silenciosamente para de funcionar.
- Os dados de navegacao (`readingOrder`, `toc`, `positions`) vem do manifesto
  Readium reescrito em `asset-protocol.ts`, todos como
  `dreamreader://publication/<id>/resource/<path>`. O casamento de href e
  comparacao exata de string (`Link.findWithHref`), e ja foi verificado correto.

## Bug 1 - sandbox sem `allow-scripts`

Um patch (`installReadiumIframeSandboxPatch`) forcava
`sandbox="allow-same-origin"` nos iframes `.readium-navigator-iframe`, removendo
`allow-scripts`. Sem scripts, os injectables nao montam -> paginacao morta,
clique no Sumario nao sai da capa. A capa ainda aparece porque imagem e
renderizacao nativa do iframe, que nao depende de script.

**Regra:** nunca re-sandbox os iframes de conteudo do Readium para tirar
`allow-scripts`. Isso conflita com "EPUB e nao confiavel" do `RULES.md`, mas o
Readium exige scripts no conteudo; e um trade-off inerente ao leitor escolhido.
O proprio Readium injeta uma CSP restritiva dentro do blob.

## Bug 2 - React StrictMode duplica o navigator (o que realmente prendia na capa)

Com `<StrictMode>` em `main.tsx`, em **desenvolvimento** o React monta o leitor
duas vezes. Resultado: `EpubNavigator.load()` roda 2x e **dois navigators**
acrescentam iframes no **mesmo container**. O navigator orfao deixa o iframe da
capa `visibility:visible` por cima, escondendo o navigator que funciona embaixo.
A navegacao funciona internamente (`currentLocator` muda), mas a tela nunca muda.

So acontece em dev (StrictMode nao re-invoca efeitos em build de producao). O
teardown do `StatefulReaderWrapper` nao e nosso para corrigir.

**Correcao aplicada:** remover `<StrictMode>` em `src/renderer/main.tsx`
(ver comentario no arquivo). Nao readicionar sem antes garantir que o leitor
sobrevive a montagem dupla.

## Como diagnosticar problemas de navegacao

1. **`ColumnSnapper Mounted` no console do renderer** - se nao aparece, os
   injectables nao montaram (suspeite de sandbox/scripts/origem).
2. **Conte `EpubNavigator.load()`** - tem que ser 1 por livro aberto. 2 = montagem
   dupla (StrictMode/remontagem).
3. **Conte iframes visiveis** - `document.querySelectorAll('iframe.readium-navigator-iframe')`
   com `visibility:visible` deve ser exatamente 1.
4. **Verifique o iframe VISIVEL, nao so o `currentLocator`** - chamar
   `navigator.goForward()` e olhar `currentLocator` engana: ele avanca
   internamente mesmo com a capa orfa cobrindo a tela. Confira o conteudo
   (`contentDocument.body.textContent`) do iframe visivel.
5. Para reproduzir sem tela, da para abrir o leitor por codigo (default view +
   `selectedBook`) e instrumentar `EpubNavigator.prototype`. Sempre **remova a
   instrumentacao** ao terminar.

## Banco PGlite de desenvolvimento e fragil

- O DB de dev fica em `.dreamreader-dev/db/pglite`.
- Ele corrompe (`Aborted(). Build with -sASSERTIONS`) se o Electron for morto
  (SIGKILL/SIGTERM) no meio de uma escrita, ou se outro processo Node abrir o
  mesmo diretorio enquanto o app roda. Hoje o app **nao fecha o PGlite no quit**
  (`src/main/index.ts` nao tem `before-quit`) - melhoria recomendada.
- Escritas de posicao de leitura acontecem a cada virada de pagina; testes que
  navegam por codigo geram essas escritas. Para testar com seguranca, evite
  matar o app logo apos navegar.
- **Recuperacao** (perde so o DB; os EPUBs ficam em
  `~/Library/Application Support/DreamReader/library/books/<sha256>.epub`):
  mova o diretorio corrompido para o lado, rode `npm run db:migrate` e reinsira
  as linhas de `books`. O nome do arquivo (hex) E o `content_hash`. O leitor
  serve o conteudo direto do zip via `library_path`, entao so a linha de `books`
  e necessaria para ler (nao precisa de `assets`). O `manifest_json` armazenado
  (campo `readiumManifest`) usa hrefs relativos, independente do id do livro.

## Pendencias conhecidas (fora do escopo do bug original)

- Fechar o PGlite no `before-quit` para evitar corrupcao em saidas abruptas.
- Fontes do Google (`fonts.googleapis.com`) sao bloqueadas pela CSP do leitor;
  cai em fonte do sistema. Preferir fontes empacotadas (alinhado ao local-first).
