import { describe, expect, it } from "vitest"
import {
  extractPdfWithPdfJs,
  HeuristicPdfChapterAnalyzer,
  readerManifestFromPdfText,
  type PdfChapterAnalysisInput,
  type PdfChapterAnalysisResult,
  type PdfChapterAnalyzer
} from "../../src/main/services/pdf-importer"
import type { AppPaths } from "../../src/main/lib/paths"

const testPaths: AppPaths = {
  appRoot: "/tmp/dreamreader-test",
  audioCacheDir: "/tmp/dreamreader-test/audio-cache",
  audiobooksDir: "/tmp/dreamreader-test/audiobooks",
  backupsDir: "/tmp/dreamreader-test/backups",
  booksDir: "/tmp/dreamreader-test/books",
  coversDir: "/tmp/dreamreader-test/covers",
  dbDir: "/tmp/dreamreader-test/db",
  extractedDir: "/tmp/dreamreader-test/extracted",
  huggingFaceDir: "/tmp/dreamreader-test/huggingface",
  logsDir: "/tmp/dreamreader-test/logs",
  modelsDir: "/tmp/dreamreader-test/models",
  pythonDir: "/tmp/dreamreader-test/python",
  resourcesDir: "/tmp/dreamreader-test/resources",
  runtimeCacheDir: "/tmp/dreamreader-test/runtime-cache",
  runtimeDir: "/tmp/dreamreader-test/runtime",
  runtimeDownloadsDir: "/tmp/dreamreader-test/runtime-downloads",
  sidecarsDir: "/tmp/dreamreader-test/sidecars",
  userData: "/tmp/dreamreader-test/user-data",
  voicesDir: "/tmp/dreamreader-test/voices"
}

const attachedPdfPath = process.env.DREAMREADER_ATTACHED_PDF
const itWithAttachedPdf = attachedPdfPath ? it : it.skip

