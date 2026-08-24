import { AppError } from "@main/lib/errors"

type Waiter = {
  reject: (error: Error) => void
  resolve: (release: () => void) => void
  signal?: AbortSignal
  onAbort?: () => void
}

let active = false
const waiters: Waiter[] = []

export async function runWithSidecarProcessLock<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const release = await acquireSidecarProcessLock(signal)
  try {
    return await task()
  } finally {
    release()
  }
}

function acquireSidecarProcessLock(signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) {
    return Promise.reject(cancelledError())
  }

  return new Promise((resolve, reject) => {
    const waiter: Waiter = { reject, resolve, signal }
    waiter.onAbort = () => {
      const index = waiters.indexOf(waiter)
      if (index >= 0) {
        waiters.splice(index, 1)
      }
      reject(cancelledError())
    }
    signal?.addEventListener("abort", waiter.onAbort, { once: true })

    if (!active) {
      active = true
      resolveWaiter(waiter)
      return
    }
    waiters.push(waiter)
  })
}

function releaseSidecarProcessLock(): void {
  while (waiters.length) {
    const next = waiters.shift()
    if (!next || next.signal?.aborted) {
      continue
    }
    resolveWaiter(next)
    return
  }
  active = false
}

function resolveWaiter(waiter: Waiter): void {
  if (waiter.onAbort) {
    waiter.signal?.removeEventListener("abort", waiter.onAbort)
  }
  let released = false
  waiter.resolve(() => {
    if (released) {
      return
    }
    released = true
    releaseSidecarProcessLock()
  })
}

function cancelledError(): AppError {
  return new AppError("tts_job_cancelled", "TTS job was cancelled while waiting for the sidecar")
}
