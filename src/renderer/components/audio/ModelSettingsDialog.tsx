import { CircleHelp } from "lucide-react"
import { useCallback, useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { TranslationFn } from "@renderer/app/types"
import type { AudioModelSettingField } from "@renderer/lib/audioModelSettings"
import { cn } from "@renderer/lib/utils"
import type { TtsModelSettings } from "@renderer/types"

export function ModelSettingsDialog({
  draftSettings,
  engineName,
  fields,
  t,
  onCancel,
  onChange,
  onReset,
  onSave
}: {
  draftSettings: TtsModelSettings
  engineName: string
  fields: AudioModelSettingField[]
  t: TranslationFn
  onCancel: () => void
  onChange: (settings: TtsModelSettings) => void
  onReset: () => void
  onSave: () => void
}) {
  const updateField = (field: AudioModelSettingField, value: boolean | number) => {
    onChange({
      ...draftSettings,
      [field.key]: value
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-md border bg-card p-4 shadow-lg" role="dialog" aria-modal="true" aria-label={t("audio.modelSettings.title")}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{t("audio.modelSettings.title")}</h3>
            <p className="mt-1 truncate text-xs text-muted-foreground">{engineName}</p>
          </div>
          <button className="rounded-sm px-2 py-1 text-xs text-muted-foreground hover:text-foreground" onClick={onCancel}>
            {t("audio.modelSettings.cancel")}
          </button>
        </div>

        {fields.length ? (
          <div className="mt-4 max-h-[60vh] space-y-3 overflow-auto pr-1">
            {fields.map((field) =>
              field.kind === "boolean" ? (
                <label key={String(field.key)} className="flex items-start justify-between gap-3 rounded-md border bg-background p-3 text-sm">
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 font-medium">
                      <span>{t(field.labelKey)}</span>
                      <ParameterHelp label={t(field.labelKey)} text={t(field.descriptionKey)} />
                    </span>
                  </span>
                  <input
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                    type="checkbox"
                    checked={Boolean(draftSettings[field.key])}
                    onChange={(event) => updateField(field, event.target.checked)}
                  />
                </label>
              ) : (
                <div key={String(field.key)} className="rounded-md border bg-background p-3">
                  <label className="block text-sm">
                    <span className="mb-2 flex items-center justify-between gap-3 text-xs font-medium text-muted-foreground">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate">{t(field.labelKey)}</span>
                        <ParameterHelp label={t(field.labelKey)} text={t(field.descriptionKey)} />
                      </span>
                      <span>{Number(draftSettings[field.key] ?? 0)}</span>
                    </span>
                    <input
                      className="w-full accent-primary"
                      type="range"
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      value={Number(draftSettings[field.key] ?? 0)}
                      onChange={(event) => updateField(field, Number(event.target.value))}
                    />
                  </label>
                  <div className="mt-2 flex justify-end">
                    <input
                      className="h-9 w-full rounded-md border bg-card px-2 text-sm outline-none"
                      type="number"
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      value={Number(draftSettings[field.key] ?? 0)}
                      onChange={(event) => updateField(field, Number(event.target.value))}
                    />
                  </div>
                </div>
              )
            )}
          </div>
        ) : (
          <p className="mt-4 rounded-md border bg-background p-3 text-sm text-muted-foreground">{t("audio.modelSettings.empty")}</p>
        )}

        <div className="mt-4 grid grid-cols-3 gap-2">
          <button className="inline-flex h-9 min-w-0 items-center justify-center rounded-md border bg-background px-3 text-sm" onClick={onReset}>
            <span className="truncate">{t("audio.modelSettings.reset")}</span>
          </button>
          <button className="inline-flex h-9 min-w-0 items-center justify-center rounded-md border bg-background px-3 text-sm" onClick={onCancel}>
            <span className="truncate">{t("audio.modelSettings.cancel")}</span>
          </button>
          <button className="inline-flex h-9 min-w-0 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground" onClick={onSave}>
            <span className="truncate">{t("audio.modelSettings.save")}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export function ParameterHelp({ label, text }: { label: string; text: string }) {
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const tooltipId = useId()
  const [tooltipPosition, setTooltipPosition] = useState<{
    left: number
    top: number
    width: number
    maxHeight: number
    placement: "above" | "below"
  } | null>(null)

  const positionTooltip = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect()
    if (!rect) {
      setTooltipPosition(null)
      return
    }

    const viewportPadding = 16
    const tooltipGap = 8
    const width = Math.min(288, window.innerWidth - viewportPadding * 2)
    const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, viewportPadding), window.innerWidth - width - viewportPadding)
    const belowTop = rect.bottom + tooltipGap
    const aboveTop = rect.top - tooltipGap
    const availableBelow = window.innerHeight - belowTop - viewportPadding
    const availableAbove = aboveTop - viewportPadding
    const shouldOpenAbove = availableBelow < 160 && availableAbove > availableBelow
    const maxHeight = Math.min(320, Math.max(96, shouldOpenAbove ? availableAbove : availableBelow))
    const top = shouldOpenAbove ? aboveTop : belowTop

    setTooltipPosition({
      left,
      top,
      width,
      maxHeight,
      placement: shouldOpenAbove ? "above" : "below"
    })
  }, [])

  useEffect(() => {
    if (!tooltipPosition) {
      return undefined
    }

    window.addEventListener("resize", positionTooltip)
    window.addEventListener("scroll", positionTooltip, true)

    return () => {
      window.removeEventListener("resize", positionTooltip)
      window.removeEventListener("scroll", positionTooltip, true)
    }
  }, [positionTooltip, tooltipPosition])

  return (
    <span
      ref={anchorRef}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      tabIndex={0}
      aria-label={text}
      aria-describedby={tooltipPosition ? tooltipId : undefined}
      onFocus={positionTooltip}
      onBlur={() => setTooltipPosition(null)}
      onMouseEnter={positionTooltip}
      onMouseLeave={() => setTooltipPosition(null)}
    >
      <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
      {tooltipPosition && typeof document !== "undefined"
        ? createPortal(
            <span
              id={tooltipId}
              className={cn(
                "pointer-events-none fixed z-[70] max-h-[min(50vh,20rem)] overflow-auto rounded-md border bg-card px-3 py-2 text-left text-xs font-normal leading-relaxed text-foreground shadow-lg",
                tooltipPosition.placement === "above" && "-translate-y-full"
              )}
              style={{
                left: tooltipPosition.left,
                maxHeight: tooltipPosition.maxHeight,
                top: tooltipPosition.top,
                width: tooltipPosition.width
              }}
              role="tooltip"
            >
              <span className="mb-1 block font-semibold">{label}</span>
              {text}
            </span>,
            document.body
          )
        : null}
    </span>
  )
}
