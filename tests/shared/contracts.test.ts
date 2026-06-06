import { describe, expect, it } from "vitest";
import {
  AnnotationSchema,
  AppSettingsSchema,
  ExportAnnotationsInputSchema,
  ImportBooksInputSchema,
  NarrationPlanSchema,
  SaveReadingPositionInputSchema,
} from "../../src/shared/contracts";
import {
  IpcChannelSchema,
  IpcContractSchemas,
  TtsAdapterManifestSchema,
  VoiceCloneInputSchema,
} from "../../src/shared/contracts/ipc";

const now = "2026-06-06T12:00:00.000Z";

describe("shared contracts", () => {
  it("validates the documented IPC channel list", () => {
    expect(IpcChannelSchema.options).toContain("library.importFiles");
    expect(IpcChannelSchema.options).toContain("settings.update");
    expect(Object.keys(IpcContractSchemas)).toEqual(IpcChannelSchema.options);
  });

  it("validates a canonical narration plan", () => {
    const result = NarrationPlanSchema.safeParse({
      schemaVersion: "narration-plan/v1",
      source: {
        bookId: "book-1",
        chapterHref: "chapter-1.xhtml",
        contentHash: "hash-1",
        language: "pt-BR",
      },
      normalization: {
        normalizerId: "pt-br-normalizer",
        version: "1.0.0",
        dictionaryVersion: "1.0.0",
      },
      prosody: {
        analyzerId: "neutral-prosody",
        version: "1.0.0",
      },
      segments: [
        {
          segmentId: "book-1:chapter-1:0",
          locator: {
            href: "chapter-1.xhtml",
            locations: { progression: 0 },
          },
          originalText: "Ola, mundo.",
          normalizedText: "Ola, mundo.",
          voiceRole: "narrator",
          prosody: {
            emotion: "neutral",
            intensity: 0.2,
            pace: "normal",
            pitch: "neutral",
            pauseBeforeMs: 0,
            pauseAfterMs: 350,
            instructionPtBr: "Tom calmo, narracao clara, sem exagero.",
          },
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects unsafe prosody ranges", () => {
    const result = NarrationPlanSchema.safeParse({
      schemaVersion: "narration-plan/v1",
      source: {
        bookId: "book-1",
        chapterHref: "chapter-1.xhtml",
        contentHash: "hash-1",
        language: "pt-BR",
      },
      normalization: {
        normalizerId: "pt-br-normalizer",
        version: "1.0.0",
        dictionaryVersion: "1.0.0",
      },
      prosody: {
        analyzerId: "llm-prosody-gguf",
        version: "1.0.0",
      },
      segments: [
        {
          segmentId: "segment-1",
          locator: { href: "chapter-1.xhtml" },
          originalText: "Gritou.",
          normalizedText: "Gritou.",
          prosody: {
            emotion: "angry",
            intensity: 2,
            pace: "fast",
            pitch: "high",
            pauseBeforeMs: 0,
            pauseAfterMs: 350,
            instructionPtBr: "Intenso.",
          },
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("requires consent for voice cloning", () => {
    expect(
      VoiceCloneInputSchema.safeParse({
        engineId: "qwen3-tts-mlx",
        name: "Minha voz",
        referenceAudioPath: "/local/reference.wav",
        language: "pt-BR",
        consentConfirmed: false,
        consentNote: "Uso local autorizado.",
      }).success,
    ).toBe(false);
  });

  it("exports stable input schema aliases", () => {
    expect(
      ImportBooksInputSchema.safeParse({
        files: [{ path: "/books/dom-casmurro.epub" }],
      }).success,
    ).toBe(true);

    expect(
      SaveReadingPositionInputSchema.safeParse({
        bookId: "book-1",
        locator: { href: "chapter-1.xhtml" },
        progression: 0.5,
      }).success,
    ).toBe(true);

    expect(ExportAnnotationsInputSchema.parse({}).format).toBe("markdown");
  });

  it("validates adapter capabilities", () => {
    expect(
      TtsAdapterManifestSchema.safeParse({
        adapterId: "qwen3-tts-mlx",
        displayName: "Qwen3-TTS MLX",
        runtime: "mlx",
        modelFormats: ["mlx"],
        languages: ["pt-BR", "pt", "en"],
        capabilities: {
          voiceClone: true,
          naturalLanguageInstruction: true,
          discreteEmotion: true,
          batch: true,
          streaming: true,
          segmentTimestamps: false,
        },
      }).success,
    ).toBe(true);
  });

  it("validates annotations and settings defaults", () => {
    expect(
      AnnotationSchema.safeParse({
        id: "annotation-1",
        bookId: "book-1",
        locator: { href: "chapter-1.xhtml" },
        quote: "Trecho marcado",
        createdAt: now,
        updatedAt: now,
      }).success,
    ).toBe(true);

    const settings = AppSettingsSchema.parse({
      schemaVersion: "settings/v1",
      ui: {},
      reader: {},
      library: {},
      audio: {},
      resources: {},
      privacy: {},
    });

    expect(settings.ui.locale).toBe("pt-BR");
    expect(settings.privacy.mode).toBe("offline_only");
  });
});
