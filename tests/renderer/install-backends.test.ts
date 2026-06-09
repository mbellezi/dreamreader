import { describe, expect, it } from "vitest"
import { effectiveInstallBackend, installBackendsForDiagnostics } from "../../src/renderer/lib/installBackends"
import type { RuntimeDiagnostic } from "../../src/renderer/types"

function device(detail: string): RuntimeDiagnostic {
  return {
    id: "device",
    label: "Device",
    status: "available",
    detail
  }
}

describe("install backends", () => {
  it("shows only MLX on macOS diagnostics", () => {
    expect(installBackendsForDiagnostics([device("darwin arm64 32GB")], "Windows")).toEqual(["mlx"])
    expect(effectiveInstallBackend([device("darwin arm64 32GB")], "cuda")).toBe("mlx")
  })

  it("shows CUDA and Vulkan on Windows/Linux diagnostics", () => {
    expect(installBackendsForDiagnostics([device("win32 x64 32GB")], "MacIntel")).toEqual(["cuda", "vulkan"])
    expect(installBackendsForDiagnostics([device("linux x64 32GB")], "MacIntel")).toEqual(["cuda", "vulkan"])
  })

  it("uses navigator platform fallback before diagnostics arrive", () => {
    expect(installBackendsForDiagnostics([], "MacIntel")).toEqual(["mlx"])
    expect(installBackendsForDiagnostics([], "Win32")).toEqual(["cuda", "vulkan"])
  })
})
