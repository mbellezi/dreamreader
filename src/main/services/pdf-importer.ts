import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { marked } from "marked"
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"
import { z } from "zod"
import type { AppPaths } from "@main/lib/paths"
import { AppError } from "@main/lib/errors"
import { QWEN_PROSODY_GGUF_FILE, QWEN_PROSODY_MODEL_ID } from "@main/services/runtime-service"
import type { ReaderChapter, ReaderManifest } from "@main/services/library-service"

export type PdfChapterCandidate = {
  contextAfter: string
  index: number
  lineIndex: number
  rawLine: string
  reasons: string[]
  score: number
  title: string
}

export type PdfChapterAnalysisInput = {
  candidates: PdfChapterCandidate[]
  fallbackTitle: string
  lineCount: number
  title: string
}

export type PdfChapterAnalysisResult = {
  analyzerId: string
  chapters: Array<{
    candidateIndex: number
    title?: string
  }>
  promptVersion?: string
  version: string
}

export type PdfChapterAnalyzer = {
  id: string
  promptVersion?: string
  version: string
  analyze(input: PdfChapterAnalysisInput): Promise<PdfChapterAnalysisResult>
}

type MarkdownChapter = {
  markdown: string
  title: string
}

type PdfJsMetadataInfo = {
  Author?: string
  Title?: string
}

type PdfTextEntry = {
  height: number
  str: string
  width: number
  x: number
  y: number
}

type PdfJsTextItem = {
  height: number
  str: string
  transform: unknown[]
  width: number
}

type PdfTextLine = {
  height: number
  pageNumber: number
  text: string
  width: number
  x: number
  y: number
}

type PdfTextLineAccumulator = {
  entries: PdfTextEntry[]
  height: number
  y: number
}

const HEURISTIC_PDF_CHAPTER_ANALYZER_ID = "pdf-chapter-heuristic"
const PDFJS_PARSER_ID = "pdfjs-dist"
const QWEN_PDF_CHAPTER_ANALYZER_ID = "qwen3-4b-instruct-2507-gguf-pdf-chapters"
const QWEN_PDF_CHAPTER_PROMPT_VERSION = "pdf-chapters-json-v1"

const PdfChapterLlmResponseSchema = z.object({
  chapters: z.array(
    z.object({
      candidateIndex: z.number().int().min(0),
      title: z.string().trim().min(1).max(160).optional()
    })
  )
})

export async function extractPdfWithPdfJs(
  filePath: string,
  fallbackTitle: string,
  paths: AppPaths,
  analyzerSource: PdfChapterAnalyzer | (() => PdfChapterAnalyzer | Promise<PdfChapterAnalyzer>) = createDefaultPdfChapterAnalyzerProvider(paths)
): Promise<ReaderManifest> {
  const extracted = await extractPdfTextWithPdfJs(filePath)
  if (!extracted.text.trim()) {
    throw new AppError("invalid_pdf", "PDF has no readable text")
  }

  return readerManifestFromPdfText({
    analyzerSource,
    authors: extracted.authors,
    fallbackTitle,
    text: extracted.text,
    title: extracted.title
  })
}

export async function readerManifestFromPdfText(input: {
  analyzerSource?: PdfChapterAnalyzer | (() => PdfChapterAnalyzer | Promise<PdfChapterAnalyzer>)
  authors?: string[]
  fallbackTitle: string
  text: string
  title?: string
}): Promise<ReaderManifest> {
  const title = cleanTitle(input.title) ?? inferPdfTitle(input.text) ?? input.fallbackTitle
  const normalizedMarkdown = normalizePdfTextForReader(input.text) || input.text.trim()
  const segmentation = await segmentPdfMarkdown(normalizedMarkdown, title, input.fallbackTitle, input.analyzerSource)
  const chapters: ReaderChapter[] = []

  for (const [index, chapter] of segmentation.chapters.entries()) {
    const content = await marked.parse(chapter.markdown)
    chapters.push({
      id: `pdf-chapter-${index + 1}.html`,
      href: `pdf-chapter-${index + 1}.html`,
      title: chapter.title,
      content: `<article>${content}</article>`,
      mediaType: "text/html",
      progressionStart: index / Math.max(segmentation.chapters.length, 1),
      progressionEnd: (index + 1) / Math.max(segmentation.chapters.length, 1)
    })
  }

  return {
    format: "pdf",
    title,
    authors: input.authors ?? [],
    language: "pt-BR",
    importer: {
      id: "dreamreader-local"
    },
    parser: {
      id: PDFJS_PARSER_ID
    },
    chapterSegmentation: {
      analyzerId: segmentation.analyzerId,
      candidateCount: segmentation.candidateCount,
      fallbackUsed: segmentation.fallbackUsed,
      version: segmentation.version,
      ...(segmentation.promptVersion ? { promptVersion: segmentation.promptVersion } : {})
    },
    chapters,
    tableOfContents: chapters.map((chapter) => ({ href: chapter.href, title: chapter.title }))
  }
}

