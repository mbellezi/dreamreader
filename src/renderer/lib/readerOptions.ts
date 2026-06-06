import type { AppearanceTheme, HighlightColor, ReaderFontFamily } from "@renderer/types"

export const themeOptions: AppearanceTheme[] = ["light", "dark", "sepia", "contrast"]

export const colorOptions: HighlightColor[] = ["yellow", "green", "blue", "rose", "purple"]

export const fontFamilyOptions: Array<{ value: ReaderFontFamily; labelKey: string; stack: string }> = [
  { value: "georgia", labelKey: "reader.font.georgia", stack: 'Georgia, Cambria, "Times New Roman", serif' },
  { value: "palatino", labelKey: "reader.font.palatino", stack: 'Palatino, "Palatino Linotype", "Book Antiqua", serif' },
  { value: "charter", labelKey: "reader.font.charter", stack: 'Charter, "Iowan Old Style", "Athelas", Georgia, serif' },
  { value: "system-serif", labelKey: "reader.font.systemSerif", stack: 'ui-serif, Georgia, Cambria, "Times New Roman", serif' },
  { value: "system-sans", labelKey: "reader.font.systemSans", stack: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }
]

export const fontStackByFamily = Object.fromEntries(fontFamilyOptions.map((option) => [option.value, option.stack])) as Record<ReaderFontFamily, string>

export const swatchClasses: Record<HighlightColor, string> = {
  yellow: "bg-yellow-300",
  green: "bg-emerald-300",
  blue: "bg-sky-300",
  rose: "bg-rose-300",
  purple: "bg-violet-300"
}

export const inlineHighlightClasses: Record<HighlightColor, string> = {
  yellow: "bg-yellow-200/55 text-inherit",
  green: "bg-emerald-200/55 text-inherit",
  blue: "bg-sky-200/55 text-inherit",
  rose: "bg-rose-200/55 text-inherit",
  purple: "bg-violet-200/55 text-inherit"
}

export const themePreviewClasses: Record<AppearanceTheme, string> = {
  light: "bg-white",
  dark: "bg-neutral-950",
  sepia: "bg-[#f3e6cc]",
  contrast: "bg-black ring-2 ring-yellow-300"
}
