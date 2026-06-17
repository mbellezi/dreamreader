import { z } from "zod";
import {
  BookFileTypeSchema,
  IdSchema,
  IsoDateTimeStringSchema,
  JsonObjectSchema,
  LocaleSchema,
  NonEmptyStringSchema,
  SortDirectionSchema,
} from "./common";

export const BookAuthorSchema = z.object({
  name: NonEmptyStringSchema,
  sortName: z.string().trim().optional(),
});
export type BookAuthor = z.infer<typeof BookAuthorSchema>;

export const BookSchema = z.object({
  id: IdSchema,
  contentHash: NonEmptyStringSchema,
  fileType: BookFileTypeSchema,
  title: NonEmptyStringSchema,
  subtitle: z.string().trim().optional(),
  authors: z.array(BookAuthorSchema).default([]),
  language: LocaleSchema.optional(),
  publisher: z.string().trim().optional(),
  publishedAt: z.string().trim().optional(),
  description: z.string().trim().optional(),
  originalPath: z.string().trim().optional(),
  libraryPath: NonEmptyStringSchema,
  coverAssetId: IdSchema.optional(),
  manifest: JsonObjectSchema.default({}),
  addedAt: IsoDateTimeStringSchema,
  updatedAt: IsoDateTimeStringSchema,
  lastOpenedAt: IsoDateTimeStringSchema.optional(),
});
export type Book = z.infer<typeof BookSchema>;
export const LibraryBookSchema = BookSchema;
export type LibraryBook = Book;

export const BookImportCandidateSchema = z.object({
  path: NonEmptyStringSchema,
  fileType: BookFileTypeSchema.optional(),
});
export type BookImportCandidate = z.infer<typeof BookImportCandidateSchema>;

export const ImportFilesRequestSchema = z.object({
  files: z.array(BookImportCandidateSchema).default([]),
  filePaths: z.array(NonEmptyStringSchema).default([]),
});
export type ImportFilesRequest = z.infer<typeof ImportFilesRequestSchema>;
export const ImportBooksInputSchema = ImportFilesRequestSchema;
export type ImportBooksInput = ImportFilesRequest;

export const BookImporterIdSchema = z.enum(["readium-cli", "dreamreader-local"]);
export type BookImporterId = z.infer<typeof BookImporterIdSchema>;

export const ImportedBookSchema = BookSchema.extend({
  importSource: z
    .object({
      importer: BookImporterIdSchema,
    })
    .optional(),
});
export type ImportedBook = z.infer<typeof ImportedBookSchema>;

export const ImportFilesResultSchema = z.object({
  imported: z.array(ImportedBookSchema),
  skipped: z.array(
    z.object({
      path: NonEmptyStringSchema,
      reason: z.enum(["duplicate", "unsupported_type", "invalid_file", "failed"]),
      existingBookId: IdSchema.optional(),
    }),
  ),
});
export type ImportFilesResult = z.infer<typeof ImportFilesResultSchema>;

export const ListBooksRequestSchema = z
  .object({
    query: z.string().trim().optional(),
    fileTypes: z.array(BookFileTypeSchema).optional(),
    languages: z.array(LocaleSchema).optional(),
    sortBy: z
      .enum(["title", "author", "addedAt", "updatedAt", "lastOpenedAt"])
      .default("updatedAt"),
    sortDirection: SortDirectionSchema.default("desc"),
    limit: z.number().int().positive().max(500).default(100),
    offset: z.number().int().min(0).default(0),
  })
  .default({
    sortBy: "updatedAt",
    sortDirection: "desc",
    limit: 100,
    offset: 0,
  });
export type ListBooksRequest = z.infer<typeof ListBooksRequestSchema>;

export const ListBooksResultSchema = z.object({
  books: z.array(BookSchema),
  total: z.number().int().min(0),
});
export type ListBooksResult = z.infer<typeof ListBooksResultSchema>;

export const UpdateBookMetadataRequestSchema = z.object({
  bookId: IdSchema,
  title: NonEmptyStringSchema.optional(),
  subtitle: z.string().trim().nullable().optional(),
  authors: z.array(BookAuthorSchema).optional(),
  language: LocaleSchema.nullable().optional(),
  publisher: z.string().trim().nullable().optional(),
  publishedAt: z.string().trim().nullable().optional(),
  description: z.string().trim().nullable().optional(),
  coverAssetId: IdSchema.nullable().optional(),
});
export type UpdateBookMetadataRequest = z.infer<
  typeof UpdateBookMetadataRequestSchema
>;

export const DeleteBookRequestSchema = z.object({
  bookId: IdSchema,
});
export type DeleteBookRequest = z.infer<typeof DeleteBookRequestSchema>;

export const DeleteBookResultSchema = z.object({
  deleted: z.literal(true),
});
export type DeleteBookResult = z.infer<typeof DeleteBookResultSchema>;
