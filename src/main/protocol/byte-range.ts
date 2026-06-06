export type ByteRange = {
  end: number
  start: number
}

export function parseSingleByteRange(header: string | null, sizeBytes: number): ByteRange | undefined | "invalid" {
  if (!header) {
    return undefined
  }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    return "invalid"
  }
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (!match) {
    return "invalid"
  }

  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) {
    return "invalid"
  }
  if (sizeBytes === 0) {
    return "invalid"
  }

  if (!rawStart) {
    const suffixLength = Number(rawEnd)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return "invalid"
    }
    return {
      start: Math.max(0, sizeBytes - suffixLength),
      end: sizeBytes - 1
    }
  }

  const start = Number(rawStart)
  const requestedEnd = rawEnd ? Number(rawEnd) : sizeBytes - 1
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= sizeBytes
  ) {
    return "invalid"
  }

  return {
    start,
    end: Math.min(requestedEnd, sizeBytes - 1)
  }
}
