import { RefreshCw, SlidersHorizontal } from "lucide-react"
import { SelectField } from "@renderer/components/common/Controls"
import { ModelSettingsDialog } from "@renderer/components/audio/ModelSettingsDialog"
import type { TranslationFn } from "@renderer/app/types"
import { defaultModelSettingsForEngine } from "@renderer/lib/audioModelSettings"
import type { GenerationConfig } from "@renderer/app/useGenerationConfig"

export function GenerationControls({ config, t }: { config: GenerationConfig; t: TranslationFn }) {
  return (
    <section className="space-y-3">
      <div className="grid grid-cols-[minmax(0,1fr)_2.5rem] items-end gap-2">
        <SelectField
          label={t("audio.engine")}
          options={config.engineOptions}
          value={config.selectedEngineId}
          onChange={config.setSelectedEngineId}
        />
        <button
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border bg-card text-muted-foreground hover:text-foreground"
          disabled={!config.selectedEngineId}
          title={t("audio.modelSettings.open")}
          onClick={config.openModelSettings}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <SelectField
        label={t("audio.voice")}
        options={config.voiceOptions}
        value={config.selectedVoiceId}
        onChange={config.setSelectedVoiceId}
      />
      <div className="space-y-3 rounded-md border bg-card p-3">
        {config.generationLanguageOptions.length ? (
          <SelectField
            label={t("audio.language")}
            options={config.generationLanguageOptions}
            value={config.selectedGenerationLanguage}
            onChange={config.setGenerationLanguage}
          />
        ) : null}
        <div className="space-y-2">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>{t("audio.seed.fixed")}</span>
            <input
              className="h-4 w-4 accent-primary"
              type="checkbox"
              checked={config.seedFixed}
              onChange={(event) => config.setSeedFixed(event.target.checked)}
            />
          </label>
          <div className="grid grid-cols-[minmax(0,1fr)_2.5rem] gap-2">
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
            <button
              className="mt-6 inline-flex h-10 w-10 items-center justify-center rounded-md border bg-background text-muted-foreground hover:text-foreground"
              title={t("audio.seed.generate")}
              onClick={config.randomizeSeed}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      <SelectField
        label={t("audio.quality")}
        options={["draft", "standard", "high"].map((item) => ({
          label: t(`audio.quality.${item}`),
          value: item
        }))}
        value={config.quality}
        onChange={(value) => config.setQuality(value as "draft" | "standard" | "high")}
      />
      <label className="flex items-center justify-between rounded-md border bg-card p-3 text-sm">
        <span>{t("audio.expressive")}</span>
        <input
          className="h-4 w-4 accent-primary"
          type="checkbox"
          checked={config.useExpressiveNarration}
          onChange={(event) => config.setUseExpressiveNarration(event.target.checked)}
        />
      </label>

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