async function extractPdfTextWithPdfJs(filePath: string): Promise<{ authors: string[]; text: string; title?: string }> {
  const data = new Uint8Array(await readFile(filePath))
  const loadingTask = getDocument({
    data,
    disableFontFace: true,
    stopAtErrors: false,
    useSystemFonts: true,
    useWorkerFetch: false
  })

  try {
    const pdf = await loadingTask.promise
    const metadata = await pdf.getMetadata().catch(() => undefined)
    const info = metadata?.info as PdfJsMetadataInfo | undefined
    const lines: PdfTextLine[] = []

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const textContent = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false })
      lines.push(...pdfTextLinesFromItems(textContent.items, pageNumber))
    }

    return {
      authors: cleanPdfAuthors(info?.Author),
      text: pdfTextLinesToText(lines),
      title: cleanTitle(info?.Title)
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error
    }
    throw new AppError("invalid_pdf", "Could not parse PDF", error instanceof Error ? error.message : String(error))
  } finally {
    await loadingTask.destroy().catch(() => undefined)
  }
}

function pdfTextLinesFromItems(items: unknown[], pageNumber: number): PdfTextLine[] {
  const entries = items.flatMap((item) => {
    if (!isPdfTextItem(item)) {
      return []
    }
    const str = item.str.replace(/\s+/g, " ").trim()
    if (!str) {
      return []
    }
    return [
      {
        height: pdfTextItemHeight(item),
        str,
        width: Number(item.width) || 0,
        x: Number(item.transform[4]) || 0,
        y: Number(item.transform[5]) || 0
      }
    ]
  })

  entries.sort((left, right) => {
    const yDistance = right.y - left.y
    return Math.abs(yDistance) > 2 ? yDistance : left.x - right.x
  })

  const accumulators: PdfTextLineAccumulator[] = []
  for (const entry of entries) {
    const line = accumulators.find((candidate) => samePdfTextLine(candidate, entry))
    if (line) {
      line.entries.push(entry)
      line.y = (line.y * (line.entries.length - 1) + entry.y) / line.entries.length
      line.height = Math.max(line.height, entry.height)
    } else {
      accumulators.push({
        entries: [entry],
        height: entry.height,
        y: entry.y
      })
    }
  }

  return accumulators
    .sort((left, right) => right.y - left.y)
    .flatMap((line) => {
      const text = textFromPdfLine(line.entries)
      if (!text) {
        return []
      }
      const x = Math.min(...line.entries.map((entry) => entry.x))
      const right = Math.max(...line.entries.map((entry) => entry.x + entry.width))
      return [
        {
          height: line.height,
          pageNumber,
          text,
          width: Math.max(0, right - x),
          x,
          y: line.y
        }
      ]
    })
}

function samePdfTextLine(line: PdfTextLineAccumulator, entry: PdfTextEntry): boolean {
  return Math.abs(line.y - entry.y) <= Math.max(2, entry.height * 0.35, line.height * 0.35)
}

function textFromPdfLine(entries: PdfTextEntry[]): string {
  const sorted = [...entries].sort((left, right) => left.x - right.x)
  let text = ""
  let previousRight: number | undefined

  for (const entry of sorted) {
    const token = entry.str.trim()
    if (!token) {
      continue
    }
    if (text && previousRight !== undefined && entry.x - previousRight > Math.max(1.2, entry.height * 0.18)) {
      text += " "
    }
    text += token
    previousRight = Math.max(previousRight ?? entry.x + entry.width, entry.x + entry.width)
  }

  return text.replace(/\s+/g, " ").trim()
}

function pdfTextLinesToText(lines: PdfTextLine[]): string {
  const sorted = [...lines].sort((left, right) => (left.pageNumber - right.pageNumber) || (right.y - left.y) || (left.x - right.x))
  const output: string[] = []
  let previous: PdfTextLine | undefined

  for (const line of sorted) {
    if (previous && line.pageNumber === previous.pageNumber && hasLargeVerticalGap(previous, line) && output[output.length - 1] !== "") {
      output.push("")
    }
    output.push(line.text)
    previous = line
  }

  return output.join("\n")
}

function hasLargeVerticalGap(previous: PdfTextLine, next: PdfTextLine): boolean {
  const gap = previous.y - next.y - Math.max(previous.height, next.height)
  return gap > Math.max(8, previous.height * 0.85, next.height * 0.85)
}

