import { describe, expect, it } from 'vitest'
import { asciiToBytes, fromHex } from './bytes'
import { RawSerialLog, renderRawLines, throughput, type RawChunk } from './rawLog'

const rx = (text: string, t = 0): RawChunk => ({ t, direction: 'rx', bytes: asciiToBytes(text) })
const rxBytes = (hex: string, t = 0): RawChunk => ({ t, direction: 'rx', bytes: fromHex(hex) })

describe('RawSerialLog', () => {
  it('keeps chunks in order with their direction and time', () => {
    const log = new RawSerialLog()
    log.push('rx', asciiToBytes('OFF'), 10)
    log.push('tx', fromHex('fdfc'), 20)
    expect(log.chunks.map((c) => c.direction)).toEqual(['rx', 'tx'])
    expect(log.chunks[1]!.t).toBe(20)
    expect(log.totals).toEqual({ received: 3, sent: 2 })
  })

  it('ignores an empty write rather than logging a blank line', () => {
    const log = new RawSerialLog()
    log.push('rx', new Uint8Array(0), 0)
    expect(log.chunks).toHaveLength(0)
  })

  it('trims by total bytes, not by chunk count', () => {
    const log = new RawSerialLog(100)
    for (let i = 0; i < 50; i++) log.push('rx', new Uint8Array(10), i)
    expect(log.size).toBeLessThanOrEqual(100)
    // Totals still count everything that ever arrived.
    expect(log.totals.received).toBe(500)
  })

  it('keeps the newest chunk even when it alone exceeds the budget', () => {
    const log = new RawSerialLog(10)
    log.push('rx', new Uint8Array(4), 0)
    log.push('rx', new Uint8Array(400), 1)
    expect(log.chunks).toHaveLength(1)
    expect(log.chunks[0]!.bytes.length).toBe(400)
  })

  it('clears', () => {
    const log = new RawSerialLog()
    log.push('rx', asciiToBytes('x'), 0)
    log.clear()
    expect(log.chunks).toHaveLength(0)
    expect(log.totals.received).toBe(0)
  })
})

describe('renderRawLines, text mode', () => {
  it('splits on newlines the way a terminal does', () => {
    const lines = renderRawLines([rx('OFF\r\nRange 220\r\n')], 'text')
    expect(lines.map((l) => l.text)).toEqual(['OFF', 'Range 220'])
  })

  it('joins a line split across two chunks', () => {
    // Serial delivers whatever the buffer held, not whole lines.
    const lines = renderRawLines([rx('Ran', 1), rx('ge 220\r\n', 2)], 'text')
    expect(lines.map((l) => l.text)).toEqual(['Range 220'])
    // The line is timed by when it completed, not when it started.
    expect(lines[0]!.t).toBe(2)
  })

  it('shows an unterminated tail rather than hiding it', () => {
    const lines = renderRawLines([rx('OFF\r\npartial')], 'text')
    expect(lines.map((l) => l.text)).toEqual(['OFF', 'partial'])
  })

  it('replaces control and high bytes with dots so the layout survives', () => {
    const lines = renderRawLines([rxBytes('41 00 1b ff 42 0a')], 'text')
    expect(lines[0]!.text).toBe('A...B')
  })

  it('keeps the two directions on separate lines', () => {
    const lines = renderRawLines(
      [
        { t: 1, direction: 'tx', bytes: asciiToBytes('ping\n') },
        { t: 2, direction: 'rx', bytes: asciiToBytes('pong\n') },
      ],
      'text',
    )
    expect(lines.map((l) => [l.direction, l.text])).toEqual([
      ['tx', 'ping'],
      ['rx', 'pong'],
    ])
  })

  it('returns nothing for an empty log', () => {
    expect(renderRawLines([], 'text')).toEqual([])
  })
})

describe('renderRawLines, hex mode', () => {
  it('dumps 16 bytes per line with an offset and an ASCII gutter', () => {
    const lines = renderRawLines([rx('ABCDEFGHIJKLMNOPQR')], 'hex')
    expect(lines).toHaveLength(2)
    expect(lines[0]!.text).toMatch(/^000000 {2}41 42 43/)
    expect(lines[0]!.text).toMatch(/ABCDEFGHIJKLMNOP$/)
    expect(lines[1]!.text).toMatch(/^000010 {2}51 52/)
    expect(lines[1]!.text).toMatch(/QR$/)
  })

  it('carries a partial line across chunks and keeps the offset running', () => {
    const lines = renderRawLines([rx('AB', 1), rx('CD', 2)], 'hex')
    expect(lines).toHaveLength(1)
    expect(lines[0]!.text).toMatch(/41 42 43 44/)
    expect(lines[0]!.offset).toBe(0)
  })

  it('counts the offsets of each direction separately', () => {
    const lines = renderRawLines(
      [
        { t: 1, direction: 'rx', bytes: fromHex('01020304') },
        { t: 2, direction: 'tx', bytes: fromHex('0506') },
      ],
      'hex',
    )
    expect(lines.map((l) => [l.direction, l.offset])).toEqual([
      ['rx', 0],
      ['tx', 0],
    ])
  })

  it('pads short lines so the ASCII gutter stays in one column', () => {
    const lines = renderRawLines([rx('AB')], 'hex')
    const [full] = renderRawLines([rx('ABCDEFGHIJKLMNOP')], 'hex')
    expect(lines[0]!.text.indexOf('AB', 8)).toBe(full!.text.indexOf('ABCDEFGHIJKLMNOP', 8))
  })
})

describe('throughput', () => {
  it('measures bytes per second over the recent window', () => {
    const chunks: RawChunk[] = Array.from({ length: 11 }, (_, i) => ({
      t: i * 100,
      direction: 'rx' as const,
      bytes: new Uint8Array(10),
    }))
    // 11 chunks of 10 bytes spanning 1 s.
    expect(throughput(chunks)).toBeCloseTo(110, 0)
  })

  it('is zero with nothing, or with a single instant', () => {
    expect(throughput([])).toBe(0)
    expect(throughput([rx('x', 5)])).toBe(0)
  })
})
