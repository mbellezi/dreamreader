import type { ReaderPreferences } from "@renderer/types"

export type TranslationFn = (key: string, values?: Record<string, string | number>) => string

export type AppView = "library" | "reader" | "audio" | "settings"

export type LibraryMode = "grid" | "list"

export type InspectorTab = "summary" | "annotations" | "preferences"

export type LibraryStatusTone = "info" | "success" | "warning" | "error"

export type LibraryStatus = {
  tone: LibraryStatusTone
  message: string
}

export type LibraryStatusDescriptor = {
  tone: LibraryStatusTone
  messageKey: string
  values?: Record<string, string | number>
  valueKeys?: Record<string, string>
}

export type ReaderPreferenceChangeHandler = <Key extends keyof ReaderPreferences>(
  key: Key,
  value: ReaderPreferences[Key]
) => void