function isPdfTextItem(item: unknown): item is PdfJsTextItem {
  return Boolean(
    item &&
      typeof item === "object" &&
      typeof (item as PdfJsTextItem).str === "string" &&
      Array.isArray((item as PdfJsTextItem).transform)
  )
}

function pdfTextItemHeight(item: PdfJsTextItem): number {
  return Math.abs(Number(item.height || item.transform[3] || 0)) || 1
}

function cleanPdfAuthors(value: string | undefined): string[] {
  return (value ?? "")
    .split(/\s*(?:;|\n|\band\b)\s*/i)
    .map((author) => cleanTitle(author))
    .filter((author): author is string => Boolean(author))
}

export function createDefaultPdfChapterAnalyzerProvider(paths: AppPaths): () => Promise<PdfChapterAnalyzer> {
  const heuristic = new HeuristicPdfChapterAnalyzer()
  const qwen = new QwenPdfChapterAnalyzer(paths)
  return async () => ((await qwen.isAvailable()) ? qwen : heuristic)
}

export class HeuristicPdfChapterAnalyzer implements PdfChapterAnalyzer {
  readonly id = HEURISTIC_PDF_CHAPTER_ANALYZER_ID
  readonly version = "1.0.0"

  async analyze(input: PdfChapterAnalysisInput): Promise<PdfChapterAnalysisResult> {
    return {
      analyzerId: this.id,
      chapters: selectHeuristicChapters(input.candidates, input.lineCount).map((candidate) => ({
        candidateIndex: candidate.index,
        title: candidate.title
      })),
      version: this.version
    }
  }
}

export class QwenPdfChapterAnalyzer implements PdfChapterAnalyzer {
  readonly id = QWEN_PDF_CHAPTER_ANALYZER_ID
  readonly promptVersion = QWEN_PDF_CHAPTER_PROMPT_VERSION
  readonly version = "Qwen3-4B-Instruct-2507-Q4_K_M"

  private runtimePromise:
    | Promise<{
        LlamaChatSession: new (options: { contextSequence: unknown }) => { prompt(input: string, options?: Record<string, unknown>): Promise<string> }
        model: { createContext(options?: Record<string, unknown>): Promise<{ dispose?: () => void | Promise<void>; getSequence(): unknown }> }
      }>
    | undefined

  constructor(private readonly paths: AppPaths) {}

  async isAvailable(): Promise<boolean> {
    if (!(await pathExists(this.modelPath()))) {
      return false
    }

    try {
      await importNodeLlamaCpp()
      return true
    } catch {
      return false
    }
  }

  async analyze(input: PdfChapterAnalysisInput): Promise<PdfChapterAnalysisResult> {
    if (input.candidates.length > 90) {
      throw new Error("too_many_pdf_chapter_candidates_for_llm")
    }

    const { LlamaChatSession, model } = await this.loadRuntime()
    const context = await model.createContext({ contextSize: 4096 })
    try {
      const session = new LlamaChatSession({ contextSequence: context.getSequence() })
      const output = await session.prompt(buildQwenPdfChapterPrompt(input), {
        maxTokens: 1800,
        temperature: 0.05
      })
      const parsed = PdfChapterLlmResponseSchema.parse(JSON.parse(extractJsonObject(output)))
      return {
        analyzerId: this.id,
        chapters: parsed.chapters,
        promptVersion: this.promptVersion,
        version: this.version
      }
    } finally {
      await context.dispose?.()
    }
  }

  private async loadRuntime() {
    this.runtimePromise ??= (async () => {
      const module = await importNodeLlamaCpp()
      const llama = await module.getLlama()
      const model = await llama.loadModel({
        modelPath: this.modelPath()
      })
      return {
        LlamaChatSession: module.LlamaChatSession,
        model
      }
    })()
    return this.runtimePromise
  }

  private modelPath(): string {
    return (
      process.env.DREAMREADER_QWEN_PROSODY_GGUF ||
      path.join(this.paths.modelsDir, QWEN_PROSODY_MODEL_ID, QWEN_PROSODY_GGUF_FILE)
    )
  }
}

