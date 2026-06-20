import { Check } from "lucide-react"
import { SelectField } from "@renderer/components/common/Controls"
import type { TranslationFn } from "@renderer/app/types"
import { themeOptions } from "@renderer/lib/readerOptions"
import type { AppSettings, AppearanceTheme, Locale } from "@renderer/types"

export function SettingsDialog({
  settings,
  saved,
  t,
  onClose,
  onSave,
  onUpdate
}: {
  settings: AppSettings
  saved: boolean
  t: TranslationFn
  onClose: () => void
  onSave: () => void
  onUpdate: (settings: AppSettings) => void
}) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/35 p-4">
      <section className="w-full max-w-xl rounded-md border bg-card p-5 shadow-lg" role="dialog" aria-modal="true" aria-label={t("settings.title")}>
        <div>
          <h2 className="text-lg font-semibold">{t("settings.title")}</h2>
          {saved ? <p className="mt-1 text-sm text-primary">{t("settings.saved")}</p> : null}
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <SelectField
            label={t("settings.language")}
            value={settings.locale}
            onChange={(value) => onUpdate({ ...settings, locale: value as Locale })}
            options={[
              { value: "pt-BR", label: t("settings.ptBR") },
              { value: "en", label: t("settings.en") }
            ]}
          />
          <SelectField
            label={t("settings.appearance")}
            value={settings.appearance}
            onChange={(value) => onUpdate({ ...settings, appearance: value as AppearanceTheme })}
            options={themeOptions.map((theme) => ({ value: theme, label: t(`reader.theme.${theme}`) }))}
          />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button className="inline-flex h-10 items-center justify-center rounded-md border bg-background px-4 text-sm" onClick={onClose}>
            {t("common.close")}
          </button>
          <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground" onClick={onSave}>
            <Check className="h-4 w-4" aria-hidden="true" />
            {t("settings.save")}
          </button>
        </div>
      </section>
    </div>
  )
}
