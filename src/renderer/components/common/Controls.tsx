import type { LucideIcon } from "lucide-react"
import { cn } from "@renderer/lib/utils"

export function NavButton({
  active,
  icon: Icon,
  label,
  onClick
}: {
  active: boolean
  icon: LucideIcon
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-sm px-3 text-sm text-muted-foreground transition",
        active && "bg-background text-foreground shadow-sm"
      )}
      title={label}
      onClick={onClick}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

export function IconToggle({
  active,
  icon: Icon,
  label,
  onClick
}: {
  active: boolean
  icon: LucideIcon
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={cn("inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-2 rounded-sm px-2 text-xs text-muted-foreground", active && "bg-card text-foreground shadow-sm")}
      title={label}
      onClick={onClick}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </button>
  )
}

export function SegmentButton({
  active,
  icon: Icon,
  label,
  onClick
}: {
  active: boolean
  icon: LucideIcon
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={cn("inline-flex h-12 min-w-0 items-center justify-center gap-2 rounded-md border bg-card px-2 text-center text-xs leading-tight text-muted-foreground", active && "border-primary text-primary ring-2 ring-primary/15")}
      onClick={onClick}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{label}</span>
    </button>
  )
}

export function SelectField({
  label,
  options,
  value,
  onChange
}: {
  label: string
  options: Array<{ label: string; value: string }>
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block text-sm">
      <span className="mb-2 block text-xs font-medium text-muted-foreground">{label}</span>
      <select className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function SliderField({
  label,
  max,
  min,
  value,
  onChange
}: {
  label: string
  max: number
  min: number
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="block text-sm">
      <span className="mb-2 flex items-center justify-between gap-3 text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        <span>{value}</span>
      </span>
      <input className="w-full accent-primary" type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  )
}
