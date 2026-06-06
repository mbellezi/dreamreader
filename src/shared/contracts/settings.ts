import { z } from "zod";
import { LocaleSchema, NonEmptyStringSchema } from "./common";
import { ReaderPreferencesSchema } from "./reader";

export const PrivacyModeSchema = z.enum(["offline_only", "local_first"]);
export type PrivacyMode = z.infer<typeof PrivacyModeSchema>;

export const ThermalPolicySchema = z.enum(["quiet", "balanced", "maximum"]);
export type ThermalPolicy = z.infer<typeof ThermalPolicySchema>;

const UiSettingsSchema = z.object({
  locale: LocaleSchema.default("pt-BR"),
  theme: z.enum(["system", "light", "dark"]).default("system"),
});

const LibrarySettingsSchema = z.object({
  defaultImportMode: z.enum(["copy_to_library", "reference_original"]).default(
    "copy_to_library",
  ),
  autoDetectLanguage: z.boolean().default(true),
});

const AudioSettingsSchema = z.object({
  defaultEngineId: NonEmptyStringSchema.optional(),
  defaultVoiceProfileId: NonEmptyStringSchema.optional(),
  expressiveNarrationEnabled: z.boolean().default(false),
  autoBuildM4b: z.boolean().default(false),
});

const ResourceSettingsSchema = z.object({
  thermalPolicy: ThermalPolicySchema.default("balanced"),
  exclusiveGpuJobs: z.boolean().default(true),
  memoryBudgetMb: z.number().int().positive().optional(),
});

const PrivacySettingsSchema = z.object({
  mode: PrivacyModeSchema.default("offline_only"),
  includeBooksInDiagnostics: z.boolean().default(false),
  includeAudioInDiagnostics: z.boolean().default(false),
  includeVoicesInDiagnostics: z.boolean().default(false),
});

export const SettingsSchema = z.object({
  schemaVersion: z.literal("settings/v1"),
  ui: UiSettingsSchema,
  reader: ReaderPreferencesSchema,
  library: LibrarySettingsSchema,
  audio: AudioSettingsSchema,
  resources: ResourceSettingsSchema,
  privacy: PrivacySettingsSchema,
});
export type Settings = z.infer<typeof SettingsSchema>;
export const AppSettingsSchema = SettingsSchema;
export type AppSettings = Settings;

export const UpdateSettingsRequestSchema = z.object({
  schemaVersion: z.literal("settings/v1").optional(),
  ui: UiSettingsSchema.partial().optional(),
  reader: ReaderPreferencesSchema.partial().optional(),
  library: LibrarySettingsSchema.partial().optional(),
  audio: AudioSettingsSchema.partial().optional(),
  resources: ResourceSettingsSchema.partial().optional(),
  privacy: PrivacySettingsSchema.partial().optional(),
});
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequestSchema>;
