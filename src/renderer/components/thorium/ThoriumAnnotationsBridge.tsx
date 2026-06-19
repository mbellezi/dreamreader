import { Trash2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react"
import { Locator } from "@readium/shared"
import type { TranslationFn } from "@renderer/app/types"
import { dreamreaderClient } from "@renderer/lib/dreamreader"
import {
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

const decorationGroup = "dreamreader-annotations"
const colorOptions: Array<{ color: Exclude<AnnotationColor, "none">; className: string; tint: string }> = [
  { color: "yellow", className: "bg-yellow-300", tint: "rgba(250, 204, 21, 0.48)" },
  { color: "green", className: "bg-emerald-300", tint: "rgba(110, 231, 183, 0.48)" },
  { color: "blue", className: "bg-sky-300", tint: "rgba(125, 211, 252, 0.5)" },
  { color: "pink", className: "bg-rose-300", tint: "rgba(253, 164, 175, 0.52)" },
  { color: "purple", className: "bg-violet-300", tint: "rgba(196, 181, 253, 0.52)" }
]
const colorTintByName = new Map(colorOptions.map((item) => [item.color, item.tint]))

export function ThoriumAnnotationsBridge({ bookId, t }: { bookId: string; t: TranslationFn }): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [navigator, setNavigator] = useState<ReadiumEpubNavigator | null>(null)
  const [saving, setSaving] = useState(false)
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null)

  useEffect(() => subscribeReadiumEpubNavigator(setNavigator), [])

  useEffect(() => {
    let cancelled = false

    dreamreaderClient.listStoredAnnotations(bookId)
      .then((items) => {
        if (!cancelled) {
          setAnnotations(items)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAnnotations([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [bookId])

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

  const decorations = useMemo(() => annotations.flatMap(annotationToDecoration), [annotations])

  useEffect(() => {
    if (!navigator?.applyDecorations) {
      return
    }

    navigator.applyDecorations(decorations, decorationGroup)

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

    navigator.registerDecorationObserver?.(decorationGroup, observer)

    return () => {
      navigator.unregisterDecorationObserver?.(observer)
      navigator.applyDecorations?.([], decorationGroup)
    }
  }, [decorations, navigator])

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
      setToolbar(null)
    } finally {
      setSaving(false)
    }
  }

  const updateAnnotation = async (color: AnnotationColor) => {
    if (!toolbar || toolbar.mode !== "edit") {
      return
    }

    setSaving(true)
    try {
      const updated = await dreamreaderClient.updateStoredAnnotation({
        id: toolbar.annotationId,
        color
      })
      setAnnotations((current) => current.map((annotation) => annotation.id === updated.id ? updated : annotation))
      setToolbar(null)
    } finally {
      setSaving(false)
    }
  }

  const deleteAnnotation = async () => {
    if (!toolbar || toolbar.mode !== "edit") {
      return
    }

    const annotationId = toolbar.annotationId
    setSaving(true)
    try {
      await dreamreaderClient.deleteStoredAnnotation(annotationId)
      setAnnotations((current) => current.filter((annotation) => annotation.id !== annotationId))
      setToolbar(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      ref={rootRef}
      className={cn("absolute inset-0 z-40", toolbar ? "pointer-events-auto" : "pointer-events-none")}
      onMouseDown={() => setToolbar(null)}
    >
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
              onClick={() => void deleteAnnotation()}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function annotationToDecoration(annotation: Annotation): ReadiumDecoration[] {
  const locator = Locator.deserialize(annotation.locator)
  if (!locator || annotation.color === "none") {
    return []
  }

  return [{
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
  }]
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
