export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message)
  }
}

export function toIpcError(error: unknown): { code: string; message: string; details?: unknown } {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, details: error.details }
  }
  if (error instanceof Error) {
    return { code: "unknown_error", message: error.message }
  }
  return { code: "unknown_error", message: "Unknown error" }
}

