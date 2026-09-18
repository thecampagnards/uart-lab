/** Small endian-aware helpers shared by every device driver. */

export function toHex(bytes: Uint8Array | number[], separator = ' '): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(separator)
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/[\s:,]/g, '')
  if (clean.length % 2 !== 0) throw new Error(`Odd-length hex string: "${hex}"`)
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error(`Not a hex string: "${hex}"`)
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function u16le(value: number): [number, number] {
  return [value & 0xff, (value >>> 8) & 0xff]
}

export function u32le(value: number): [number, number, number, number] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]
}

export function readU16le(bytes: Uint8Array, offset: number): number {
  const lo = bytes[offset]
  const hi = bytes[offset + 1]
  if (lo === undefined || hi === undefined) throw new RangeError(`u16 read past end at ${offset}`)
  return lo | (hi << 8)
}

export function readU32le(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) throw new RangeError(`u32 read past end at ${offset}`)
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  )
}

export function concat(...chunks: (Uint8Array | readonly number[])[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk instanceof Uint8Array ? chunk : Uint8Array.from(chunk), at)
    at += chunk.length
  }
  return out
}

export function startsWith(haystack: Uint8Array, needle: readonly number[], at = 0): boolean {
  if (at + needle.length > haystack.length) return false
  for (let i = 0; i < needle.length; i++) if (haystack[at + i] !== needle[i]) return false
  return true
}

/** Index of `needle` in `haystack` at or after `from`, or -1. */
export function indexOfSeq(haystack: Uint8Array, needle: readonly number[], from = 0): number {
  const last = haystack.length - needle.length
  for (let i = Math.max(0, from); i <= last; i++) if (startsWith(haystack, needle, i)) return i
  return -1
}

export function asciiToBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff
  return out
}

export function bytesToAscii(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += String.fromCharCode(b)
  return out
}
