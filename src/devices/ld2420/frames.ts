/**
 * Pure encode/decode for the LD2420 wire protocol.
 *
 * Nothing here touches a serial port or any browser API, so the whole protocol
 * layer is unit-testable and reusable outside the app.
 */
import {
  bytesToAscii,
  concat,
  indexOfSeq,
  readU16le,
  startsWith,
  u16le,
  u32le,
} from '../../core/bytes'
import {
  ACK,
  CMD_FOOTER,
  CMD_HEADER,
  Cmd,
  DEBUG_FOOTER,
  DEBUG_HEADER,
  ENERGY_FOOTER,
  ENERGY_HEADER,
  FrameType,
  MAX_CMD_FRAME_LENGTH,
  MAX_FIRMWARE_FRAME_LENGTH,
  TOTAL_GATES,
  moveThresholdAddr,
  stillThresholdAddr,
  type OperatingModeValue,
} from './constants'
import { firmwareChecksum } from '../../core/firmware'

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/**
 * Wrap a command and its payload in a command frame.
 *
 * `length` counts the command byte, the type byte and the payload — i.e. every
 * byte between the length field and the footer.
 */
export function encodeCommand(
  cmd: number,
  payload: Uint8Array | readonly number[] = [],
  /**
   * The 64-byte ceiling applies to ordinary commands. Firmware block frames are
   * 148 bytes, so they raise it explicitly rather than the limit being dropped
   * for everything.
   */
  maxLength: number = MAX_CMD_FRAME_LENGTH,
): Uint8Array {
  const body = concat([cmd, FrameType.Request], payload)
  const frame = concat(CMD_HEADER, u16le(body.length), body, CMD_FOOTER)
  if (frame.length > maxLength) {
    throw new RangeError(
      `Command frame is ${frame.length} bytes, the device accepts at most ${maxLength}`,
    )
  }
  return frame
}

/** `open_command_mode` (0xFF). `clientId` is echoed back by some firmwares. */
export const cmdOpenCommandMode = (clientId = 1): Uint8Array =>
  encodeCommand(Cmd.OpenCommandMode, u16le(clientId))

export const cmdCloseCommandMode = (): Uint8Array => encodeCommand(Cmd.CloseCommandMode)

export const cmdGetVersion = (): Uint8Array => encodeCommand(Cmd.GetVersion)

export const cmdGetSerial = (): Uint8Array => encodeCommand(Cmd.GetSerial)

export const cmdGetFirmwareId = (): Uint8Array => encodeCommand(Cmd.GetFirmwareId)

export const cmdReboot = (): Uint8Array => encodeCommand(Cmd.Reboot)

export const cmdGetBaudRate = (): Uint8Array => encodeCommand(Cmd.GetBaudRate)

/** `set_baudrate` (0x26); `index` is a {@link BAUD_RATES} key, not a bit rate. */
export const cmdSetBaudRate = (index: number): Uint8Array =>
  encodeCommand(Cmd.SetBaudRate, u16le(index))

/** `set_mode` (0x12): two reserved bytes then the mode as u32. */
export const cmdSetMode = (mode: OperatingModeValue): Uint8Array =>
  encodeCommand(Cmd.SetMode, concat(u16le(0), u32le(mode)))

/**
 * `get_parameter` (0x08). Each address is a u16; each answer is a u32, in the
 * same order. Batched so a full config read is a handful of round trips.
 */
export function cmdGetParameters(addresses: readonly number[]): Uint8Array {
  if (addresses.length === 0) throw new Error('cmdGetParameters needs at least one address')
  return encodeCommand(Cmd.GetParameter, concat(...addresses.map((a) => u16le(a))))
}

/** `set_parameter` (0x07): a flat run of (address u16, value u32) pairs. */
export function cmdSetParameters(writes: readonly ParamWrite[]): Uint8Array {
  if (writes.length === 0) throw new Error('cmdSetParameters needs at least one write')
  return encodeCommand(
    Cmd.SetParameter,
    concat(...writes.map((w) => concat(u16le(w.address), u32le(w.value)))),
  )
}

export interface ParamWrite {
  address: number
  value: number
}

// --- Firmware upgrade -------------------------------------------------------

export const cmdGetActiveFirmware = (): Uint8Array => encodeCommand(Cmd.GetActiveFirmware)

export const cmdGetUpgradePartition = (): Uint8Array => encodeCommand(Cmd.GetUpgradePartition)

/**
 * `set_upgrade_mode` (0x74). The module stops answering almost everything after
 * this and, per the protocol document, has no known way back except completing
 * a transfer.
 */
export const cmdSetUpgradeMode = (): Uint8Array => encodeCommand(Cmd.SetUpgradeMode)

/** `init_firmware_upgrade` (0x72): partition, total length and whole-image checksum. */
export const cmdInitFirmwareUpgrade = (
  partition: number,
  imageLength: number,
  checksum: number,
): Uint8Array =>
  encodeCommand(
    Cmd.InitFirmwareUpgrade,
    concat(u32le(partition), u32le(imageLength), u32le(checksum)),
  )

