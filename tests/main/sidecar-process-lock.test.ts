import { describe, expect, it } from "vitest"
import { runWithSidecarProcessLock } from "../../src/main/services/sidecar-process-lock"

describe("sidecar process lock", () => {
  it("never runs two sidecar tasks simultaneously", async () => {
    let active = 0
    let maximumActive = 0
    const order: string[] = []
    const run = (name: string, delayMs: number) =>
      runWithSidecarProcessLock(async () => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        order.push(`start-${name}`)
        await new Promise((resolve) => setTimeout(resolve, delayMs))
        order.push(`end-${name}`)
        active -= 1
      })

    await Promise.all([run("a", 20), run("b", 1), run("c", 1)])

    expect(maximumActive).toBe(1)
    expect(order).toEqual(["start-a", "end-a", "start-b", "end-b", "start-c", "end-c"])
  })

  it("removes a cancelled task while it waits", async () => {
    let releaseFirst: (() => void) | undefined
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const first = runWithSidecarProcessLock(
      () => new Promise<void>((resolve) => {
        releaseFirst = resolve
        markStarted?.()
      })
    )
    await started
    const controller = new AbortController()
    const cancelled = runWithSidecarProcessLock(async () => undefined, controller.signal)
    controller.abort()
    releaseFirst?.()

    await expect(cancelled).rejects.toMatchObject({ code: "tts_job_cancelled" })
    await first
  })
})
