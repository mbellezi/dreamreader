# POC Readium Web

## Objetivo

Avaliar se a stack Readium Web pode substituir ou reduzir o parser EPUB proprio do
DreamReader, principalmente nos casos em que NCX, spine, anchors e subnavegacao
geram capitulos incorretos.

Referencia oficial:

- https://readium.org/web/
- https://github.com/readium/cli
- https://github.com/readium/ts-toolkit

## Escopo testado

Esta POC usa o Readium CLI v0.8.0 como fronteira inicial, porque o comando
`readium manifest` gera um Readium Web Publication Manifest a partir de um EPUB.
Esse manifesto e a API estrutural que o `ts-toolkit`/navegador consome.

O binario nao foi adicionado ao repositorio. Para repetir localmente:

```bash
curl -L https://github.com/readium/cli/releases/download/v0.8.0/readium_darwin_arm64.tar.gz -o /tmp/readium_darwin_arm64.tar.gz
shasum -a 256 /tmp/readium_darwin_arm64.tar.gz
tar -xf /tmp/readium_darwin_arm64.tar.gz -C /tmp
READIUM_BIN=/tmp/readium npm run poc:readium
```

Checksum observado para o arquivo macOS arm64:

```text
640174ce14c81c66ae3122cd72fcf6ffcdd8aa2d97bc86a4643a5e8ad6b3ff0c
```

## Resultados

EPUBs locais testados:

| Arquivo | Reading order | TOC top-level | TOC total | Profundidade | Hrefs invalidos |
| --- | ---: | ---: | ---: | ---: | ---: |
| `Os astros sempre nos acompanham.epub` | 72 | 16 | 225 | 3 | 0 |
| `Seth Fala - Jane Roberts.epub` | 5 | 23 | 23 | 1 | 0 |
| `Corpus hermeticum graecum.epub` | 40 | 39 | 39 | 1 | 0 |
| `The Sacred Mushroom.epub` | 35 | 11 | 29 | 2 | 0 |

Observacoes:

- Readium preserva a hierarquia real do TOC. No livro dos astros, isso evita a
  falsa escolha entre "achatar tudo" e "usar so nivel 1".
- Readium mantem `readingOrder` separado do `toc`. Essa separacao e importante:
  o `readingOrder` representa a ordem de leitura do pacote; o `toc` representa a
  navegacao editorial.
- EPUBs Calibre-style com varios anchors no mesmo arquivo continuam bem
  representados: `Seth Fala` tem 5 itens no `readingOrder` e 23 entradas de TOC.
- A POC nao resolve sozinha a regra de "o que e capitulo de audio/leitura" no
  DreamReader. Ela fornece uma fonte estrutural melhor; ainda precisamos de uma
  politica nossa para transformar RWPM em capitulos do app.

## Leitura tecnica

Readium parece vantajoso como fonte canonica de estrutura EPUB:

- reduz heuristicas proprias de OPF/NCX/nav/spine;
- preserva hierarquia e anchors sem flattening destrutivo;
- gera um contrato padrao, o Readium Web Publication Manifest;
- abre caminho para usar `ts-toolkit`/navigator no renderer futuramente.

O custo de adocao nao e zero:

- o app atual persiste `ReaderManifest`, nao RWPM;
- TTS, anotacoes, progresso e recursos esperam `chapter.href` e conteudo HTML;
- para usar o navigator Readium no Electron, ainda sera necessario servir
  recursos locais com uma fronteira segura, sem `file://`.

## Proxima etapa recomendada

Criar um adapter experimental:

```text
EPUB local -> Readium manifest -> DreamReader ReaderManifest experimental
```

O adapter deve:

- preservar `readingOrder` e `toc` originais no `manifestJson`;
- mapear `readingOrder` para recursos navegaveis;
- derivar capitulos DreamReader a partir do TOC com politica explicita;
- manter fallback para o parser atual enquanto a POC amadurece;
- rodar testes com os quatro EPUBs reais e os EPUBs sinteticos existentes.
