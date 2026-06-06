import { Check } from "lucide-react"
import { SelectField, SliderField } from "@renderer/components/common/Controls"
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
      <section className="w-full max-w-xl rounded-md border bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t("settings.title")}</h2>
            {saved ? <p className="mt-1 text-sm text-primary">{t("settings.saved")}</p> : null}
          </div>
          <button className="rounded-md border bg-background px-3 py-2 text-sm" onClick={onClose}>
            {t("common.close")}
          </button>
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
        <div className="mt-5 rounded-md border bg-background p-4">
          <h3 className="text-sm font-semibold">{t("settings.readerDefaults")}</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <SliderField
              label={t("reader.fontScale")}
              value={settings.reader.fontScale}
              min={14}
              max={24}
              onChange={(value) => onUpdate({ ...settings, reader: { ...settings.reader, fontScale: value } })}
            />
            <SliderField
              label={t("reader.lineHeight")}
              value={Math.round(settings.reader.lineHeight * 10)}
              min={14}
              max={22}
              onChange={(value) => onUpdate({ ...settings, reader: { ...settings.reader, lineHeight: value / 10 } })}
            />
          </div>
        </div>
        <button className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground" onClick={onSave}>
          <Check className="h-4 w-4" aria-hidden="true" />
          {t("settings.save")}
        </button>
      </section>
    </div>
  )
}