/** `send_firmware_block` (0x73): sequence number, block checksum, then the data. */
export function cmdSendFirmwareBlock(counter: number, block: Uint8Array): Uint8Array {
  return encodeCommand(
    Cmd.SendFirmwareBlock,
    concat(u32le(counter), u32le(firmwareChecksum(block)), block),
    MAX_FIRMWARE_FRAME_LENGTH,
  )
}

/**
 * How many addresses fit in one 0x08 / 0x07 exchange, given the 64-byte frame
 * ceiling. For reads the *response* is the binding side (4 bytes per value on
 * top of a 14-byte envelope); for writes it is the request (6 bytes per pair on
 * top of a 12-byte envelope).
 */
export const MAX_PARAM_READS_PER_FRAME = Math.floor((MAX_CMD_FRAME_LENGTH - 14) / 4) // 12
export const MAX_PARAM_WRITES_PER_FRAME = Math.floor((MAX_CMD_FRAME_LENGTH - 12) / 6) // 8

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

export interface CommandResponse {
  kind: 'response'
  command: number
  /** 0x0000 = ACK, anything else = NACK/error word. */
  status: number
  ok: boolean
  /** Payload after the status word, footer excluded. */
  data: Uint8Array
  raw: Uint8Array
}

export interface EnergyReport {
  kind: 'energy'
  presence: boolean
  /** Reported target distance, in centimetres. */
  distanceCm: number
  /** Raw per-gate energy, 16 values, gate 0 nearest. */
  energy: number[]
  raw: Uint8Array
}

export interface SimpleReport {
  kind: 'simple'
  presence: boolean
  /** Distance in centimetres, or null when the line carried only ON/OFF. */
  distanceCm: number | null
  text: string
  raw: Uint8Array
}

/** A recognised but undecoded debug-mode frame. */
export interface DebugReport {
  kind: 'debug'
  raw: Uint8Array
}

export type Decoded = CommandResponse | EnergyReport | SimpleReport | DebugReport

export function decodeCommandResponse(frame: Uint8Array): CommandResponse | null {
  if (frame.length < 12) return null
  if (!startsWith(frame, CMD_HEADER)) return null
  const length = readU16le(frame, 4)
  if (frame.length !== length + 10) return null
  if (!startsWith(frame, CMD_FOOTER, frame.length - 4)) return null
  const command = frame[6]!
  if (frame[7] !== FrameType.Response) return null
  const status = readU16le(frame, 8)
  return {
    kind: 'response',
    command,
    status,
    ok: status === ACK,
    data: frame.slice(10, frame.length - 4),
    raw: frame,
  }
}

/**
 * Report-mode frame: header, u16 length, presence byte, u16 distance,
 * 16 × u16 gate energy, footer — 45 bytes in total.
 */
export const ENERGY_FRAME_LENGTH = 4 + 2 + 1 + 2 + TOTAL_GATES * 2 + 4

export function decodeEnergyReport(frame: Uint8Array): EnergyReport | null {
  if (frame.length < ENERGY_FRAME_LENGTH) return null
  if (!startsWith(frame, ENERGY_HEADER)) return null
  if (!startsWith(frame, ENERGY_FOOTER, frame.length - 4)) return null
  const energy: number[] = []
  for (let i = 0; i < TOTAL_GATES; i++) energy.push(readU16le(frame, 9 + i * 2))
  return {
    kind: 'energy',
    presence: frame[6] !== 0,
    distanceCm: readU16le(frame, 7),
    energy,
    raw: frame,
  }
}

/**
 * Simple-mode line, e.g. `Range 220\r\n`, `ON\r\n`, `OFF\r\n`. Firmwares
 * interleave `Range N` and `ON` on the same line, so both are scanned for.
 */
export function decodeSimpleLine(line: Uint8Array): SimpleReport | null {
  const text = bytesToAscii(line).replace(/[\r\n]+$/, '')
  if (text.length === 0) return null
  const hasOff = /OFF/.test(text)
  const hasOn = /(^|[^F])ON/.test(text)
  const range = /Range\s+(\d+)/.exec(text)
  if (!hasOff && !hasOn && !range) return null
  return {
    kind: 'simple',
    presence: hasOff ? false : hasOn || range !== null,
    distanceCm: range ? Number.parseInt(range[1]!, 10) : null,
    text,
    raw: line,
  }
}

// ---------------------------------------------------------------------------
// Stream framing
// ---------------------------------------------------------------------------

/**
 * Splits the incoming byte stream into frames.
 *
 * The device multiplexes four unrelated framings on one wire — length-delimited
 * command replies, footer-delimited energy and debug frames, and CRLF-delimited
 * ASCII — and switches between them without warning while a mode change is in
 * flight. So rather than trusting the mode we believe the device is in, the
 * parser searches for whichever delimiter appears first and drops the bytes
 * before it. That makes resynchronisation after a partial frame automatic.
 */
export class Ld2420FrameReader {
  private buffer: Uint8Array = new Uint8Array(0)

  /** Bytes dropped because they belonged to no recognisable frame. */
  public droppedBytes = 0

