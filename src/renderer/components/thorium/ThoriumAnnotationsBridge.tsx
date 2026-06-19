import { Highlighter, Loader2, PanelRightClose, Trash2, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react"
import { Locator } from "@readium/shared"
import type { TranslationFn } from "@renderer/app/types"
import { dreamreaderClient } from "@renderer/lib/dreamreader"
import {
  goToReadiumLocator,
  serializeReadiumTextSelection,
  subscribeReadiumEpubNavigator,
  subscribeReadiumTextSelection,
  type ReadiumDecoration,
  type ReadiumEpubNavigator
} from "@renderer/lib/readium-compat"
import { cn } from "@renderer/lib/utils"
import type { Annotation, AnnotationColor } from "@shared/contracts/annotations"

type ToolbarState =
  | {
      mode: "create"
      left: number
      locator: Record<string, unknown>
      quote: string
      top: number
    }
  | {
      annotationId: string
      left: number
      mode: "edit"
      top: number
    }

const colorOptions: Array<{ color: Exclude<AnnotationColor, "none">; className: string; tint: string }> = [
  { color: "yellow", className: "bg-yellow-300", tint: "rgba(250, 204, 21, 0.48)" },
  { color: "green", className: "bg-emerald-300", tint: "rgba(110, 231, 183, 0.48)" },
  { color: "blue", className: "bg-sky-300", tint: "rgba(125, 211, 252, 0.5)" },
  { color: "pink", className: "bg-rose-300", tint: "rgba(253, 164, 175, 0.52)" },
  { color: "purple", className: "bg-violet-300", tint: "rgba(196, 181, 253, 0.52)" }
]
const colorTintByName = new Map(colorOptions.map((item) => [item.color, item.tint]))
const legacyDecorationGroup = "dreamreader-annotations"
const decorationGroups = colorOptions.map((item) => decorationGroupForColor(item.color))

export function ThoriumAnnotationsBridge({ bookId, t }: { bookId: string; t: TranslationFn }): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [annotationButtonHovered, setAnnotationButtonHovered] = useState(false)
  const [navigator, setNavigator] = useState<ReadiumEpubNavigator | null>(null)
  const [saving, setSaving] = useState(false)
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null)
  const annotationButtonActive = drawerOpen || annotationButtonHovered

  useEffect(() => subscribeReadiumEpubNavigator(setNavigator), [])

  const loadAnnotations = useCallback(async () => {
    setLoading(true)
    setErrorKey(null)
    try {
      setAnnotations(await dreamreaderClient.listStoredAnnotations(bookId))
    } catch {
      setAnnotations([])
      setErrorKey("reader.annotationLoadFailed")
    } finally {
      setLoading(false)
    }
  }, [bookId])

  useEffect(() => {
    void loadAnnotations()
  }, [loadAnnotations])

  useEffect(() => subscribeReadiumTextSelection((selection, selectionNavigator) => {
    const quote = selection.text.trim()
    const locator = serializeReadiumTextSelection(selection, selectionNavigator)
    const position = selectionToolbarPosition(selection, selectionNavigator, rootRef.current)

    if (!quote || !locator || !position) {
      return
    }

    setToolbar({
      mode: "create",
      quote,
      locator,
      left: position.left,
      top: position.top
    })
  }), [])

  const decorationsByGroup = useMemo(() => groupDecorationsByColor(annotations), [annotations])

  useEffect(() => {
    if (!navigator?.applyDecorations) {
      return
    }

    for (const group of decorationGroups) {
      navigator.applyDecorations(decorationsByGroup.get(group) ?? [], group)
    }
    navigator.applyDecorations([], legacyDecorationGroup)

    const observer = {
      onDecorationActivated(event: { decoration: ReadiumDecoration; point?: { x: number; y: number }; rect?: { left: number; top: number; width: number; height: number } }) {
        const position = activationToolbarPosition(event, rootRef.current)
        if (!position) {
          return false
        }
        setToolbar({
          mode: "edit",
          annotationId: event.decoration.id,
          left: position.left,
          top: position.top
        })
        return true
      }
    }

    for (const group of decorationGroups) {
      navigator.registerDecorationObserver?.(group, observer)
    }

    return () => {
      navigator.unregisterDecorationObserver?.(observer)
      for (const group of decorationGroups) {
        navigator.applyDecorations?.([], group)
      }
      navigator.applyDecorations?.([], legacyDecorationGroup)
    }
  }, [decorationsByGroup, navigator])

  useEffect(() => {
    if (!toolbar) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setToolbar(null)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [toolbar])

  const createAnnotation = async (color: AnnotationColor) => {
    if (!toolbar || toolbar.mode !== "create") {
      return
    }

    setErrorKey(null)
    setSaving(true)
    try {
      const created = await dreamreaderClient.createStoredAnnotation({
        bookId,
        locator: toolbar.locator,
        quote: toolbar.quote,
        color,
        tags: []
      })
      setAnnotations((current) => [created, ...current])
      setDrawerOpen(true)
      setToolbar(null)
    } catch {
      setErrorKey("reader.annotationSaveFailed")
    } finally {
      setSaving(false)
    }
  }

  const updateAnnotation = async (color: AnnotationColor) => {
    if (!toolbar || toolbar.mode !== "edit") {
      return
    }

    setErrorKey(null)
    setSaving(true)
    try {
      const updated = await dreamreaderClient.updateStoredAnnotation({
        id: toolbar.annotationId,
        color
      })
      setAnnotations((current) => current.map((annotation) => annotation.id === updated.id ? updated : annotation))
      setToolbar(null)
    } catch {
      setErrorKey("reader.annotationSaveFailed")
    } finally {
      setSaving(false)
    }
  }

  const deleteAnnotationById = async (annotationId: string) => {
    setErrorKey(null)
    setSaving(true)
    try {
      await dreamreaderClient.deleteStoredAnnotation(annotationId)
      setAnnotations((current) => current.filter((annotation) => annotation.id !== annotationId))
      setToolbar(null)
    } catch {
      setErrorKey("reader.annotationDeleteFailed")
    } finally {
      setSaving(false)
    }
  }

  const deleteToolbarAnnotation = async () => {
    if (toolbar?.mode === "edit") {
      await deleteAnnotationById(toolbar.annotationId)
    }
  }

  const jumpToAnnotation = async (annotation: Annotation) => {
    if (!navigator) {
      return
    }

    setErrorKey(null)
    const ok = await goToReadiumLocator(navigator, annotation.locator)
    if (ok) {
      setDrawerOpen(false)
      setToolbar(null)
    } else {
      setErrorKey("reader.annotationJumpFailed")
    }
  }

  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute inset-0 z-[100]"
    >
      {toolbar ? (
        <button
          className="pointer-events-auto absolute inset-0 cursor-default"
          type="button"
          aria-label={t("reader.closeAnnotationToolbar")}
          onMouseDown={() => setToolbar(null)}
        />
      ) : null}

      <button
        className="dreamreader-annotations-trigger pointer-events-auto absolute right-[157px] top-[14px] inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-md bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        type="button"
        title={t("reader.annotations")}
        aria-label={t("reader.annotations")}
        aria-pressed={drawerOpen}
        onPointerEnter={() => setAnnotationButtonHovered(true)}
        onPointerLeave={() => setAnnotationButtonHovered(false)}
        onClick={() => setDrawerOpen((current) => !current)}
      >
        <span
          className="absolute inset-0 rounded-md transition-colors"
          style={{ backgroundColor: annotationButtonActive ? "var(--dreamreader-reader-hover)" : "transparent" }}
          aria-hidden="true"
        />
        <Highlighter className="relative z-10 h-4 w-4" aria-hidden="true" />
      </button>

      {drawerOpen ? (
        <aside
          className="pointer-events-auto absolute bottom-3 right-3 top-16 flex w-[min(360px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-md border bg-sidebar shadow-lg"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-3">
            <div className="flex min-w-0 items-center gap-2">
              <Highlighter className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <h2 className="truncate text-sm font-semibold">{t("reader.annotations")}</h2>
            </div>
            <button
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-card hover:text-foreground"
              type="button"
              title={t("reader.collapseSidebar")}
              aria-label={t("reader.collapseSidebar")}
              onClick={() => setDrawerOpen(false)}
            >
              <PanelRightClose className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {errorKey ? (
            <div className="mx-3 mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {t(errorKey)}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-auto p-3">
            {loading ? (
              <div className="flex items-center gap-2 rounded-md border bg-card p-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {t("common.loading")}
              </div>
            ) : annotations.length ? (
              <div className="space-y-2">
                {annotations.map((annotation) => (
                  <div key={annotation.id} className="rounded-md border bg-card p-3">
                    <div className="flex items-start justify-between gap-3">
                      <button className="min-w-0 flex-1 text-left" type="button" onClick={() => void jumpToAnnotation(annotation)}>
                        <span className="inline-flex max-w-full items-center gap-2 text-xs font-medium text-muted-foreground">
                          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", swatchClassForAnnotation(annotation))} aria-hidden="true" />
                          <span className="truncate">{annotationLabel(annotation)}</span>
                        </span>
                        <span className="mt-2 line-clamp-4 block text-sm">{annotation.quote}</span>
                        {annotation.note ? <span className="mt-2 block text-xs text-muted-foreground">{annotation.note}</span> : null}
                      </button>
                      <button
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        type="button"
                        disabled={saving}
                        title={t("reader.deleteAnnotation")}
                        aria-label={t("reader.deleteAnnotation")}
                        onClick={() => void deleteAnnotationById(annotation.id)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-md border bg-card p-3 text-sm text-muted-foreground">{t("reader.emptyAnnotations")}</p>
            )}
          </div>
        </aside>
      ) : null}

      {toolbar ? (
        <div
          className="pointer-events-auto absolute flex -translate-x-1/2 items-center gap-1 rounded-md border bg-card p-1 shadow-md"
          style={{ left: toolbar.left, top: toolbar.top }}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {colorOptions.map((option) => (
            <button
              key={option.color}
              className="flex h-8 w-8 items-center justify-center rounded-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              type="button"
              disabled={saving}
              title={t(`reader.highlight.${option.color}`)}
              aria-label={t(`reader.highlight.${option.color}`)}
              onClick={() => void (toolbar.mode === "create" ? createAnnotation(option.color) : updateAnnotation(option.color))}
            >
              <span className={cn("h-4 w-4 rounded-full border border-foreground/10", option.className)} aria-hidden="true" />
            </button>
          ))}
          {toolbar.mode === "edit" ? (
            <button
              className="flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              type="button"
              disabled={saving}
              title={t("reader.highlight.delete")}
              aria-label={t("reader.highlight.delete")}
              onClick={() => void deleteToolbarAnnotation()}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
          <button
            className="flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            type="button"
            title={t("common.close")}
            aria-label={t("common.close")}
            onClick={() => setToolbar(null)}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  )
}

function annotationLabel(annotation: Annotation): string {
  const locator = annotation.locator as Record<string, unknown>
  if (typeof locator.title === "string" && locator.title.trim()) {
    return locator.title
  }
  return typeof locator.href === "string" ? locator.href.replace(/^.*\/resource\//, "") : annotation.createdAt
}

function swatchClassForAnnotation(annotation: Annotation): string {
  const option = colorOptions.find((item) => item.color === annotation.color)
  return option?.className ?? "bg-yellow-300"
}

function groupDecorationsByColor(annotations: Annotation[]): Map<string, ReadiumDecoration[]> {
  const groups = new Map(decorationGroups.map((group) => [group, [] as ReadiumDecoration[]]))

  for (const annotation of annotations) {
    const decoration = annotationToDecoration(annotation)
    if (decoration) {
      groups.get(decorationGroupForColor(annotation.color))?.push(decoration)
    }
  }

  return groups
}

function annotationToDecoration(annotation: Annotation): ReadiumDecoration | null {
  const locator = Locator.deserialize(annotation.locator)
  if (!locator || annotation.color === "none") {
    return null
  }

  return {
    id: annotation.id,
    locator,
    style: {
      type: "highlight",
      tint: colorTintByName.get(annotation.color) ?? colorTintByName.get("yellow"),
      isActive: true,
      enforceContrast: false
    },
    extras: {
      quote: annotation.quote
    }
  }
}

function decorationGroupForColor(color: AnnotationColor): string {
  return color === "none" ? legacyDecorationGroup : `${legacyDecorationGroup}-${color}`
}

function selectionToolbarPosition(
  selection: { targetFrameSrc: string; width: number; x: number; y: number },
  navigator: ReadiumEpubNavigator,
  root: HTMLElement | null
): { left: number; top: number } | null {
  const rootRect = root?.getBoundingClientRect()
  const frame = (navigator._cframes ?? [])
    .map((candidate) => candidate?.iframe)
    .find((iframe) => iframe?.contentWindow?.location.href === selection.targetFrameSrc)

  if (!rootRect || !frame) {
    return null
  }

  const frameRect = frame.getBoundingClientRect()
  return clampToolbarPosition({
    left: frameRect.left - rootRect.left + selection.x + selection.width / 2,
    top: frameRect.top - rootRect.top + selection.y - 44
  }, rootRect)
}

function activationToolbarPosition(
  event: { point?: { x: number; y: number }; rect?: { left: number; top: number; width: number } },
  root: HTMLElement | null
): { left: number; top: number } | null {
  const rootRect = root?.getBoundingClientRect()
  if (!rootRect) {
    return null
  }

  const pixelRatio = window.devicePixelRatio || 1
  const rawLeft = event.point?.x ?? ((event.rect?.left ?? 0) + (event.rect?.width ?? 0) / 2)
  const rawTop = event.rect?.top ?? event.point?.y ?? 0
  const left = rawLeft > rootRect.width * 1.5 ? rawLeft / pixelRatio : rawLeft
  const top = rawTop > rootRect.height * 1.5 ? rawTop / pixelRatio : rawTop

  return clampToolbarPosition({ left, top: top - 44 }, rootRect)
}

function clampToolbarPosition(position: { left: number; top: number }, rootRect: DOMRect): { left: number; top: number } {
  return {
    left: Math.min(Math.max(16, position.left), Math.max(16, rootRect.width - 16)),
    top: Math.min(Math.max(16, position.top), Math.max(16, rootRect.height - 48))
  }
}
