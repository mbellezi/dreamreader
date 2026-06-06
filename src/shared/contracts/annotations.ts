import { z } from "zod";
import {
  IdSchema,
  IsoDateTimeStringSchema,
  NonEmptyStringSchema,
} from "./common";
import { ReaderLocatorSchema } from "./reader";

export const AnnotationColorSchema = z.enum([
  "yellow",
  "green",
  "blue",
  "pink",
  "purple",
  "none",
]);
export type AnnotationColor = z.infer<typeof AnnotationColorSchema>;

export const AnnotationSchema = z.object({
  id: IdSchema,
  bookId: IdSchema,
  locator: ReaderLocatorSchema,
  quote: NonEmptyStringSchema,
  color: AnnotationColorSchema.default("yellow"),
  note: z.string().trim().optional(),
  tags: z.array(NonEmptyStringSchema).default([]),
  createdAt: IsoDateTimeStringSchema,
  updatedAt: IsoDateTimeStringSchema,
  deletedAt: IsoDateTimeStringSchema.optional(),
});
export type Annotation = z.infer<typeof AnnotationSchema>;

export const BookmarkSchema = z.object({
  id: IdSchema,
  bookId: IdSchema,
  locator: ReaderLocatorSchema,
  label: z.string().trim().optional(),
  createdAt: IsoDateTimeStringSchema,
});
export type Bookmark = z.infer<typeof BookmarkSchema>;

export const CreateAnnotationRequestSchema = z.object({
  bookId: IdSchema,
  locator: ReaderLocatorSchema,
  quote: NonEmptyStringSchema,
  color: AnnotationColorSchema.default("yellow"),
  note: z.string().trim().optional(),
  tags: z.array(NonEmptyStringSchema).default([]),
});
export type CreateAnnotationRequest = z.infer<
  typeof CreateAnnotationRequestSchema
>;
export const CreateAnnotationInputSchema = CreateAnnotationRequestSchema;
export type CreateAnnotationInput = CreateAnnotationRequest;

export const UpdateAnnotationRequestSchema = z.object({
  id: IdSchema,
  color: AnnotationColorSchema.optional(),
  note: z.string().trim().nullable().optional(),
  tags: z.array(NonEmptyStringSchema).optional(),
});
export type UpdateAnnotationRequest = z.infer<
  typeof UpdateAnnotationRequestSchema
>;
export const UpdateAnnotationInputSchema = UpdateAnnotationRequestSchema;
export type UpdateAnnotationInput = UpdateAnnotationRequest;

export const ExportAnnotationsInputSchema = z.object({
  bookId: IdSchema.optional(),
  format: z.enum(["markdown", "json"]).default("markdown"),
  includeDeleted: z.boolean().default(false),
});
export type ExportAnnotationsInput = z.infer<
  typeof ExportAnnotationsInputSchema
>;

export const DeleteAnnotationRequestSchema = z.object({
  id: IdSchema,
});
export type DeleteAnnotationRequest = z.infer<
  typeof DeleteAnnotationRequestSchema
>;
