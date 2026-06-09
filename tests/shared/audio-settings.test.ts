import { describe, expect, it } from "vitest";
import { AppSettingsSchema } from "../../src/shared/contracts";

function parseAudio(audio: Record<string, unknown>) {
  return AppSettingsSchema.parse({
    schemaVersion: "settings/v1",
    ui: {},
    reader: {},
    library: {},
    audio,
    resources: {},
    privacy: {},
  }).audio;
}

describe("audio settings defaults", () => {
  it("applies generation defaults when audio is empty", () => {
    const audio = parseAudio({});
    expect(audio.defaultQuality).toBe("standard");
    expect(audio.expressiveNarrationEnabled).toBe(false);
  });

  it("round-trips a provided defaultQuality", () => {
    const audio = parseAudio({ defaultQuality: "high" });
    expect(audio.defaultQuality).toBe("high");
  });
});