async function segmentPdfMarkdown(
  markdown: string,
  title: string,
  fallbackTitle: string,
  analyzerSource?: PdfChapterAnalyzer | (() => PdfChapterAnalyzer | Promise<PdfChapterAnalyzer>)
): Promise<{
  analyzerId: string
  candidateCount: number
  chapters: MarkdownChapter[]
  fallbackUsed: boolean
  promptVersion?: string
  version: string
}> {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n")
  const candidates = findPdfChapterCandidates(lines)
  const heuristic = new HeuristicPdfChapterAnalyzer()
  const analyzer = analyzerSource ? await resolveAnalyzer(analyzerSource) : heuristic
  const fallback = await heuristic.analyze({ candidates, fallbackTitle, lineCount: lines.length, title })
  let analysis = fallback
  let fallbackUsed = analyzer.id !== heuristic.id

  if (analyzer.id !== heuristic.id) {
    try {
      const analyzed = await analyzer.analyze({ candidates, fallbackTitle, lineCount: lines.length, title })
      analysis = sanitizeAnalysis(analyzed, candidates)
      fallbackUsed = !analysis.chapters.length
      if (!analysis.chapters.length) {
        analysis = fallback
      }
    } catch {
      analysis = fallback
      fallbackUsed = true
    }
  }

  const selected = addRequiredPdfSectionCandidates(candidatesFromAnalysis(analysis, candidates), candidates)
  const chapters = chaptersFromSelectedCandidates(lines, selected, fallbackTitle)
  return {
    analyzerId: analysis.analyzerId,
    candidateCount: candidates.length,
    chapters: chapters.length ? chapters : [{ markdown: markdown.trim(), title: fallbackTitle }],
    fallbackUsed,
    promptVersion: analysis.promptVersion,
    version: analysis.version
  }
}

function resolveAnalyzer(source: PdfChapterAnalyzer | (() => PdfChapterAnalyzer | Promise<PdfChapterAnalyzer>)): Promise<PdfChapterAnalyzer> | PdfChapterAnalyzer {
  return typeof source === "function" ? source() : source
}

function sanitizeAnalysis(analysis: PdfChapterAnalysisResult, candidates: PdfChapterCandidate[]): PdfChapterAnalysisResult {
  const candidateIndexes = new Set(candidates.map((candidate) => candidate.index))
  const seen = new Set<number>()
  return {
    ...analysis,
    chapters: analysis.chapters.filter((chapter) => {
      if (!candidateIndexes.has(chapter.candidateIndex) || seen.has(chapter.candidateIndex)) {
        return false
      }
      seen.add(chapter.candidateIndex)
      return true
    })
  }
}

function candidatesFromAnalysis(analysis: PdfChapterAnalysisResult, candidates: PdfChapterCandidate[]): PdfChapterCandidate[] {
  const byIndex = new Map(candidates.map((candidate) => [candidate.index, candidate]))
  return analysis.chapters
    .flatMap((chapter) => {
      const candidate = byIndex.get(chapter.candidateIndex)
      return candidate
        ? [
            {
              ...candidate,
              title: cleanTitle(chapter.title) ?? candidate.title
            }
          ]
        : []
    })
    .sort((left, right) => left.lineIndex - right.lineIndex)
}

function addRequiredPdfSectionCandidates(
  selected: PdfChapterCandidate[],
  candidates: PdfChapterCandidate[]
): PdfChapterCandidate[] {
  const selectedLineIndexes = new Set(selected.map((candidate) => candidate.lineIndex))
  return [
    ...selected,
    ...candidates.filter((candidate) => isRequiredPdfSectionTitle(candidate.title) && !selectedLineIndexes.has(candidate.lineIndex))
  ].sort((left, right) => left.lineIndex - right.lineIndex)
}

function chaptersFromSelectedCandidates(
  lines: string[],
  candidates: PdfChapterCandidate[],
  fallbackTitle: string
): MarkdownChapter[] {
  if (!candidates.length) {
    return [{ markdown: lines.join("\n").trim(), title: fallbackTitle }]
  }

  const boundaries = [...candidates]
  const preface = lines.slice(0, boundaries[0].lineIndex).join("\n")
  if (isReadablePreface(preface)) {
    boundaries.unshift({
      contextAfter: "",
      index: -1,
      lineIndex: 0,
      rawLine: fallbackTitle,
      reasons: ["preface"],
      score: 0,
      title: "Inicio"
    })
  }

  return boundaries.flatMap((boundary, index) => {
    const next = boundaries[index + 1]
    const markdown = lines.slice(boundary.lineIndex, next?.lineIndex).join("\n").trim()
    return markdownToPlainText(markdown) ? [{ markdown, title: boundary.title }] : []
  })
}

function findPdfChapterCandidates(lines: string[]): PdfChapterCandidate[] {
  const candidates: PdfChapterCandidate[] = []
  for (const [lineIndex, line] of lines.entries()) {
    const candidate = pdfChapterCandidateForLine(lines, lineIndex, line)
    if (candidate) {
      candidates.push({ ...candidate, index: candidates.length })
    }
  }
  return candidates
}

