import { execFile } from "node:child_process"
import { access, readdir } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const options = parseArgs(process.argv.slice(2))
const readiumBin = options.readiumBin ?? process.env.READIUM_BIN ?? "readium"
const epubPaths = options.epubPaths.length ? options.epubPaths : await defaultEpubPaths()

if (!epubPaths.length) {
  console.error("No EPUB files were provided and none were found in the current directory.")
  process.exit(1)
}

try {
  await assertReadableCommand(readiumBin)
} catch {
  console.error(`Readium CLI not found or not executable: ${readiumBin}`)
  console.error("Install Readium CLI or set READIUM_BIN=/path/to/readium.")
  process.exit(1)
}

const reports = []
for (const epubPath of epubPaths) {
  reports.push(await inspectEpub(readiumBin, epubPath))
}

if (options.json) {
  console.log(JSON.stringify({ readiumBin, reports }, null, 2))
} else {
  printHumanReport(readiumBin, reports)
}

function parseArgs(args) {
  const parsed = {
    epubPaths: [],
    json: false,
    readiumBin: undefined
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--json") {
      parsed.json = true
      continue
    }
    if (arg === "--readium-bin") {
      parsed.readiumBin = args[index + 1]
      index += 1
      continue
    }
    if (arg.startsWith("--readium-bin=")) {
      parsed.readiumBin = arg.slice("--readium-bin=".length)
      continue
    }
    parsed.epubPaths.push(arg)
  }

  return parsed
}

async function defaultEpubPaths() {
  const entries = await readdir(process.cwd())
  return entries.filter((entry) => entry.toLocaleLowerCase("en-US").endsWith(".epub")).sort()
}

async function assertReadableCommand(command) {
  if (command.includes("/") || command.startsWith(".")) {
    await access(command)
    return
  }
  await execFileAsync(command, ["--version"], { maxBuffer: 1024 * 1024 })
}

async function inspectEpub(command, epubPath) {
  const { stdout } = await execFileAsync(command, ["manifest", epubPath], {
    maxBuffer: 32 * 1024 * 1024
  })
  const manifest = JSON.parse(stdout)
  const readingOrder = Array.isArray(manifest.readingOrder) ? manifest.readingOrder : []
  const toc = Array.isArray(manifest.toc) ? manifest.toc : []
  const flattenedToc = flattenToc(toc)
  const readingOrderHrefs = new Set(readingOrder.map((item) => normalizeHref(item.href)).filter(Boolean))
  const tocHrefIssues = flattenedToc
    .filter((item) => item.href && !readingOrderHrefs.has(normalizeHref(item.href)))
    .map((item) => ({
      title: item.title,
      href: item.href,
      depth: item.depth
    }))

  return {
    epubPath,
    title: manifest.metadata?.title ?? path.basename(epubPath),
    conformsTo: manifest.metadata?.conformsTo,
    language: manifest.metadata?.language,
    readingOrderCount: readingOrder.length,
    tocTopLevelCount: toc.length,
    tocFlattenedCount: flattenedToc.length,
    tocMaxDepth: flattenedToc.reduce((max, item) => Math.max(max, item.depth), 0),
    topLevelToc: toc.map((item) => ({
      title: item.title,
      href: item.href,
      children: Array.isArray(item.children) ? item.children.length : 0
    })),
    firstReadingOrder: readingOrder.slice(0, 12).map((item) => ({
      title: item.title,
      href: item.href,
      type: item.type
    })),
    tocHrefIssueCount: tocHrefIssues.length,
    tocHrefIssues: tocHrefIssues.slice(0, 20)
  }
}

function flattenToc(items, depth = 1) {
  return items.flatMap((item) => {
    const children = Array.isArray(item.children) ? item.children : []
    return [
      {
        title: item.title,
        href: item.href,
        depth
      },
      ...flattenToc(children, depth + 1)
    ]
  })
}

function normalizeHref(href) {
  if (typeof href !== "string" || !href) {
    return ""
  }
  return decodeUriSafely(href.split("#")[0] ?? "")
}

function decodeUriSafely(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function printHumanReport(command, reports) {
  console.log(`Readium CLI: ${command}`)
  for (const report of reports) {
    console.log("")
    console.log(`# ${report.epubPath}`)
    console.log(`Title: ${report.title}`)
    console.log(`Language: ${formatValue(report.language)}`)
    console.log(`Conforms to: ${formatValue(report.conformsTo)}`)
    console.log(`Reading order: ${report.readingOrderCount}`)
    console.log(`TOC: ${report.tocTopLevelCount} top-level, ${report.tocFlattenedCount} total, depth ${report.tocMaxDepth}`)
    console.log(`TOC href issues: ${report.tocHrefIssueCount}`)
    console.log("Top-level TOC:")
    for (const item of report.topLevelToc) {
      console.log(`- ${formatValue(item.title)} | ${formatValue(item.href)} | children=${item.children}`)
    }
  }
}

function formatValue(value) {
  if (Array.isArray(value)) {
    return value.join(", ") || "(empty)"
  }
  if (value === undefined || value === null || value === "") {
    return "(empty)"
  }
  return String(value)
}
