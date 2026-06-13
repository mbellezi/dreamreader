import { CheckCircle2, Circle, CircleSlash, Cpu, Download, FolderOpen, HardDrive, KeyRound, Loader2, RefreshCw, ServerCog, TerminalSquare, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { TranslationFn } from "@renderer/app/types"
import { buildVoiceEngineBundles, prosodyModels, type VoiceEngineBundle } from "@renderer/lib/engineBundles"
import { installBackendsForDiagnostics } from "@renderer/lib/installBackends"
import { cn } from "@renderer/lib/utils"
import type { HuggingFaceTokenStatus, ModelDownloadJob, RuntimeDiagnostic, RuntimeInstallBackend, RuntimeModel, RuntimeOperationJob, RuntimeOperationLogEntry, RuntimeSidecar, VoiceProfile } from "@renderer/types"

const ACTIVE_OPERATION_STATUSES = ["queued", "running"]
const CARD_OPERATION_STATUSES = [...ACTIVE_OPERATION_STATUSES, "failed"]
const RUNTIME_DIAGNOSTIC_IDS = ["device", "apple-silicon"]

export function EnginesPane({
  diagnostics,
  downloadJobs,
  huggingFaceTokenStatus,
  installBackend,
  loading,
  models,
  operations,
  sidecars,
  voices,
  t,
  onDeleteModel,
  onDownloadModel,
  onInstallEngine,
  onInstallModel,
  onInstallModelFromPath,
  onInstallSidecar,
  onRefresh,
  onSaveHuggingFaceToken,
  onSelectInstallBackend,
  onUninstallSidecar
}: {
  diagnostics: RuntimeDiagnostic[]
  downloadJobs: ModelDownloadJob[]
  huggingFaceTokenStatus: HuggingFaceTokenStatus
  installBackend: RuntimeInstallBackend
  loading: boolean
  models: RuntimeModel[]
  operations: RuntimeOperationJob[]
  sidecars: RuntimeSidecar[]
  voices: VoiceProfile[]
  t: TranslationFn
  onDeleteModel: (modelId: string) => Promise<void> | void
  onDownloadModel: (modelId: string) => Promise<void> | void
  onInstallEngine: (modelId: string) => Promise<void> | void
  onInstallModel: (modelId: string) => Promise<void> | void
  onInstallModelFromPath: () => Promise<void> | void
  onInstallSidecar: (sidecarId: string) => Promise<void> | void
  onRefresh: () => Promise<void> | void
  onSaveHuggingFaceToken: (token: string) => Promise<void> | void
  onSelectInstallBackend: (backend: RuntimeInstallBackend) => void
  onUninstallSidecar: (sidecarId: string) => Promise<void> | void
}) {
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null)
  const [huggingFaceToken, setHuggingFaceToken] = useState("")
  const selectedOperation = operations.find((operation) => operation.id === selectedOperationId) ?? null
  const modelBytes = useMemo(() => models.reduce((total, model) => total + (model.sizeBytes ?? 0), 0), [models])
  const activeOperations = operations.filter((operation) => ACTIVE_OPERATION_STATUSES.includes(operation.status))
  const availableModels = models.filter((model) => model.installStatus === "available")
  const availableSidecars = sidecars.filter((sidecar) => sidecar.status === "available")
  const showMetricSkeletons = loading && models.length === 0 && sidecars.length === 0
  const showModelSkeletons = loading && models.length === 0
  const embeddedDiagnostics = useMemo(() => embeddedDiagnosticsForCards(models, sidecars, diagnostics), [diagnostics, models, sidecars])
  const installBackends = useMemo(() => installBackendsForDiagnostics(diagnostics), [diagnostics])
  const selectedInstallBackend = installBackends.includes(installBackend) ? installBackend : installBackends[0]

  const voiceBundles = useMemo(() => buildVoiceEngineBundles(models, sidecars), [models, sidecars])
  const prosody = useMemo(() => prosodyModels(models), [models])
  const runtimeDiagnostics = useMemo(() => diagnostics.filter((diagnostic) => RUNTIME_DIAGNOSTIC_IDS.includes(diagnostic.id)), [diagnostics])

  // Mount refresh + poll while any model/operation is active. Drives live updates while the Motores tab is mounted.
  const hasActiveDownload = models.some((model) => model.installStatus === "queued" || model.installStatus === "downloading")
  const hasActiveOperation = operations.some((operation) => operation.status === "queued" || operation.status === "running")
  const isPolling = hasActiveDownload || hasActiveOperation

  useEffect(() => {
    void onRefresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!isPolling) {
      return
    }
    const interval = window.setInterval(() => {
      void onRefresh()
    }, 800)
    return () => window.clearInterval(interval)
  }, [isPolling, onRefresh])

  useEffect(() => {
    if (selectedInstallBackend !== installBackend) {
      onSelectInstallBackend(selectedInstallBackend)
    }
  }, [installBackend, onSelectInstallBackend, selectedInstallBackend])

  const operationFor = (targetKind: RuntimeOperationJob["targetKind"], targetId: string) =>
    operations
      .filter((operation) => operation.targetKind === targetKind && operation.targetId === targetId && CARD_OPERATION_STATUSES.includes(operation.status))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]

  const downloadJobFor = (modelId: string) => downloadJobs.find((job) => job.modelAssetId === modelId && (job.status === "queued" || job.status === "downloading"))

  const runtimeReady = runtimeDiagnostics.some((diagnostic) => diagnostic.status === "available")
  const engineReady = voiceBundles.some((bundle) => bundle.status === "ready")
  const prosodyReady = prosody.some((model) => model.installStatus === "available")
  const voiceReady = voices.length > 0

  return (
    <div className="space-y-6" aria-busy={loading}>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold leading-tight">{t("modelManager.title")}</h1>
            <p className="text-xs text-muted-foreground">{t("modelManager.subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-sm">
              <span className="text-xs text-muted-foreground">{t("modelManager.backend.label")}</span>
              <select
                className="bg-transparent text-sm outline-none"
                value={selectedInstallBackend}
                onChange={(event) => onSelectInstallBackend(event.target.value as RuntimeInstallBackend)}
              >
                {installBackends.map((backend) => (
                  <option key={backend} value={backend}>
                    {t(`modelManager.backend.${backend}`)}
                  </option>
                ))}
              </select>
            </label>
            <button className="inline-flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-sm" onClick={onRefresh}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
              <span>{t("modelManager.refresh")}</span>
            </button>
          </div>
        </header>

        <ReadinessChecklist runtimeReady={runtimeReady} engineReady={engineReady} prosodyReady={prosodyReady} voiceReady={voiceReady} t={t} />

        <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
          {showMetricSkeletons ? (
            <MetricCardSkeletons />
          ) : (
            <>
              <MetricCard icon={Cpu} label={t("modelManager.metric.models")} value={`${availableModels.length}/${models.length}`} />
              <MetricCard icon={ServerCog} label={t("modelManager.metric.sidecars")} value={`${availableSidecars.length}/${sidecars.length}`} />
              <MetricCard icon={HardDrive} label={t("modelManager.metric.storage")} value={formatBytes(modelBytes)} />
              <MetricCard icon={TerminalSquare} label={t("modelManager.metric.operations")} value={String(activeOperations.length)} />
            </>
          )}
        </section>

        <section className="space-y-3">
          <SectionTitle title={t("studio.engines.voice")} count={voiceBundles.length} />
          {showModelSkeletons ? (
            <ModelCardSkeletons />
          ) : voiceBundles.length ? (
            <div className="space-y-3">
              {voiceBundles.map((bundle) => (
                <VoiceEngineBundleCard
                  key={bundle.model.id}
                  bundle={bundle}
                  modelDiagnostics={embeddedDiagnostics.models.get(bundle.model.id) ?? []}
                  sidecarDiagnostics={bundle.sidecar ? embeddedDiagnostics.sidecars.get(bundle.sidecar.id) ?? [] : []}
                  downloadJob={downloadJobFor(bundle.model.id)}
                  modelOperation={operationFor("model", bundle.model.id)}
                  sidecarOperation={bundle.sidecar ? operationFor("sidecar", bundle.sidecar.id) : undefined}
                  t={t}
                  onDeleteModel={onDeleteModel}
                  onDownloadModel={onDownloadModel}
                  onInstallEngine={onInstallEngine}
                  onInstallModel={onInstallModel}
                  onInstallModelFromPath={onInstallModelFromPath}
                  onInstallSidecar={onInstallSidecar}
                  onOpenLogs={setSelectedOperationId}
                  onUninstallSidecar={onUninstallSidecar}
                />
              ))}
            </div>
          ) : (
            <EmptyState icon={CircleSlash} message={t("modelManager.models.empty")} />
          )}
        </section>

        <section className="space-y-3">
          <SectionTitle title={t("studio.engines.prosody")} count={prosody.length} />
          {showModelSkeletons ? (
            <ModelCardSkeletons />
          ) : prosody.length ? (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {prosody.map((model) => (
                <ModelCard
                  key={model.id}
                  diagnostics={embeddedDiagnostics.models.get(model.id) ?? []}
                  downloadJob={downloadJobFor(model.id)}
                  model={model}
                  operation={operationFor("model", model.id)}
                  t={t}
                  onDeleteModel={onDeleteModel}
                  onDownloadModel={onDownloadModel}
                  onInstallModel={onInstallModel}
                  onInstallModelFromPath={onInstallModelFromPath}
                  onOpenLogs={setSelectedOperationId}
                />
              ))}
            </div>
          ) : (
            <EmptyState icon={CircleSlash} message={t("modelManager.models.empty")} />
          )}
        </section>

        <section className="space-y-3">
          <SectionTitle title={t("studio.engines.runtime")} count={runtimeDiagnostics.length} />
          <div className="rounded-md border bg-card p-3">
            {runtimeDiagnostics.length ? (
              <DiagnosticsBlock diagnostics={runtimeDiagnostics} t={t} />
            ) : (
              <p className="text-sm text-muted-foreground">{t("modelManager.diagnostics.title")}</p>
            )}
          </div>
        </section>

        <details className="rounded-md border bg-card">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold">{t("studio.engines.account")}</summary>
          <div className="border-t p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <label className="block min-w-0 flex-1 text-sm">
                <span className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("modelManager.hfToken.label")}
                </span>
                <input
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none"
                  type="password"
                  placeholder={huggingFaceTokenStatus.configured ? t("modelManager.hfToken.placeholderConfigured") : t("modelManager.hfToken.placeholder")}
                  value={huggingFaceToken}
                  onChange={(event) => setHuggingFaceToken(event.target.value)}
                />
              </label>
              <div className="grid grid-cols-2 gap-2 md:w-64">
                <button
                  className="inline-flex h-10 min-w-0 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
                  onClick={async () => {
                    await onSaveHuggingFaceToken(huggingFaceToken)
                    setHuggingFaceToken("")
                  }}
                >
                  <span className="truncate">{t("modelManager.hfToken.save")}</span>
                </button>
                <button
                  className="inline-flex h-10 min-w-0 items-center justify-center rounded-md border bg-background px-3 text-sm"
                  onClick={async () => {
                    await onSaveHuggingFaceToken("")
                    setHuggingFaceToken("")
                  }}
                >
                  <span className="truncate">{t("modelManager.hfToken.clear")}</span>
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {huggingFaceTokenStatus.configured ? t("modelManager.hfToken.configured") : t("modelManager.hfToken.empty")}
            </p>
          </div>
        </details>

        <details className="rounded-md border bg-card" open={activeOperations.length > 0}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold">
            <span>{t("modelManager.operations.title")}</span>
            <span className="text-xs font-normal text-muted-foreground">{operations.length}</span>
          </summary>
          <div className="border-t p-4">
            {operations.length ? (
              <div className="space-y-2">
                {operations.slice(0, 8).map((operation) => (
                  <button
                    key={operation.id}
                    className="flex w-full items-center justify-between gap-3 rounded-md border bg-card p-3 text-left transition hover:border-primary"
                    onClick={() => setSelectedOperationId(operation.id)}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{operationTitle(operation, models, sidecars, t)}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{operationProgressLabel(operation, t)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-xs text-muted-foreground">{Math.round(operation.progress * 100)}%</span>
                      <StatusBadge status={operation.status} t={t} />
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState icon={TerminalSquare} message={t("modelManager.operations.empty")} />
            )}
          </div>
        </details>

      {selectedOperation ? (
        <OperationLogDialog
          models={models}
          operation={selectedOperation}
          sidecars={sidecars}
          t={t}
          onClose={() => setSelectedOperationId(null)}
        />
      ) : null}
    </div>
  )
}

function ReadinessChecklist({
  runtimeReady,
  engineReady,
  prosodyReady,
  voiceReady,
  t
}: {
  runtimeReady: boolean
  engineReady: boolean
  prosodyReady: boolean
  voiceReady: boolean
  t: TranslationFn
}) {
  const items: { ready: boolean; label: string }[] = [
    { ready: runtimeReady, label: t("studio.readiness.runtime") },
    { ready: engineReady, label: t("studio.readiness.engine") },
    { ready: prosodyReady, label: t("studio.readiness.prosody") },
    { ready: voiceReady, label: t("studio.readiness.voice") }
  ]
  return (
    <section className="rounded-md border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{t("studio.readiness.title")}</p>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.label} className="flex h-6 items-center gap-2 text-sm">
            {item.ready ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            ) : (
              <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span className={cn("truncate", item.ready ? "text-foreground" : "text-muted-foreground")}>{item.label}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function VoiceEngineBundleCard({
  bundle,
  modelDiagnostics,
  sidecarDiagnostics,
  downloadJob,
  modelOperation,
  sidecarOperation,
  t,
  onDeleteModel,
  onDownloadModel,
  onInstallEngine,
  onInstallModel,
  onInstallModelFromPath,
  onInstallSidecar,
  onOpenLogs,
  onUninstallSidecar
}: {
  bundle: VoiceEngineBundle
  modelDiagnostics: RuntimeDiagnostic[]
  sidecarDiagnostics: RuntimeDiagnostic[]
  downloadJob?: ModelDownloadJob
  modelOperation?: RuntimeOperationJob
  sidecarOperation?: RuntimeOperationJob
  t: TranslationFn
  onDeleteModel: (modelId: string) => Promise<void> | void
  onDownloadModel: (modelId: string) => Promise<void> | void
  onInstallEngine: (modelId: string) => Promise<void> | void
  onInstallModel: (modelId: string) => Promise<void> | void
  onInstallModelFromPath: () => Promise<void> | void
  onInstallSidecar: (sidecarId: string) => Promise<void> | void
  onOpenLogs: (operationId: string) => void
  onUninstallSidecar: (sidecarId: string) => Promise<void> | void
}) {
  const { model, sidecar, status } = bundle
  const busy =
    isOperationActive(modelOperation) ||
    isOperationActive(sidecarOperation) ||
    model.installStatus === "queued" ||
    model.installStatus === "downloading"

  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <Cpu className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="truncate text-sm font-medium">{model.name}</p>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {model.provider} · {model.runtime}
            {sidecar ? ` · ${sidecar.name}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <BundleStatusBadge status={status} t={t} />
          {status !== "ready" ? (
            <button
              className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
              disabled={busy}
              onClick={() => onInstallEngine(model.id)}
            >
              <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{t("studio.engines.install")}</span>
            </button>
          ) : null}
        </div>
      </div>
      <ProgressBlock downloadJob={downloadJob} operation={modelOperation ?? sidecarOperation} t={t} />
      <details className="mt-3 border-t pt-3">
        <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground">{t("studio.engines.details")}</summary>
        <div className="mt-3 space-y-3">
          <ModelCard
            diagnostics={modelDiagnostics}
            downloadJob={downloadJob}
            model={model}
            operation={modelOperation}
            t={t}
            onDeleteModel={onDeleteModel}
            onDownloadModel={onDownloadModel}
            onInstallModel={onInstallModel}
            onInstallModelFromPath={onInstallModelFromPath}
            onOpenLogs={onOpenLogs}
          />
          {sidecar ? (
            <SidecarCard
              diagnostics={sidecarDiagnostics}
              operation={sidecarOperation}
              sidecar={sidecar}
              t={t}
              onInstallSidecar={onInstallSidecar}
              onOpenLogs={onOpenLogs}
              onUninstallSidecar={onUninstallSidecar}
            />
          ) : null}
        </div>
      </details>
    </div>
  )
}

function BundleStatusBadge({ status, t }: { status: VoiceEngineBundle["status"]; t: TranslationFn }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-sm px-2 py-1 text-xs",
        status === "ready"
          ? "bg-primary/10 text-primary"
          : status === "missing"
            ? "bg-muted text-muted-foreground"
            : "bg-amber-500/10 text-amber-600"
      )}
    >
      {t(`modelManager.status.${status === "ready" ? "available" : status === "missing" ? "not_configured" : "queued"}`)}
    </span>
  )
}

function MetricCard({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className="mt-2 text-xl font-semibold leading-tight">{value}</p>
    </div>
  )
}

function isOperationActive(operation: RuntimeOperationJob | undefined): boolean {
  return Boolean(operation && ACTIVE_OPERATION_STATUSES.includes(operation.status))
}

function MetricCardSkeletons() {
  return Array.from({ length: 4 }, (_, index) => (
    <div key={index} className="rounded-md border bg-card p-3" aria-hidden="true">
      <div className="animate-pulse">
        <div className="flex items-center justify-between gap-3">
          <SkeletonLine className="h-3 w-24" />
          <SkeletonLine className="h-4 w-4 rounded-full" />
        </div>
        <SkeletonLine className="mt-3 h-6 w-14" />
      </div>
    </div>
  ))
}

function SectionTitle({ count, title }: { count: number; title: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <span className="text-xs text-muted-foreground">{count}</span>
    </div>
  )
}

function SidecarCard({
  diagnostics,
  operation,
  sidecar,
  t,
  onInstallSidecar,
  onOpenLogs,
  onUninstallSidecar
}: {
  diagnostics: RuntimeDiagnostic[]
  operation?: RuntimeOperationJob
  sidecar: RuntimeSidecar
  t: TranslationFn
  onInstallSidecar: (sidecarId: string) => Promise<void> | void
  onOpenLogs: (operationId: string) => void
  onUninstallSidecar: (sidecarId: string) => Promise<void> | void
}) {
  const busy = isOperationActive(operation)
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <ServerCog className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="truncate text-sm font-medium">{sidecar.name}</p>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{sidecar.runtime}</p>
        </div>
        <StatusBadge status={sidecar.status} t={t} />
      </div>
      {sidecar.executablePath ? <PathLine path={sidecar.executablePath} /> : null}
      {sidecar.sizeBytes ? <p className="mt-2 text-xs text-muted-foreground">{t("modelManager.size", { size: formatBytes(sidecar.sizeBytes) })}</p> : null}
      <DiagnosticsBlock diagnostics={diagnostics} t={t} />
      <ProgressBlock operation={operation} t={t} />
      <div className="mt-3 grid grid-cols-2 gap-2">
        {sidecar.status === "available" ? (
          <button className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm" disabled={busy} onClick={() => onUninstallSidecar(sidecar.id)}>
            <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{t("modelManager.sidecar.uninstall")}</span>
          </button>
        ) : (
          <button className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground" disabled={busy} onClick={() => onInstallSidecar(sidecar.id)}>
            <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{t("modelManager.sidecar.install")}</span>
          </button>
        )}
        <button className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm" disabled={!operation} onClick={() => operation && onOpenLogs(operation.id)}>
          <TerminalSquare className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{t("modelManager.logs.open")}</span>
        </button>
      </div>
    </div>
  )
}

function ModelCardSkeletons() {
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="rounded-md border bg-card p-3" aria-hidden="true">
          <CardSkeleton showModelActions />
        </div>
      ))}
    </div>
  )
}

function CardSkeleton({ showModelActions }: { showModelActions: boolean }) {
  return (
    <div className="animate-pulse">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <SkeletonLine className="h-4 w-4 rounded-full" />
            <SkeletonLine className="h-4 w-48 max-w-full" />
          </div>
          <SkeletonLine className="mt-2 h-3 w-64 max-w-full" />
        </div>
        <SkeletonLine className="h-6 w-24" />
      </div>
      <SkeletonLine className="mt-3 h-3 w-full" />
      <div className="mt-3 space-y-2 border-t pt-3">
        <SkeletonLine className="h-3 w-20" />
        <div className="flex items-center justify-between gap-3">
          <SkeletonLine className="h-3 w-44 max-w-full" />
          <SkeletonLine className="h-5 w-20" />
        </div>
        <SkeletonLine className="h-3 w-full" />
      </div>
      <div className={cn("mt-3 grid gap-2", showModelActions ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2")}>
        {Array.from({ length: showModelActions ? 4 : 2 }, (_, index) => (
          <SkeletonLine key={index} className="h-9 w-full" />
        ))}
      </div>
    </div>
  )
}

function ModelCard({
  diagnostics,
  downloadJob,
  model,
  operation,
  t,
  onDeleteModel,
  onDownloadModel,
  onInstallModel,
  onInstallModelFromPath,
  onOpenLogs
}: {
  diagnostics: RuntimeDiagnostic[]
  downloadJob?: ModelDownloadJob
  model: RuntimeModel
  operation?: RuntimeOperationJob
  t: TranslationFn
  onDeleteModel: (modelId: string) => Promise<void> | void
  onDownloadModel: (modelId: string) => Promise<void> | void
  onInstallModel: (modelId: string) => Promise<void> | void
  onInstallModelFromPath: () => Promise<void> | void
  onOpenLogs: (operationId: string) => void
}) {
  const busy = isOperationActive(operation) || model.installStatus === "queued" || model.installStatus === "downloading"
  const canAutoInstall = Boolean(model.metadata.huggingFaceRepo && model.metadata.localFolder)
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <Cpu className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="truncate text-sm font-medium">{model.name}</p>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {t(`audio.modelKind.${model.kind}`)} · {model.provider} · {model.runtime} · {model.format}
          </p>
        </div>
        <StatusBadge status={model.installStatus} t={t} />
      </div>
      {model.path ? <PathLine path={model.path} /> : null}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{t("modelManager.size", { size: formatBytes(model.sizeBytes ?? 0) })}</span>
        {model.memoryEstimateMb ? <span>{t("modelManager.memory", { memory: formatBytes(model.memoryEstimateMb * 1024 * 1024) })}</span> : null}
        <span>{model.license}</span>
      </div>
      <DiagnosticsBlock diagnostics={diagnostics} t={t} />
      <ProgressBlock downloadJob={downloadJob} operation={operation} t={t} />
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        {model.canDownload && model.installStatus !== "available" ? (
          <button className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground" disabled={busy} onClick={() => onDownloadModel(model.id)}>
            <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{t(model.installStatus === "failed" ? "modelManager.model.retry" : "modelManager.model.download")}</span>
          </button>
        ) : null}
        {canAutoInstall && model.installStatus !== "available" ? (
          <button className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground" disabled={busy} onClick={() => onInstallModel(model.id)}>
            <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{t("modelManager.model.install")}</span>
          </button>
        ) : null}
        {model.installStatus !== "available" ? (
          <button className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm" disabled={busy} onClick={onInstallModelFromPath}>
            <FolderOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{t("modelManager.model.installLocal")}</span>
          </button>
        ) : (
          <button
            className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm text-destructive"
            disabled={busy}
            onClick={() => {
              if (window.confirm(t("modelManager.model.deleteConfirm"))) {
                void onDeleteModel(model.id)
              }
            }}
          >
            <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{t("modelManager.model.delete")}</span>
          </button>
        )}
        <button className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm" disabled={!operation} onClick={() => operation && onOpenLogs(operation.id)}>
          <TerminalSquare className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{t("modelManager.logs.open")}</span>
        </button>
      </div>
    </div>
  )
}

function DiagnosticsBlock({ diagnostics, t }: { diagnostics: RuntimeDiagnostic[]; t: TranslationFn }) {
  if (!diagnostics.length) {
    return null
  }

  return (
    <div className="mt-3 space-y-2 border-t pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{t("modelManager.diagnostics.title")}</span>
        <span className="text-xs text-muted-foreground">{diagnostics.length}</span>
      </div>
      <div className="space-y-2">
        {diagnostics.map((diagnostic) => (
          <div key={diagnostic.id} className="min-w-0">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-xs font-medium">{diagnosticLabel(diagnostic, t)}</span>
              <StatusBadge status={diagnostic.status} t={t} />
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{diagnosticDetail(diagnostic, t)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProgressBlock({ downloadJob, operation, t }: { downloadJob?: ModelDownloadJob; operation?: RuntimeOperationJob; t: TranslationFn }) {
  const progress = operation?.progress ?? downloadJob?.progress
  if (progress === undefined) {
    return null
  }
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{operation ? operationProgressLabel(operation, t) : downloadProgressLabel(downloadJob, t)}</span>
        <span>{Math.round(progress * 100)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
    </div>
  )
}

function OperationLogDialog({
  models,
  operation,
  sidecars,
  t,
  onClose
}: {
  models: RuntimeModel[]
  operation: RuntimeOperationJob
  sidecars: RuntimeSidecar[]
  t: TranslationFn
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-md border bg-card p-4 shadow-lg" role="dialog" aria-modal="true" aria-label={t("modelManager.logs.title")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{operationTitle(operation, models, sidecars, t)}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{operationProgressLabel(operation, t)}</p>
          </div>
          <button className="rounded-sm px-2 py-1 text-xs text-muted-foreground hover:text-foreground" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(operation.progress * 100)}%` }} />
        </div>
        <div className="mt-4 min-h-0 flex-1 overflow-auto rounded-md border bg-background p-3 font-mono text-xs leading-relaxed">
          {operation.logs.length ? (
            operation.logs.map((log) => (
              <p key={log.id} className={cn("whitespace-pre-wrap break-words", log.level === "error" && "text-destructive", log.level === "warning" && "text-amber-600")}>
                <span className="text-muted-foreground">[{formatLogTime(log.createdAt)}]</span> {operationLogText(log, t)}
              </p>
            ))
          ) : (
            <p className="text-muted-foreground">{t("modelManager.logs.empty")}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status, t }: { status: RuntimeModel["installStatus"] | RuntimeSidecar["status"] | RuntimeDiagnostic["status"] | RuntimeOperationJob["status"]; t: TranslationFn }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-sm px-2 py-1 text-xs",
        status === "available" || status === "completed"
          ? "bg-primary/10 text-primary"
          : status === "failed"
            ? "bg-destructive/10 text-destructive"
            : "bg-muted text-muted-foreground"
      )}
    >
      {t(`modelManager.status.${status}`)}
    </span>
  )
}

function PathLine({ path }: { path: string }) {
  return (
    <p className="mt-2 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
      <HardDrive className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{path}</span>
    </p>
  )
}

function EmptyState({ icon: Icon, message }: { icon: typeof CircleSlash; message: string }) {
  return (
    <div className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </div>
    </div>
  )
}

function SkeletonLine({ className }: { className: string }) {
  return <div className={cn("rounded-sm bg-muted", className)} />
}

function embeddedDiagnosticsForCards(
  models: RuntimeModel[],
  sidecars: RuntimeSidecar[],
  diagnostics: RuntimeDiagnostic[]
): { models: Map<string, RuntimeDiagnostic[]>; sidecars: Map<string, RuntimeDiagnostic[]> } {
  const modelDiagnostics = new Map<string, RuntimeDiagnostic[]>()
  const sidecarDiagnostics = new Map<string, RuntimeDiagnostic[]>()
  const assignedIds = new Set<string>()

  for (const model of models) {
    const items = diagnosticsForModel(model, diagnostics)
    modelDiagnostics.set(model.id, items)
    items.forEach((diagnostic) => assignedIds.add(diagnostic.id))
  }

  for (const sidecar of sidecars) {
    const items = diagnosticsForSidecar(sidecar, diagnostics)
    sidecarDiagnostics.set(sidecar.id, items)
    items.forEach((diagnostic) => assignedIds.add(diagnostic.id))
  }

  const unassignedDiagnostics = diagnostics.filter((diagnostic) => !assignedIds.has(diagnostic.id))
  if (!unassignedDiagnostics.length) {
    return { models: modelDiagnostics, sidecars: sidecarDiagnostics }
  }

  const firstSidecar = sidecars[0]
  if (firstSidecar) {
    sidecarDiagnostics.set(firstSidecar.id, mergeUniqueDiagnostics(sidecarDiagnostics.get(firstSidecar.id) ?? [], unassignedDiagnostics))
    return { models: modelDiagnostics, sidecars: sidecarDiagnostics }
  }

  const firstModel = models[0]
  if (firstModel) {
    modelDiagnostics.set(firstModel.id, mergeUniqueDiagnostics(modelDiagnostics.get(firstModel.id) ?? [], unassignedDiagnostics))
  }

  return { models: modelDiagnostics, sidecars: sidecarDiagnostics }
}

function mergeUniqueDiagnostics(current: RuntimeDiagnostic[], next: RuntimeDiagnostic[]): RuntimeDiagnostic[] {
  const seenIds = new Set(current.map((diagnostic) => diagnostic.id))
  return [...current, ...next.filter((diagnostic) => !seenIds.has(diagnostic.id))]
}

function diagnosticsForModel(model: RuntimeModel, diagnostics: RuntimeDiagnostic[]): RuntimeDiagnostic[] {
  const diagnosticIds = new Set<string>()
  const engineId = model.engineId ?? ""
  const provider = model.provider.toLowerCase()

  if (metadataRole(model) === "prosody" || model.kind === "llm") {
    diagnosticIds.add("qwen-prosody-gguf")
    diagnosticIds.add("local-prosody-analyzer")
  }

  if (engineId.startsWith("qwen3-tts") || provider.includes("qwen")) {
    diagnosticIds.add("qwen3-tts-sidecar")
  }

  if (engineId.startsWith("chatterbox") || provider.includes("chatterbox") || provider.includes("resemble")) {
    diagnosticIds.add("chatterbox-tts-sidecar")
  }

  if (engineId.startsWith("f5-tts") || provider.includes("firstpixel")) {
    diagnosticIds.add("f5-tts-sidecar")
  }

  return diagnostics.filter((diagnostic) => diagnosticIds.has(diagnostic.id))
}

function diagnosticsForSidecar(sidecar: RuntimeSidecar, diagnostics: RuntimeDiagnostic[]): RuntimeDiagnostic[] {
  const diagnosticIds = new Set(["device", "apple-silicon"])

  if (sidecar.adapterId === "qwen3-tts-mlx") {
    diagnosticIds.add("qwen3-tts-sidecar")
  }

  if (sidecar.adapterId === "chatterbox-mlx") {
    diagnosticIds.add("chatterbox-tts-sidecar")
  }

  if (sidecar.adapterId === "f5-tts-pt-br") {
    diagnosticIds.add("f5-tts-sidecar")
  }

  return diagnostics.filter((diagnostic) => diagnosticIds.has(diagnostic.id))
}

function metadataRole(model: RuntimeModel): string | undefined {
  const role = model.metadata.role
  return typeof role === "string" ? role : undefined
}

function diagnosticLabel(diagnostic: RuntimeDiagnostic, t: TranslationFn): string {
  return translatedOrFallback(t, `audio.diagnostic.${diagnostic.id}.label`, diagnostic.label)
}

function diagnosticDetail(diagnostic: RuntimeDiagnostic, t: TranslationFn): string {
  if (diagnostic.id === "apple-silicon") {
    return t(`audio.diagnostic.apple-silicon.detail.${diagnostic.status === "available" ? "available" : "fallback"}`)
  }
  return translatedOrFallback(t, `audio.diagnostic.${diagnostic.id}.detail`, diagnostic.detail, { detail: diagnostic.detail })
}

function operationTitle(operation: RuntimeOperationJob, models: RuntimeModel[], sidecars: RuntimeSidecar[], t: TranslationFn): string {
  const targetName =
    operation.targetKind === "model"
      ? models.find((model) => model.id === operation.targetId)?.name ?? operation.targetId
      : sidecars.find((sidecar) => sidecar.id === operation.targetId)?.name ?? operation.targetId
  return t(`modelManager.operation.${operation.kind}`, { target: targetName })
}

function operationProgressLabel(operation: RuntimeOperationJob, t: TranslationFn): string {
  if (!operation.progressLabelKey) {
    return t(`modelManager.status.${operation.status}`)
  }
  return translatedOrFallback(t, operation.progressLabelKey, operation.progressLabelKey, formatLogValues(operation.progressLabelValues))
}

function downloadProgressLabel(job: ModelDownloadJob | undefined, t: TranslationFn): string {
  if (!job) {
    return t("modelManager.progress.downloading")
  }
  return t("modelManager.progress.downloadBytes", {
    received: formatBytes(job.receivedBytes),
    total: formatBytes(job.totalBytes ?? 0)
  })
}

function operationLogText(log: RuntimeOperationLogEntry, t: TranslationFn): string {
  return translatedOrFallback(t, log.messageKey, log.messageKey, formatLogValues(log.values))
}

function formatLogValues(values: Record<string, string | number>): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      typeof value === "number" && (key === "received" || key === "total" || key === "size" || key === "memory") ? formatBytes(value) : value
    ])
  )
}

function translatedOrFallback(t: TranslationFn, key: string, fallback: string, values?: Record<string, string | number>): string {
  const value = t(key, values)
  return value === key ? fallback : value
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B"
  }
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

function formatLogTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}