function pdfChapterCandidateForLine(
  lines: string[],
  lineIndex: number,
  line: string
): Omit<PdfChapterCandidate, "index"> | undefined {
  const rawLine = line.trim()
  const title = cleanHeadingLine(rawLine)
  if (!title || title.length < 3 || title.length > 140 || isTocOrPageLine(rawLine) || isTocOrPageLine(title)) {
    return undefined
  }
  if (isLikelyNoteEntry(title) && countWords(title) > 6) {
    return undefined
  }

  const reasons: string[] = []
  let score = 0
  if (/^#{1,4}\s+/.test(rawLine)) {
    score += 4
    reasons.push("markdown-heading")
  }
  const majorChapterTitle = isMajorChapterTitle(title)
  const frontOrBackMatterTitle = isFrontOrBackMatterTitle(title)
  const academicSectionTitle = isAcademicSectionTitle(title)

  if (majorChapterTitle) {
    score += 6
    reasons.push("major-prefix")
  }
  if (frontOrBackMatterTitle) {
    score += 5
    reasons.push("front-back-matter")
  }
  if (academicSectionTitle) {
    score += 5
    reasons.push("academic-section")
  }
  if (/^\d{1,3}\s*[.)-]?\s+\S/.test(title)) {
    score += 4
    reasons.push("numbered-heading")
  }
  if (isMostlyUppercase(title) && title.length <= 90) {
    score += 3
    reasons.push("uppercase")
  }
  if (hasBlankNeighbor(lines, lineIndex)) {
    score += 1
    reasons.push("isolated-line")
  }
  if (markdownToPlainText(lines.slice(lineIndex + 1, lineIndex + 12).join(" ")).length > 120) {
    score += 1
    reasons.push("body-after")
  }
  if (isNearContentsHeading(lines, lineIndex) && !frontOrBackMatterTitle) {
    score -= 6
    reasons.push("near-contents")
  }
  if (/^[ivxlcdm]+$/i.test(title) || /^\d+$/.test(title)) {
    score -= 5
    reasons.push("bare-number")
  }

  if (score < 4) {
    return undefined
  }

  return {
    contextAfter: markdownToPlainText(lines.slice(lineIndex + 1, lineIndex + 10).join(" ")).slice(0, 600),
    lineIndex,
    rawLine,
    reasons,
    score,
    title
  }
}

function selectHeuristicChapters(candidates: PdfChapterCandidate[], lineCount: number): PdfChapterCandidate[] {
  const titleCounts = new Map<string, number>()
  for (const candidate of candidates) {
    const key = normalizedTitleKey(candidate.title)
    titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1)
  }

  const filtered = candidates
    .filter((candidate) => candidate.score >= 5 || candidates.length <= 1)
    .filter((candidate) => {
      const repeated = (titleCounts.get(normalizedTitleKey(candidate.title)) ?? 0) > 2
      return !repeated || candidate.reasons.includes("major-prefix") || candidate.reasons.includes("front-back-matter")
    })
  const selected: PdfChapterCandidate[] = []
  const minGap = Math.max(2, Math.floor(lineCount * 0.002))

  for (const candidate of filtered) {
    const previous = selected[selected.length - 1]
    if (previous && candidate.lineIndex - previous.lineIndex <= minGap) {
      if (candidate.score > previous.score) {
        selected[selected.length - 1] = candidate
      }
      continue
    }
    selected.push(candidate)
  }

  return selected
}

