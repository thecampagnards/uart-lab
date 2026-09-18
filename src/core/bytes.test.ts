import { describe, expect, it } from 'vitest'
import {
  asciiToBytes,
  bytesToAscii,
  concat,
  fromHex,
  indexOfSeq,
  readU16le,
  readU32le,
  startsWith,
  toHex,
  u16le,
  u32le,
} from './bytes'

describe('hex helpers', () => {
  it('round-trips through hex', () => {
    const bytes = Uint8Array.from([0x00, 0x0f, 0xfd, 0xff])
    expect(toHex(bytes)).toBe('00 0f fd ff')
    expect(Array.from(fromHex('00 0f fd ff'))).toEqual([0x00, 0x0f, 0xfd, 0xff])
  })

  it('accepts separators the protocol doc uses', () => {
    expect(Array.from(fromHex('fdfcfbfa'))).toEqual([0xfd, 0xfc, 0xfb, 0xfa])
    expect(Array.from(fromHex('fd:fc,fb fa'))).toEqual([0xfd, 0xfc, 0xfb, 0xfa])
  })

  it('rejects malformed hex rather than guessing', () => {
    expect(() => fromHex('abc')).toThrow(/Odd-length/)
    expect(() => fromHex('zz')).toThrow(/Not a hex/)
  })
})

describe('little-endian encoding', () => {
  it('matches the protocol examples', () => {
    expect(u16le(0x0004)).toEqual([0x04, 0x00])
    expect(u32le(30)).toEqual([0x1e, 0x00, 0x00, 0x00])
    expect(u32le(60000)).toEqual([0x60, 0xea, 0x00, 0x00])
  })

  it('decodes back', () => {
    expect(readU16le(fromHex('0400'), 0)).toBe(4)
    expect(readU32le(fromHex('60ea0000'), 0)).toBe(60000)
  })

  it('keeps u32 unsigned at the top of the range', () => {
    expect(readU32le(fromHex('ffffffff'), 0)).toBe(0xffffffff)
  })

  it('throws instead of returning NaN past the end', () => {
    expect(() => readU16le(fromHex('04'), 0)).toThrow(RangeError)
    expect(() => readU32le(fromHex('040000'), 0)).toThrow(RangeError)
  })
})

describe('sequence helpers', () => {
  it('concatenates arrays and typed arrays', () => {
    expect(Array.from(concat([1, 2], Uint8Array.from([3]), []))).toEqual([1, 2, 3])
  })

  it('finds and matches sequences', () => {
    const haystack = fromHex('00 00 fd fc fb fa 11')
    expect(indexOfSeq(haystack, [0xfd, 0xfc, 0xfb, 0xfa])).toBe(2)
    expect(indexOfSeq(haystack, [0xfd, 0xfc, 0xfb, 0xfa], 3)).toBe(-1)
    expect(startsWith(haystack, [0x00, 0x00])).toBe(true)
    expect(startsWith(haystack, [0xfd], 2)).toBe(true)
  })

  it('round-trips ASCII', () => {
    expect(toHex(asciiToBytes('v1.6.1'))).toBe('76 31 2e 36 2e 31')
    expect(bytesToAscii(fromHex('76312e362e31'))).toBe('v1.6.1')
  })
})
