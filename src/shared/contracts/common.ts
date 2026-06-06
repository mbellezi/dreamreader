import { z } from "zod";

export const NonEmptyStringSchema = z.string().trim().min(1);
export const IdSchema = NonEmptyStringSchema;
export const IsoDateTimeStringSchema = z.string().datetime({ offset: true });

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const JsonObjectSchema = z.record(z.string(), JsonValueSchema);
export type JsonObject = z.infer<typeof JsonObjectSchema>;

export const LocaleSchema = z
  .string()
  .regex(/^[a-z]{2,3}(?:-[A-Z0-9]{2,8})?$/);

export const BookFileTypeSchema = z.enum(["epub", "txt", "markdown", "html"]);
export type BookFileType = z.infer<typeof BookFileTypeSchema>;

export const RuntimeSchema = z.enum([
  "mlx",
  "metal",
  "mps",
  "pytorch",
  "cpu",
  "external",
]);
export type Runtime = z.infer<typeof RuntimeSchema>;

export const AcceleratorSchema = z.enum([
  "apple_metal",
  "apple_mps",
  "cpu",
  "none",
]);
export type Accelerator = z.infer<typeof AcceleratorSchema>;

export const ModelFormatSchema = z.enum([
  "mlx",
  "gguf",
  "safetensors",
  "checkpoint",
  "unknown",
]);
export type ModelFormat = z.infer<typeof ModelFormatSchema>;

export const JobStatusSchema = z.enum([
  "queued",
  "preparing",
  "analyzing",
  "synthesizing",
  "assembling",
  "updating_m4b",
  "building",
  "validating",
  "completed",
  "failed",
  "cancelled",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const ProgressSchema = z
  .number()
  .min(0)
  .max(1);

export const SortDirectionSchema = z.enum(["asc", "desc"]);
export type SortDirection = z.infer<typeof SortDirectionSchema>;

export const IpcErrorSchema = z.object({
  code: NonEmptyStringSchema,
  message: NonEmptyStringSchema,
  details: JsonValueSchema.optional(),
});
export type IpcError = z.infer<typeof IpcErrorSchema>;

export const IpcFailureSchema = z.object({
  ok: z.literal(false),
  error: IpcErrorSchema,
});
export type IpcFailure = z.infer<typeof IpcFailureSchema>;

export const createIpcSuccessSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    ok: z.literal(true),
    data: dataSchema,
  });

export const createIpcResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.discriminatedUnion("ok", [
    createIpcSuccessSchema(dataSchema),
    IpcFailureSchema,
  ]);

export type IpcSuccess<T> = {
  ok: true;
  data: T;
};

export type IpcResponse<T> = IpcSuccess<T> | IpcFailure;