function cleanHeadingLine(line: string): string | undefined {
  return cleanTitle(
    line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/[*_`]+/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim()
  )
}

function normalizePdfTextForReader(text: string): string {
  const rawLines = text.replace(/\r\n?/g, "\n").split("\n")
  const startIndex = rawLines.findIndex((line) => /^Abstract\b/i.test(line.trim()))
  const lines = startIndex >= 0 ? rawLines.slice(startIndex) : rawLines
  const blocks: string[] = []
  let paragraphLines: string[] = []
  let inAbstract = false
  let inNotes = false
  let inReferences = false
  let pendingIntroductionAfterAbstract = false

  const flushParagraph = (): string | undefined => {
    const paragraph = reflowPdfParagraph(paragraphLines)
    paragraphLines = []
    if (paragraph) {
      blocks.push(paragraph)
      return paragraph
    }
    return undefined
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = normalizePdfLine(lines[index])
    if (!line) {
      const paragraph = flushParagraph()
      if (inAbstract && paragraph && countWords(paragraph) >= 80) {
        pendingIntroductionAfterAbstract = true
      }
      continue
    }
    if (isPdfNoiseLine(line)) {
      continue
    }

    if (inAbstract && pendingIntroductionAfterAbstract && !isLikelyPdfSectionHeading(lines, index, line)) {
      blocks.push("## Introduction")
      inAbstract = false
      pendingIntroductionAfterAbstract = false
    } else if (inAbstract && !isLikelyPdfSectionHeading(lines, index, line) && shouldStartInferredIntroduction(paragraphLines, line)) {
      flushParagraph()
      blocks.push("## Introduction")
      inAbstract = false
      pendingIntroductionAfterAbstract = false
    }

    if (!inReferences && isLikelyPdfSectionHeading(lines, index, line)) {
      flushParagraph()
      const title = sectionTitleFromLine(line)
      if (title) {
        blocks.push(`## ${title}`)
        inAbstract = normalizedTitleKey(title) === "abstract"
        inNotes = isNotesSectionTitle(title)
        inReferences = isReferencesSectionTitle(title)
        pendingIntroductionAfterAbstract = false
        const remainder = abstractRemainder(line)
        if (remainder) {
          paragraphLines.push(remainder)
        }
      }
      continue
    }

    if (inReferences && isLikelyReferenceEntry(line)) {
      flushParagraph()
    } else if (inNotes && isLikelyNoteEntry(line)) {
      flushParagraph()
    } else if (paragraphLines.length && isLikelyPdfParagraphBreak(paragraphLines[paragraphLines.length - 1], line)) {
      flushParagraph()
    }

    paragraphLines.push(line)
  }

  flushParagraph()
  return blocks.join("\n\n").trim()
}

