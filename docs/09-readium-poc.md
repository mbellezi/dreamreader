# Readium Web POC

## Objective

Evaluate whether the Readium Web stack can replace or reduce DreamReader's custom EPUB parser, especially where NCX, spine, anchors, and sub-navigation produce incorrect chapters.

Official references:

- https://readium.org/web/
- https://github.com/readium/cli
- https://github.com/readium/ts-toolkit

## Tested Scope

This POC uses Readium CLI v0.8.0 as the initial boundary because the `readium manifest` command generates a Readium Web Publication Manifest from an EPUB. This manifest is the structural API consumed by `ts-toolkit`/the browser.

The binary was not added to the repository. To repeat locally:

```bash
curl -L https://github.com/readium/cli/releases/download/v0.8.0/readium_darwin_arm64.tar.gz -o /tmp/readium_darwin_arm64.tar.gz
shasum -a 256 /tmp/readium_darwin_arm64.tar.gz
tar -xf /tmp/readium_darwin_arm64.tar.gz -C /tmp
READIUM_BIN=/tmp/readium npm run poc:readium
```

Checksum observed for the macOS arm64 file:

```text
640174ce14c81c66ae3122cd72fcf6ffcdd8aa2d97bc86a4643a5e8ad6b3ff0c
```

## Results

Local EPUBs tested:

| File | Reading order | Top-level TOC | Total TOC | Depth | Invalid hrefs |
| --- | ---: | ---: | ---: | ---: | ---: |
| `Os astros sempre nos acompanham.epub` | 72 | 16 | 225 | 3 | 0 |
| `Seth Fala - Jane Roberts.epub` | 5 | 23 | 23 | 1 | 0 |
| `Corpus hermeticum graecum.epub` | 40 | 39 | 39 | 1 | 0 |
| `The Sacred Mushroom.epub` | 35 | 11 | 29 | 2 | 0 |

Observations:

- Readium preserves the real table-of-contents hierarchy. In the stars book, this avoids the false choice between flattening everything and using only level 1.
- Readium keeps `readingOrder` separate from `toc`. This distinction matters: `readingOrder` represents package reading order; `toc` represents editorial navigation.
- Calibre-style EPUBs with multiple anchors in one file remain well represented: `Seth Fala` has 5 `readingOrder` items and 23 TOC entries.
- The POC does not by itself resolve DreamReader's rule for what counts as a reading/audio chapter. It provides a better structural source; the app still needs its own policy for converting RWPM into chapters.

## Technical Reading

Readium appears advantageous as the canonical EPUB structure source:

- reduces custom OPF/NCX/nav/spine heuristics;
- preserves hierarchy and anchors without destructive flattening;
- generates a standard contract, the Readium Web Publication Manifest;
- opens a path to using `ts-toolkit`/navigator in the renderer later.

Adoption cost is not zero:

- the current app persists `ReaderManifest`, not RWPM;
- TTS, annotations, progress, and resources expect `chapter.href` and HTML content;
- using the Readium navigator in Electron still requires serving local resources through a secure boundary, without `file://`.

## Recommended Next Step

Create an experimental adapter:

```text
Local EPUB -> Readium manifest -> experimental DreamReader ReaderManifest
```

The adapter should:

- preserve the original `readingOrder` and `toc` in `manifestJson`;
- map `readingOrder` to navigable resources;
- derive DreamReader chapters from the TOC using an explicit policy;
- keep a fallback to the current parser while the POC matures;
- run tests with the four real EPUBs and existing synthetic EPUBs.
