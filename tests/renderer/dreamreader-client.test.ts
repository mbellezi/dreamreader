import { afterEach, describe, expect, it } from "vitest"
import { dreamreaderClient } from "../../src/renderer/lib/dreamreader"

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window")

afterEach(() => {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, "window", originalWindowDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, "window")
  }
})

describe("dreamreaderClient", () => {
  it("preserves segment prosody returned by the bridge", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        dreamreader: {
          tts: {
            listSegments: async () => [
              {
                id: "segment-1",
                jobId: "job-1",
                segmentIndex: 0,
                status: "completed",
                textPreview: "A pergunta apareceu em voz baixa.",
                audioAssetId: "asset-1",
                durationMs: 1200,
                prosody: {
                  emotion: "suspense",
                  intensity: 0.42,
                  pace: "slow",
                  pitch: "low",
                  pauseBeforeMs: 0,
                  pauseAfterMs: 620,
                  instructionPtBr: "Tom contido e suspenso."
                },
                prosodyMode: "expressive"
              }
            ]
          }
        }
      }
    })

    const segments = await dreamreaderClient.listTtsSegments("job-1")

    expect(segments).toEqual([
      {
        id: "segment-1",
        jobId: "job-1",
        segmentIndex: 0,
        status: "completed",
        textPreview: "A pergunta apareceu em voz baixa.",
        audioAssetId: "asset-1",
        durationMs: 1200,
        prosody: {
          emotion: "suspense",
          intensity: 0.42,
          pace: "slow",
          pitch: "low",
          pauseBeforeMs: 0,
          pauseAfterMs: 620,
          instructionPtBr: "Tom contido e suspenso."
        },
        prosodyMode: "expressive"
      }
    ])
  })
})
