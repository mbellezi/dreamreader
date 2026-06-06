import { z } from "zod";
import {
  IdSchema,
  IsoDateTimeStringSchema,
  JsonObjectSchema,
  NonEmptyStringSchema,
} from "./common";

export const ReaderLocatorSchema = z
  .object({
    href: NonEmptyStringSchema.optional(),
    type: z.string().trim().optional(),
    title: z.string().trim().optional(),
    locations: JsonObjectSchema.optional(),
    text: JsonObjectSchema.optional(),
  })
  .passthrough();
export type ReaderLocator = z.infer<typeof ReaderLocatorSchema>;

export const ReadingPositionSchema = z.object({
  id: IdSchema,
  bookId: IdSchema,
  locator: ReaderLocatorSchema,
  chapterHref: NonEmptyStringSchema.optional(),
  progression: z.number().min(0).max(1).optional(),
  audioPositionMs: z.number().int().min(0).optional(),
  updatedAt: IsoDateTimeStringSchema,
});
export type ReadingPosition = z.infer<typeof ReadingPositionSchema>;

export const ReaderThemeSchema = z.enum([
  "light",
  "dark",
  "sepia",
  "high_contrast",
]);
export type ReaderTheme = z.infer<typeof ReaderThemeSchema>;

export const ReaderPreferencesSchema = z.object({
  theme: ReaderThemeSchema.default("light"),
  fontFamily: z.string().trim().default("georgia"),
  fontSizePx: z.number().int().min(12).max(40).default(18),
  lineHeight: z.number().min(1).max(2.5).default(1.5),
  paragraphSpacing: z.number().min(0.5).max(2.5).default(1),
  columnWidthPx: z.number().int().min(360).max(1200).default(720),
  columnCount: z.number().int().min(1).max(2).default(1),
  marginsPx: z.number().int().min(0).max(96).default(24),
  readingFlow: z.enum(["continuous", "paginated"]).default("continuous"),
  textAlign: z.enum(["start", "justify"]).default("justify"),
  hyphenation: z.boolean().default(true),
});
export type ReaderPreferences = z.infer<typeof ReaderPreferencesSchema>;

export const TableOfContentsItemSchema: z.ZodType<{
  title: string;
  href: string;
  children?: Array<z.infer<typeof TableOfContentsItemSchema>>;
}> = z.lazy(() =>
  z.object({
    title: NonEmptyStringSchema,
    href: NonEmptyStringSchema,
    children: z.array(TableOfContentsItemSchema).optional(),
  }),
);
export type TableOfContentsItem = z.infer<typeof TableOfContentsItemSchema>;
export const ReaderChapterSchema = TableOfContentsItemSchema;
export type ReaderChapter = TableOfContentsItem;

export const ReaderManifestSchema = z.object({
  tableOfContents: z.array(ReaderChapterSchema).default([]),
  metadata: JsonObjectSchema.default({}),
  resources: z.array(JsonObjectSchema).default([]),
  raw: JsonObjectSchema.default({}),
});
export type ReaderManifest = z.infer<typeof ReaderManifestSchema>;

export const OpenBookRequestSchema = z.object({
  bookId: IdSchema,
});
export type OpenBookRequest = z.infer<typeof OpenBookRequestSchema>;

export const OpenBookResultSchema = z.object({
  bookId: IdSchema,
  position: ReadingPositionSchema.optional(),
  tableOfContents: z.array(ReaderChapterSchema).default([]),
  manifest: ReaderManifestSchema.default({
    tableOfContents: [],
    metadata: {},
    resources: [],
    raw: {},
  }),
  book: JsonObjectSchema.optional(),
  annotations: z.array(JsonObjectSchema).default([]),
  bookmarks: z.array(JsonObjectSchema).default([]),
});
export type OpenBookResult = z.infer<typeof OpenBookResultSchema>;
export const ReaderOpenResultSchema = OpenBookResultSchema;
export type ReaderOpenResult = OpenBookResult;

export const GetResourceRequestSchema = z.object({
  bookId: IdSchema,
  href: NonEmptyStringSchema,
});
export type GetResourceRequest = z.infer<typeof GetResourceRequestSchema>;

export const BookResourceSchema = z.object({
  bookId: IdSchema,
  href: NonEmptyStringSchema,
  mimeType: NonEmptyStringSchema,
  content: z.string(),
  encoding: z.enum(["utf8", "base64"]).default("utf8"),
});
export type BookResource = z.infer<typeof BookResourceSchema>;

export const SaveLocatorRequestSchema = z.object({
  bookId: IdSchema,
  locator: ReaderLocatorSchema,
  chapterHref: NonEmptyStringSchema.optional(),
  progression: z.number().min(0).max(1).optional(),
  audioPositionMs: z.number().int().min(0).optional(),
});
export type SaveLocatorRequest = z.infer<typeof SaveLocatorRequestSchema>;
export const SaveReadingPositionInputSchema = SaveLocatorRequestSchema;
export type SaveReadingPositionInput = SaveLocatorRequest;