  /** Hard cap so a device stuck mid-frame cannot grow the buffer without bound. */
  private static readonly MAX_BUFFER = 4096

  push(chunk: Uint8Array): Decoded[] {
    this.buffer = concat(this.buffer, chunk)
    const out: Decoded[] = []
    for (;;) {
      const frame = this.next()
      if (!frame) break
      out.push(frame)
    }
    if (this.buffer.length > Ld2420FrameReader.MAX_BUFFER) {
      const excess = this.buffer.length - Ld2420FrameReader.MAX_BUFFER
      this.droppedBytes += excess
      this.buffer = this.buffer.slice(excess)
    }
    return out
  }

  reset(): void {
    this.buffer = new Uint8Array(0)
  }

  get pending(): number {
    return this.buffer.length
  }

  private next(): Decoded | null {
    const buf = this.buffer
    if (buf.length === 0) return null

    // Find the earliest start-of-frame marker of any flavour.
    const cmdAt = indexOfSeq(buf, CMD_HEADER)
    const energyAt = indexOfSeq(buf, ENERGY_HEADER)
    const debugAt = indexOfSeq(buf, DEBUG_HEADER)
    const crlfAt = indexOfSeq(buf, [0x0d, 0x0a])

    const binaryStart = Math.min(
      ...[cmdAt, energyAt, debugAt].filter((i) => i >= 0).concat(Number.POSITIVE_INFINITY),
    )

    // An ASCII line that completes before any binary header does is a simple-mode line.
    if (crlfAt >= 0 && crlfAt < binaryStart) {
      const line = buf.slice(0, crlfAt + 2)
      this.buffer = buf.slice(crlfAt + 2)
      const decoded = decodeSimpleLine(line)
      if (decoded) return decoded
      this.droppedBytes += line.length
      return this.next()
    }

    if (!Number.isFinite(binaryStart)) return null

    if (binaryStart > 0) {
      // Junk (or an unterminated ASCII line) ahead of the frame.
      this.droppedBytes += binaryStart
      this.buffer = buf.slice(binaryStart)
      return this.next()
    }

    if (cmdAt === 0) return this.takeCommandFrame()
    if (energyAt === 0) return this.takeEnergyFrame()
    return this.takeDebugFrame()
  }

  private takeCommandFrame(): Decoded | null {
    const buf = this.buffer
    if (buf.length < 6) return null
    const length = readU16le(buf, 4)
    const total = length + 10
    if (total > Ld2420FrameReader.MAX_BUFFER) {
      // Bogus length: this header was a coincidence inside another payload.
      this.droppedBytes += 4
      this.buffer = buf.slice(4)
      return this.next()
    }
    if (buf.length < total) return null
    const frame = buf.slice(0, total)
    this.buffer = buf.slice(total)
    const decoded = decodeCommandResponse(frame)
    if (decoded) return decoded
    this.droppedBytes += frame.length
    return this.next()
  }

  /**
   * Energy frames are a fixed 45 bytes, so the length is used first and the
   * footer only as a check. Falling back to a footer search would risk matching
   * an `F8 F7 F6 F5` sequence that happened to occur inside the gate energies.
   */
  private takeEnergyFrame(): Decoded | null {
    const buf = this.buffer
    if (buf.length < ENERGY_FRAME_LENGTH) return null
    const frame = buf.slice(0, ENERGY_FRAME_LENGTH)
    const decoded = decodeEnergyReport(frame)
    if (decoded) {
      this.buffer = buf.slice(ENERGY_FRAME_LENGTH)
      return decoded
    }
    // The header was a coincidence inside some other payload; step past it.
    this.droppedBytes += 4
    this.buffer = buf.slice(4)
    return this.next()
  }

  /**
   * Debug frames end with the same four bytes a command frame starts with, so the
   * footer is consumed as a terminator only when it is not the start of the next
   * command reply — which it always is in practice. Searching from offset 4 keeps
   * the header itself out of the match.
   */
  private takeDebugFrame(): Decoded | null {
    const buf = this.buffer
    const end = indexOfSeq(buf, DEBUG_FOOTER, 4)
    if (end < 0) return null
    const frame = buf.slice(0, end + DEBUG_FOOTER.length)
    this.buffer = buf.slice(end + DEBUG_FOOTER.length)
    return { kind: 'debug', raw: frame }
  }
}

// ---------------------------------------------------------------------------
// Threshold scaling
// ---------------------------------------------------------------------------

/**
 * The vendor tool shows thresholds in dB, the wire carries them linear.
 * `dB = 10 · log10(linear)`.
 */
export function linearToDb(linear: number): number {
  if (linear <= 0) return 0
  return 10 * Math.log10(linear)
}

export function dbToLinear(db: number): number {
  return Math.round(10 ** (db / 10))
}

/** Addresses a full configuration read needs, in a stable order. */
export function configAddresses(): number[] {
  const addresses = [0x0000, 0x0001, 0x0004]
  for (let g = 0; g < TOTAL_GATES; g++) addresses.push(moveThresholdAddr(g))
  for (let g = 0; g < TOTAL_GATES; g++) addresses.push(stillThresholdAddr(g))
  return addresses
}