describe("PDF importer", () => {
  it("splits extracted PDF text into chapters and ignores table-of-contents entries", async () => {
    const manifest = await readerManifestFromPdfText({
      fallbackTitle: "Livro PDF",
      text: [
        "SUMARIO",
        "",
        "CAPITULO 1 ........ 4",
        "CAPITULO 2 ........ 18",
        "",
        "INTRODUCAO",
        "",
        "Texto introdutorio com contexto suficiente para a leitura.",
        "",
        "CAPITULO 1",
        "",
        "Texto do primeiro capitulo. A narrativa comeca aqui.",
        "",
        "CAPITULO 2",
        "",
        "Texto do segundo capitulo. A narrativa continua aqui."
      ].join("\n")
    })

    expect(manifest.format).toBe("pdf")
    expect(manifest.parser?.id).toBe("pdfjs-dist")
    expect(manifest.tableOfContents.map((item) => item.title)).toEqual([
      "INTRODUCAO",
      "CAPITULO 1",
      "CAPITULO 2"
    ])
    expect(manifest.chapters[0].content).toContain("Texto introdutorio")
    expect(manifest.chapters[0].content).not.toContain("CAPITULO 1 ........ 4")
    expect(manifest.chapters[1].content).toContain("Texto do primeiro capitulo")
    expect(manifest.chapters[1].content).not.toContain("Texto do segundo capitulo")
  })

  it("uses the injected local analyzer selection before the heuristic fallback", async () => {
    const analyzer: PdfChapterAnalyzer = {
      id: "test-local-ai",
      promptVersion: "test-prompt",
      version: "1",
      async analyze(input: PdfChapterAnalysisInput): Promise<PdfChapterAnalysisResult> {
        const selected = input.candidates.find((candidate) => candidate.title === "CAPITULO 2")
        return {
          analyzerId: this.id,
          chapters: selected ? [{ candidateIndex: selected.index, title: "Capitulo dois escolhido" }] : [],
          promptVersion: this.promptVersion,
          version: this.version
        }
      }
    }

    const manifest = await readerManifestFromPdfText({
      analyzerSource: analyzer,
      fallbackTitle: "Livro PDF",
      text: [
        "CAPITULO 1",
        "",
        "Texto do primeiro capitulo.",
        "",
        "CAPITULO 2",
        "",
        "Texto do segundo capitulo."
      ].join("\n")
    })

    expect(manifest.chapterSegmentation).toMatchObject({
      analyzerId: "test-local-ai",
      fallbackUsed: false,
      promptVersion: "test-prompt"
    })
    expect(manifest.tableOfContents.map((item) => item.title)).toEqual(["Capitulo dois escolhido"])
    expect(manifest.chapters[0].content).toContain("Texto do segundo capitulo")
    expect(manifest.chapters[0].content).not.toContain("Texto do primeiro capitulo")
  })

  it("uses academic article sections as chapters and reflows PDF line wraps", async () => {
    const manifest = await readerManifestFromPdfText({
      fallbackTitle: "project_muse_951894",
      text: [
        "Social Evolution between Spielrein, Freud, and Jung",
        "Ana Tomcic",
        "Published by Johns Hopkins University Press",
        "DOI:",
        "https://doi.org/10.1353/aim.2024.a951894",
        "[80.42.177.209]   Project MUSE (2026-06-30 02:50 GMT)",
        "",
        "American Imago, Vol. 81, No. 4, 523-545. © 2025 by Johns Hopkins University Press",
        "523",
        "Abstract: Apart from her much-discussed role in the",
        "personal and professional relationship between Carl",
        "Jung and Sigmund Freud, Sabina Spielrein is widely",
        "known for her 1912 paper, Destruction as the Cause",
        "of Becoming, in which she posits the existence of an",
        "instinct of destruction, seen by many as a precursor of",
        "Freud's death drive. Despite recent attempts to assess",
        "the differences between Spielrein's, Jung's, and Freud's",
        "drive theories, few scholars have noted that these psycho-",
        "analysts' conceptions of drives were inherently related",
        "to their political views, specifically to their perception",
        "of social and evolutional progress. A common universal",
        "narrative that appears in the work of all three analysts",
        "is the view that human society develops from egoism to",
        "altruism. While, in Jung's work, this teleology also led",
        "to the association between non-industrial societies and a",
        "lower degree of development, Spielrein was more careful",
        "about the appropriation of such socio-evolutional hier-",
        "archies. This paper will explore not only her personal",
        "reasons for this caution, but also Spielrein's, Freud's,",
        "and Jung's differing perception of the social role of",
        "community and individuality.",
        "Sabina Spielrein's drive theory as outlined in her paper",
        "Destruction as the Cause of Becoming remains her best-known",
        "and most famous psychoanalytic contribution.",
        "",
        "524Social Evolution Between Spielrein, Freud, & Jung",
        "Social Evolution According to Jung",
        "Unlike Freud's and Spielrein's, Jung's drive theory was",
        "monistic, meaning that it allowed for only one type of primal",
        "instinct, the libido, whose transformations comprised the",
        "groundwork of natural and social history.",
        "Jung claimed that early animal species expended enormous",
        "amounts of energy on procreation.",
        "Social Evolution According to Freud",
        "Despite Jung's disagreement with Freud and their subsequent",
        "split in 1914, the developmental narrative of Freudian",
        "psychoanalysis shared significant features with the Jungian",
        "model.",
        "Sabina Spielrein, Evolution, and Social Politics",
        "In contrast to the social evolution outlined by her two",
        "aforementioned mentors, Spielrein questions in her writings",
        "the existence of a universal teleology.",
        "Notes",
        "1. The original publication was called Wandlungen und Symbole der Libido.",
        "References",
        "Abraham, K. (1913). Dreams and Myths."
      ].join("\n")
    })

    expect(manifest.title).toBe("Social Evolution between Spielrein, Freud, and Jung")
    expect(manifest.tableOfContents.map((item) => item.title)).toEqual([
      "Abstract",
      "Introduction",
      "Social Evolution According to Jung",
      "Social Evolution According to Freud",
      "Sabina Spielrein, Evolution, and Social Politics",
      "Notes",
      "References"
    ])
    expect(manifest.chapters[0].content).toContain("psychoanalysts")
    expect(manifest.chapters[0].content).toContain("socio-evolutional hierarchies")
    expect(manifest.chapters[0].content).not.toContain("Project MUSE")
    expect(manifest.chapters[1].content).toContain("Sabina Spielrein&#39;s drive theory")
    expect(manifest.chapters[2].content).toContain("monistic, meaning")
    expect(manifest.chapters[2].content).not.toContain("524Social Evolution")
    expect(manifest.chapters[5].content).toContain("The original publication")
    expect(manifest.chapters[6].content).toContain("Abraham, K.")
  })

  itWithAttachedPdf("imports the attached Project MUSE PDF with sections, notes, and references", async () => {
    const manifest = await extractPdfWithPdfJs(
      attachedPdfPath!,
      "project_muse_951894",
      testPaths,
      new HeuristicPdfChapterAnalyzer()
    )

    expect(manifest.title).toBe("Social Evolution between Spielrein, Freud, and Jung")
    expect(manifest.authors).toEqual(["Ana Tomčić"])
    expect(manifest.parser?.id).toBe("pdfjs-dist")
    expect(manifest.tableOfContents.map((item) => item.title)).toEqual([
      "Abstract",
      "Introduction",
      "Social Evolution According to Jung",
      "Social Evolution According to Freud",
      "Sabina Spielrein, Evolution, and Social Politics",
      "Notes",
      "References"
    ])

    const notes = manifest.chapters.find((chapter) => chapter.title === "Notes")
    const references = manifest.chapters.find((chapter) => chapter.title === "References")
    expect(notes?.content).toContain("The original publication")
    expect(references?.content).toContain("Abraham, K.")
    expect(manifest.chapters[0].content).toContain("psychoanalysts")
    expect(manifest.chapters[0].content).toContain("socio-evolutional hierarchies")
    expect(manifest.chapters[0].content).not.toContain("Project MUSE")
    expect(manifest.chapters[1].content).toContain("Many authors have stressed")
    expect(manifest.chapters[1].content).not.toContain("524 Social Evolution")
  })
})
