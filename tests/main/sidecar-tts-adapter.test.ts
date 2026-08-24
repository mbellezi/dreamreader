import { describe, expect, it } from "vitest"
import { appendBoundedSidecarOutput } from "../../src/main/services/sidecar-tts-adapter"

describe("sidecar TTS output capture", () => {
  it("keeps recent diagnostics without retaining unbounded process output", () => {
    const prefix = "a".repeat(1024 * 1024)
    const suffix = "recent-error"

    const captured = appendBoundedSidecarOutput(prefix, suffix)

    expect(captured).toHaveLength(1024 * 1024)
    expect(captured.endsWith(suffix)).toBe(true)
  })
})
