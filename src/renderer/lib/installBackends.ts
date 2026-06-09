import type { RuntimeDiagnostic, RuntimeInstallBackend } from "@renderer/types"

export function effectiveInstallBackend(diagnostics: RuntimeDiagnostic[], selectedBackend: RuntimeInstallBackend): RuntimeInstallBackend {
  const availableBackends = installBackendsForDiagnostics(diagnostics)
  return availableBackends.includes(selectedBackend) ? selectedBackend : availableBackends[0]
}

export function installBackendsForDiagnostics(
  diagnostics: RuntimeDiagnostic[],
  hostPlatform = typeof navigator === "undefined" ? "" : `${navigator.platform} ${navigator.userAgent}`
): RuntimeInstallBackend[] {
  const deviceDetail = diagnostics.find((diagnostic) => diagnostic.id === "device")?.detail.toLowerCase() ?? ""
  const platform = deviceDetail || hostPlatform.toLowerCase()
  return platform.includes("darwin") || platform.includes("mac") ? ["mlx"] : ["cuda", "vulkan"]
}
