import { RefreshCw, SlidersHorizontal } from "lucide-react"
import { SelectField } from "@renderer/components/common/Controls"
import { ModelSettingsDialog } from "@renderer/components/audio/ModelSettingsDialog"
import type { TranslationFn } from "@renderer/app/types"
import { defaultModelSettingsForEngine } from "@renderer/lib/audioModelSettings"
import type { GenerationConfig } from "@renderer/app/useGenerationConfig"

export function GenerationControls({ config, t }: { config: GenerationConfig; t: TranslationFn }) {
  return (
    <section className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_8rem_auto_2.5rem_2.5rem] lg:items-end">
        <SelectField label={t("audio.engine")} options={config.engineOptions} value={config.selectedEngineId} onChange={config.setSelectedEngineId} />
        <label className="block text-sm">
          <span className="mb-2 block text-xs font-medium text-muted-foreground">{t("audio.seed")}</span>
          <input
            className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none"
            type="number"
            min={0}
            max={4294967295}
            value={config.seed}
            onChange={(event) => config.setSeed(event.target.value)}
          />
        </label>
        <label className="flex h-10 items-center gap-2 rounded-md border bg-card px-3 text-sm lg:mb-0">
          <input
            className="h-4 w-4 shrink-0 accent-primary"
            type="checkbox"
            checked={config.seedFixed}
            onChange={(event) => config.setSeedFixed(event.target.checked)}
          />
          <span className="whitespace-nowrap">{t("audio.seed.fixed")}</span>
        </label>
        <button
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border bg-background text-muted-foreground hover:text-foreground"
          title={t("audio.seed.generate")}
          onClick={config.randomizeSeed}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border bg-card text-muted-foreground hover:text-foreground"
          disabled={!config.selectedEngineId}
          title={t("audio.modelSettings.open")}
          onClick={config.openModelSettings}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <SelectField label={t("audio.voice")} options={config.voiceOptions} value={config.selectedVoiceId} onChange={config.setSelectedVoiceId} />
        {config.generationLanguageOptions.length ? (
          <SelectField
            label={t("audio.language")}
            options={config.generationLanguageOptions}
            value={config.selectedGenerationLanguage}
            onChange={config.setGenerationLanguage}
          />
        ) : null}
      </div>
      {!config.canGenerate && config.canGenerateReason ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {t(`audio.generateUnavailable.${config.canGenerateReason}`)}
        </p>
      ) : null}

      {config.modelSettingsDialogOpen ? (
        <ModelSettingsDialog
          draftSettings={config.modelSettingsDraft}
          engineName={config.engineOptions.find((option) => option.value === config.selectedEngineId)?.label ?? config.selectedEngineId}
          fields={config.modelSettingsFields}
          t={t}
          onCancel={config.closeModelSettings}
          onChange={config.setModelSettingsDraft}
          onReset={() => config.setModelSettingsDraft(defaultModelSettingsForEngine(config.selectedEngineId))}
          onSave={config.saveModelSettings}
        />
      ) : null}
    </section>
  )
}