function normalizePdfLine(line: string): string {
  return line
    .replace(/\[\d{1,3}(?:\.\d{1,3}){3}]\s*/g, " ")
    .replace(/\bProject MUSE\s*\([^)]*\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim()
}

function reflowPdfParagraph(lines: string[]): string {
  let paragraph = ""
  for (const line of lines.map(normalizePdfLine).filter(Boolean)) {
    if (!paragraph) {
      paragraph = line
      continue
    }
    if (shouldJoinHyphenatedLine(paragraph, line)) {
      paragraph = `${paragraph.slice(0, -1)}${line}`
    } else {
      paragraph = `${paragraph} ${line}`
    }
  }
  return paragraph
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim()
}

function shouldJoinHyphenatedLine(previous: string, next: string): boolean {
  return /[A-Za-zÀ-ÖØ-öø-ÿ]-$/.test(previous) && /^[a-zà-öø-ÿ]/.test(next)
}

function shouldStartInferredIntroduction(paragraphLines: string[], line: string): boolean {
  if (countWords(reflowPdfParagraph(paragraphLines)) < 80) {
    return false
  }
  const previous = paragraphLines[paragraphLines.length - 1]?.trim() ?? ""
  return endsSentence(previous) && startsSentence(line) && !isLikelyPdfSectionHeading([line], 0, line)
}

function isLikelyPdfParagraphBreak(previous: string, next: string): boolean {
  return previous.trim().length < 92 && endsSentence(previous) && startsSentence(next)
}

function startsSentence(line: string): boolean {
  return /^[“"']?[A-ZÀ-ÖØ-Þ0-9]/.test(line.trim())
}

function endsSentence(line: string): boolean {
  return /[.!?][)"'\]]?$/.test(line.trim())
}

function isPdfNoiseLine(line: string): boolean {
  return (
    /^\[[^\]]+]\s+Project MUSE\b/i.test(line) ||
    /^Project MUSE\b/i.test(line) ||
    /^Published by\b/i.test(line) ||
    /^DOI:?$/i.test(line) ||
    /^For additional information about this article$/i.test(line) ||
    /^https?:\/\//i.test(line) ||
    /^American Imago,\s+(?:Volume|Vol\.)\b/i.test(line) ||
    /^\d{1,4}$/.test(line) ||
    /^\d{3,4}\S/.test(line) ||
    /^[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿˇ´`' .-]{3,80}\s+\d{3,4}$/.test(line) ||
    isLikelyRunningHeaderLine(line) ||
    /^[\u02c7\u0301\u00b4`' ]+$/.test(line)
  )
}

function isLikelyRunningHeaderLine(line: string): boolean {
  const match = line.match(/^\d{3,4}\s+(.+)$/)
  if (!match) {
    return false
  }
  const title = match[1].trim()
  return isAcademicSectionTitle(title) || /[,/&]/.test(title)
}

function isLikelyPdfSectionHeading(lines: string[], index: number, line: string): boolean {
  const title = sectionTitleFromLine(line)
  if (!title || isTocOrPageLine(line) || isTocOrPageLine(title) || isPdfNoiseLine(title)) {
    return false
  }
  const previous = normalizePdfLine(lines[index - 1] ?? "")
  const hasBoundaryBefore = index === 0 || !previous || isPdfNoiseLine(previous) || endsSentence(previous)
  const namedAcademicSection = isNamedAcademicSectionTitle(title)
  const genericAcademicSection = isAcademicSectionTitle(title) && hasBoundaryBefore && !isLikelySentenceFragmentTitle(title)
  if (isMajorChapterTitle(title) || isFrontOrBackMatterTitle(title) || namedAcademicSection || genericAcademicSection) {
    return hasReadableTextAfter(lines, index) || isReferencesSectionTitle(title)
  }
  return false
}

function sectionTitleFromLine(line: string): string | undefined {
  const title = cleanHeadingLine(line)
  if (!title) {
    return undefined
  }
  const abstractMatch = title.match(/^Abstract\s*:\s*(.*)$/i)
  if (abstractMatch) {
    return "Abstract"
  }
  return title
}

function abstractRemainder(line: string): string | undefined {
  const match = cleanHeadingLine(line)?.match(/^Abstract\s*:\s*(.+)$/i)
  return cleanTitle(match?.[1])
}

function hasReadableTextAfter(lines: string[], index: number): boolean {
  for (let offset = 1; offset <= 8; offset += 1) {
    const next = normalizePdfLine(lines[index + offset] ?? "")
    if (!next || isPdfNoiseLine(next)) {
      continue
    }
    if (isLikelyPdfSectionHeading(lines, index + offset, next)) {
      return false
    }
    return markdownToPlainText(next).length >= 20
  }
  return false
}

function cleanTitle(value: string | null | undefined): string | undefined {
  const clean = value
    ?.replace(/\s+/g, " ")
    .replace(/\.{2,}\s*\d+$/, "")
    .trim()
  return clean || undefined
}

function isMajorChapterTitle(title: string): boolean {
  return /^(?:cap(?:i|\u00ed)tulo|chapter|parte|part|livro|book)\s+(?:[ivxlcdm]+|\d+|[a-z])(?:\b|[\s:.-])/i.test(title)
}

function isFrontOrBackMatterTitle(title: string): boolean {
  return /^(?:introdu(?:c|\u00e7)(?:a|\u00e3)o|prologo|pr(?:o|\u00f3)logo|prefacio|pref(?:a|\u00e1)cio|epilogo|ep(?:i|\u00ed)logo|apendice|ap(?:e|\u00ea)ndice|appendix|agradecimentos|nota do autor)\b/i.test(title)
}

function isAcademicSectionTitle(title: string): boolean {
  if (isNamedAcademicSectionTitle(title)) {
    return true
  }
  if (/[.!?]$/.test(title) || title.length > 100) {
    return false
  }
  const words = title.split(/\s+/).filter(Boolean)
  if (words.length < 2 || words.length > 12) {
    return false
  }
  const titleLikeWords = words.filter((word) => isTitleLikeWord(word))
  return titleLikeWords.length / words.length >= 0.72
}

function isNamedAcademicSectionTitle(title: string): boolean {
  return /^(?:abstract|resumo|notes|notas|references|referencias|bibliography|bibliografia|works cited|acknowledgments|acknowledgements|conclusion|discussion)$/.test(normalizedTitleKey(title))
}

function isNotesSectionTitle(title: string): boolean {
  return /^(?:notes|notas)$/.test(normalizedTitleKey(title))
}

function isReferencesSectionTitle(title: string): boolean {
  return /^(?:references|referencias|bibliography|bibliografia|works cited)$/.test(normalizedTitleKey(title))
}

function isRequiredPdfSectionTitle(title: string): boolean {
  return /^(?:abstract|resumo|notes|notas|references|referencias|bibliography|bibliografia|works cited)$/.test(normalizedTitleKey(title))
}

function isTitleLikeWord(word: string): boolean {
  const normalized = normalizedTitleKey(word)
  if (/^(?:a|an|and|as|at|between|by|for|from|in|into|of|on|or|the|to|with|without)$/.test(normalized)) {
    return true
  }
  return /^[A-ZÀ-ÖØ-Þ0-9]/.test(word)
}

function isLikelySentenceFragmentTitle(title: string): boolean {
  return (
    /^[("'“”]/.test(title) ||
    /[()]/.test(title) ||
    /^(?:although|and|because|but|for|in|of|then|these|this|those|when|while)\b/i.test(title) ||
    /\b(?:appeared|argued|came|claimed|contains|did|does|had|has|is|might|published|relied|should|uses|was|were|would)\b/i.test(title)
  )
}

function isTocOrPageLine(title: string): boolean {
  return (
    /^(?:sum(?:a|\u00e1)rio|conte(?:u|\u00fa)do|contents|table of contents)$/i.test(title) ||
    /\.{2,}\s*\d+\s*$/.test(title) ||
    /[•·]{2,}\s*\d+\s*$/.test(title)
  )
}

function isNearContentsHeading(lines: string[], lineIndex: number): boolean {
  const start = Math.max(0, lineIndex - 8)
  const nearby = lines.slice(start, lineIndex + 1).join(" ")
  return /(?:sum(?:a|\u00e1)rio|conte(?:u|\u00fa)do|contents|table of contents)/i.test(nearby)
}

function hasBlankNeighbor(lines: string[], lineIndex: number): boolean {
  return !lines[lineIndex - 1]?.trim() || !lines[lineIndex + 1]?.trim()
}

function isMostlyUppercase(value: string): boolean {
  const letters = [...value].filter((char) => char.toLocaleLowerCase("pt-BR") !== char.toLocaleUpperCase("pt-BR"))
  if (letters.length < 4) {
    return false
  }
  const uppercase = letters.filter((char) => char === char.toLocaleUpperCase("pt-BR")).length
  return uppercase / letters.length >= 0.8
}

function isReadablePreface(markdown: string): boolean {
  const lines = markdown.split("\n").filter((line) => line.trim())
  const tocLike = lines.filter((line) => /\.{2,}\s*\d+\s*$/.test(line)).length
  return markdownToPlainText(markdown).length >= 500 && tocLike / Math.max(lines.length, 1) < 0.25
}

function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[#>*_`~|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizedTitleKey(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function inferPdfTitle(markdown: string): string | undefined {
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const clean = cleanTitle(line)
    if (!clean || isPdfNoiseLine(clean) || isTocOrPageLine(clean)) {
      continue
    }
    if (/^Abstract\b/i.test(clean)) {
      return undefined
    }
    return clean
  }
  return undefined
}

function isLikelyReferenceEntry(line: string): boolean {
  return /^[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ' -]+,\s+[A-Z](?:\.|\s)/.test(line)
}

function isLikelyNoteEntry(line: string): boolean {
  return /^\d{1,3}\.\s+\S/.test(line)
}

function countWords(value: string): number {
  return value.split(/\s+/).filter(Boolean).length
}

function buildQwenPdfChapterPrompt(input: PdfChapterAnalysisInput): string {
  return [
    "Voce separa capitulos de livros extraidos de PDF para um leitor de ebooks.",
    "Os candidatos abaixo foram encontrados por heuristicas. Escolha apenas inicios reais de capitulos ou secoes principais, como introducao, prologo, capitulos, partes e apendices.",
    "Em artigos academicos, trate secoes do artigo como capitulos. Inclua Abstract/Resumo, Notes/Notas, References/Referencias e Bibliography/Bibliografia quando esses candidatos forem cabecalhos reais.",
    "Ignore sumario, linhas com numero de pagina, cabecalhos repetidos, rodapes e subtitulos internos.",
    'Responda somente JSON valido, sem markdown, no formato {"chapters":[{"candidateIndex":0,"title":"Titulo limpo"}]}.',
    `Titulo do livro: ${input.title || input.fallbackTitle}`,
    "Candidatos:",
    JSON.stringify(
      input.candidates.map((candidate) => ({
        candidateIndex: candidate.index,
        contextAfter: candidate.contextAfter,
        lineIndex: candidate.lineIndex,
        reasons: candidate.reasons,
        score: candidate.score,
        title: candidate.title
      }))
    )
  ].join("\n")
}

function extractJsonObject(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed
  }
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1)
  }
  throw new Error("llm_output_missing_json")
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

async function importNodeLlamaCpp(): Promise<{
  LlamaChatSession: new (options: { contextSequence: unknown }) => { prompt(input: string, options?: Record<string, unknown>): Promise<string> }
  getLlama(): Promise<{
    loadModel(options: { modelPath: string }): Promise<{
      createContext(options?: Record<string, unknown>): Promise<{ dispose?: () => void | Promise<void>; getSequence(): unknown }>
    }>
  }>
}> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>
  return (await dynamicImport("node-llama-cpp")) as {
    LlamaChatSession: new (options: { contextSequence: unknown }) => { prompt(input: string, options?: Record<string, unknown>): Promise<string> }
    getLlama(): Promise<{
      loadModel(options: { modelPath: string }): Promise<{
        createContext(options?: Record<string, unknown>): Promise<{ dispose?: () => void | Promise<void>; getSequence(): unknown }>
      }>
    }>
  }
}
