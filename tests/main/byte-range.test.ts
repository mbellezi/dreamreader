import { describe, expect, it } from "vitest"
import { parseSingleByteRange } from "../../src/main/protocol/byte-range"

describe("parseSingleByteRange", () => {
  it("accepts open ended and bounded byte ranges", () => {
    expect(parseSingleByteRange("bytes=0-", 1000)).toEqual({ start: 0, end: 999 })
    expect(parseSingleByteRange("bytes=120-240", 1000)).toEqual({ start: 120, end: 240 })
    expect(parseSingleByteRange("bytes=900-2000", 1000)).toEqual({ start: 900, end: 999 })
  })

  it("accepts suffix byte ranges", () => {
    expect(parseSingleByteRange("bytes=-250", 1000)).toEqual({ start: 750, end: 999 })
    expect(parseSingleByteRange("bytes=-2000", 1000)).toEqual({ start: 0, end: 999 })
  })

  it("rejects unsupported or unsatisfiable ranges", () => {
    expect(parseSingleByteRange("items=0-10", 1000)).toBe("invalid")
    expect(parseSingleByteRange("bytes=10-5", 1000)).toBe("invalid")
    expect(parseSingleByteRange("bytes=1000-", 1000)).toBe("invalid")
    expect(parseSingleByteRange("bytes=0-1,2-3", 1000)).toBe("invalid")
    expect(parseSingleByteRange("bytes=0-", 0)).toBe("invalid")
  })
})
