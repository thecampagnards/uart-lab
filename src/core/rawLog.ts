/**
 * The raw byte stream, unframed.
 *
 * Every other layer here decodes: it assumes a framing and throws away what
 * does not fit. When you do not know what is on the wire — a module this tool
 * has no driver for, a bridge at the wrong bit rate, a device that answers
 * nothing — that assumption is exactly what hides the answer. This keeps the
 * bytes as they arrived, in order, both directions.
 */

export type RawDirection = 'rx' | 'tx'

export interface RawChunk {
  /** Milliseconds since the session opened. */
  t: number
  direction: RawDirection
  bytes: Uint8Array
}

export type RawViewMode = 'text' | 'hex'

export interface RawLine {
  key: string
  t: number
  direction: RawDirection
  /** Byte offset of the line within its direction's stream. */
  offset: number
  text: string
}

/**
 * Fixed-capacity byte log. Bounded by total bytes rather than chunk count,
 * because a chunk is whatever the serial stack happened to hand over — one byte
 * or a thousand.
 */
export class RawSerialLog {
  private chunks_: RawChunk[] = []
  private bytes = 0
  private received = 0
  private sent = 0

  constructor(readonly maxBytes = 256 * 1024) {}

  push(direction: RawDirection, bytes: Uint8Array, t: number): void {
    if (bytes.length === 0) return
    this.chunks_.push({ t, direction, bytes })
    this.bytes += bytes.length
    if (direction === 'rx') this.received += bytes.length
    else this.sent += bytes.length

    // Drop whole chunks from the front; splitting one would misreport its time.
    while (this.bytes > this.maxBytes && this.chunks_.length > 1) {
      const dropped = this.chunks_.shift()
      this.bytes -= dropped?.bytes.length ?? 0
    }
  }

  get chunks(): readonly RawChunk[] {
    return this.chunks_
  }

  /**
   * The newest chunks totalling at most `maxBytes`.
   *
   * Rendering the whole log on every frame would mean formatting a quarter of a
   * megabyte to show the last screenful. Offsets in the rendered output are
   * relative to the start of this window, not to the session.
   */
  tail(maxBytes: number): RawChunk[] {
    const out: RawChunk[] = []
    let bytes = 0
    for (let i = this.chunks_.length - 1; i >= 0; i--) {
      const chunk = this.chunks_[i]!
      out.push(chunk)
      bytes += chunk.bytes.length
      if (bytes >= maxBytes) break
    }
    return out.reverse()
  }

  /** Bytes held right now, after any trimming. */
  get size(): number {
    return this.bytes
  }

  /** Bytes seen over the whole session, including those since dropped. */
  get totals(): { received: number; sent: number } {
    return { received: this.received, sent: this.sent }
  }

  clear(): void {
    this.chunks_ = []
    this.bytes = 0
    this.received = 0
    this.sent = 0
  }
}

const PRINTABLE = /[\x20-\x7e]/

/** One byte as a display character: printable as itself, anything else as a dot. */
function printable(byte: number): string {
  const char = String.fromCharCode(byte)
  return PRINTABLE.test(char) ? char : '.'
}

/**
 * Render the log for display.
 *
 * `text` splits the stream on newlines the way a terminal does, so an ASCII
 * device reads as the lines it sent rather than as arbitrary buffer boundaries.
 * `hex` is a classic dump with offsets and an ASCII gutter.
 */
export function renderRawLines(
  chunks: readonly RawChunk[],
  mode: RawViewMode,
  columns = 16,
): RawLine[] {
  return mode === 'hex' ? hexLines(chunks, columns) : textLines(chunks)
}

function textLines(chunks: readonly RawChunk[]): RawLine[] {
  const out: RawLine[] = []
  const offsets: Record<RawDirection, number> = { rx: 0, tx: 0 }
  // A line can span chunks, so the partial one is carried forward per direction.
  const pending: Record<RawDirection, { text: string; t: number; offset: number } | null> = {
    rx: null,
    tx: null,
  }

  const flush = (direction: RawDirection): void => {
    const held = pending[direction]
    if (!held) return
    out.push({
      key: `${direction}-${held.offset}`,
      t: held.t,
      direction,
      offset: held.offset,
      text: held.text,
    })
    pending[direction] = null
  }

  for (const chunk of chunks) {
    const { direction } = chunk
    for (const byte of chunk.bytes) {
      if (byte === 0x0a) {
        // Newline ends the line; a preceding CR is part of the terminator.
        pending[direction] ??= { text: '', t: chunk.t, offset: offsets[direction] }
        pending[direction].t = chunk.t
        pending[direction].text = pending[direction].text.replace(/\r$/, '')
        flush(direction)
        offsets[direction]++
        continue
      }
      pending[direction] ??= { text: '', t: chunk.t, offset: offsets[direction] }
      pending[direction].text += byte === 0x0d ? '\r' : printable(byte)
      pending[direction].t = chunk.t
      offsets[direction]++
    }
  }

  // Whatever has not been terminated yet is still worth showing.
  flush('rx')
  flush('tx')
  return out.map((line) => ({ ...line, text: line.text.replace(/\r/g, '') }))
}

function hexLines(chunks: readonly RawChunk[], columns: number): RawLine[] {
  const out: RawLine[] = []
  const offsets: Record<RawDirection, number> = { rx: 0, tx: 0 }
  const pending: Record<RawDirection, { bytes: number[]; t: number; offset: number } | null> = {
    rx: null,
    tx: null,
  }

  const flush = (direction: RawDirection): void => {
    const held = pending[direction]
    if (!held || held.bytes.length === 0) return
    const hex = held.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')
    const ascii = held.bytes.map(printable).join('')
    out.push({
      key: `${direction}-${held.offset}`,
      t: held.t,
      direction,
      offset: held.offset,
      text: `${held.offset.toString(16).padStart(6, '0')}  ${hex.padEnd(columns * 3 - 1, ' ')}  ${ascii}`,
    })
    pending[direction] = null
  }

  for (const chunk of chunks) {
    const { direction } = chunk
    for (const byte of chunk.bytes) {
      pending[direction] ??= { bytes: [], t: chunk.t, offset: offsets[direction] }
      pending[direction].bytes.push(byte)
      pending[direction].t = chunk.t
      offsets[direction]++
      if (pending[direction].bytes.length === columns) flush(direction)
    }
  }

  flush('rx')
  flush('tx')
  return out
}

/** Bytes per second over the last `windowMs`, for the throughput readout. */
export function throughput(chunks: readonly RawChunk[], windowMs = 2000): number {
  const latest = chunks.at(-1)?.t
  if (latest === undefined) return 0
  const cutoff = latest - windowMs
  let bytes = 0
  let earliest = latest
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i]!
    if (chunk.t < cutoff) break
    bytes += chunk.bytes.length
    earliest = chunk.t
  }
  const spanS = (latest - earliest) / 1000
  return spanS > 0 ? bytes / spanS : 0
}
