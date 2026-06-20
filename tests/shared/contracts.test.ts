import { describe, expect, it } from "vitest";
import {
  AnnotationSchema,
  AppSettingsSchema,
  ExportAnnotationsInputSchema,
  ExportAnnotationsResultSchema,
  ImportBooksInputSchema,
  NarrationPlanSchema,
  SaveReadingPositionInputSchema,
} from "../../src/shared/contracts";
import {
  IpcChannelSchema,
  IpcContractSchemas,
  TtsAdapterManifestSchema,
  VoiceCloneInputSchema,
  VoiceDesignPromptInputSchema,
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

  it("validates voice design prompt creation input", () => {
    expect(
      VoiceDesignPromptInputSchema.safeParse({
        engineId: "qwen3-tts-17b-mlx",
        name: "Narrador quente",
        prompt: "A warm Brazilian Portuguese audiobook narrator with stable speaker identity.",
        sampleText: "Na manhã clara, Lívia leu uma frase curta para testar a nova voz.",
        language: "pt-BR",
      }).success,
    ).toBe(true);

    expect(
      VoiceDesignPromptInputSchema.safeParse({
        engineId: "qwen3-tts-17b-mlx",
        name: "Narrador quente",
        prompt: "",
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

    expect(IpcContractSchemas["library.deleteBook"].request.parse({ bookId: "book-1" })).toEqual({
      bookId: "book-1",
    });
    expect(IpcContractSchemas["audiobook.deleteExport"].request.parse({ bookId: "book-1" })).toEqual({
      bookId: "book-1",
    });
    expect(ExportAnnotationsInputSchema.parse({}).format).toBe("markdown");
    expect(ExportAnnotationsResultSchema.parse({ exported: true, filePath: "/tmp/notas.md" }).exported).toBe(true);
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

  it("allows model local install to be requested through the native picker", () => {
    expect(
      IpcContractSchemas["models.installFromPath"].request.parse({}),
    ).toEqual({});

    expect(
      IpcContractSchemas["models.installFromPath"].request.parse({
        path: "/models/Qwen3-TTS-12Hz-0.6B-Base",
      }),
    ).toEqual({
      path: "/models/Qwen3-TTS-12Hz-0.6B-Base",
    });
  });

  it("validates model management IPC requests", () => {
    expect(IpcContractSchemas["models.installRecommended"].request.parse({ modelId: "model_qwen3_tts_06b_base_mlx" })).toEqual({
      modelId: "model_qwen3_tts_06b_base_mlx",
      backend: "auto",
    });
    expect(
      IpcContractSchemas["models.installRecommended"].request.parse({
        modelId: "model_f5_tts_ptbr_pytorch",
        backend: "cuda",
      }),
    ).toEqual({
      modelId: "model_f5_tts_ptbr_pytorch",
      backend: "cuda",
    });
    expect(IpcContractSchemas["models.delete"].request.parse({ modelId: "model_f5_tts_ptbr_pytorch" })).toEqual({
      modelId: "model_f5_tts_ptbr_pytorch",
      deleteFiles: true,
    });
    expect(IpcContractSchemas["sidecars.install"].request.parse({ sidecarId: "runtime_qwen3_tts_mlx_sidecar" })).toEqual({
      sidecarId: "runtime_qwen3_tts_mlx_sidecar",
      backend: "auto",
    });
    expect(IpcContractSchemas["models.updateHuggingFaceToken"].request.parse({ token: "hf_example" })).toEqual({
      token: "hf_example",
    });
  });

  it("validates TTS model settings and seed on enqueue", () => {
    const parsed = IpcContractSchemas["tts.enqueueChapter"].request.parse({
      bookId: "book-1",
      chapterHref: "chapter-1.xhtml",
      engineId: "qwen3-tts-17b-mlx",
      generationLanguage: "Portuguese",
      modelSettings: {
        temperature: 0.9,
        topK: 50,
        topP: 1,
      },
      seed: 1234,
      seedFixed: true,
    });

    expect(parsed.modelSettings.temperature).toBe(0.9);
    expect(parsed.seed).toBe(1234);
    expect(parsed.seedFixed).toBe(true);

    expect(
      IpcContractSchemas["tts.enqueueChapter"].request.safeParse({
        bookId: "book-1",
        chapterHref: "chapter-1.xhtml",
        modelSettings: { temperature: -1 },
      }).success,
    ).toBe(false);
  });

  it("validates annotations and settings defaults", () => {
    expect(
      IpcContractSchemas["annotations.list"].request.safeParse({
        bookId: "book-1",
      }).success,
    ).toBe(true);

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
    expect(settings.audio.modelSettingsByEngineId).toEqual({});
    expect(settings.audio.seedFixed).toBe(false);
    expect(settings.privacy.mode).toBe("offline_only");
  });
});
