/**
 * An in-browser LD2420 stand-in.
 *
 * It speaks the same wire protocol as the real module, so the demo on GitHub
 * Pages is usable without hardware and the driver can be exercised end to end in
 * tests. It is deliberately a *protocol* simulation: the radar physics underneath
 * is a plausible-looking model, not a validated one.
 */
import { asciiToBytes, concat, readU16le, readU32le, u16le, u32le } from '../../core/bytes'
import { Emitter, type Transport, type TransportInfo, type Unsubscribe } from '../../core/transport'
import {
  ACK,
  BAUD_RATES,
  CMD_FOOTER,
  CMD_HEADER,
  Cmd,
  ENERGY_FOOTER,
  ENERGY_HEADER,
  FrameType,
  GATE_SIZE_M,
  NACK,
  OperatingMode,
  Param,
  TOTAL_GATES,
  moveThresholdAddr,
  stillThresholdAddr,
  type OperatingModeValue,
} from './constants'
import { factoryConfig } from './config'

export interface SimulatorOptions {
  firmware?: string
  serial?: string
  /** Drive the report stream from a real timer. Off in tests. */
  autoRun?: boolean
  /** Interval between report/simple frames, in ms. */
  reportIntervalMs?: number
}

const REPORT_INTERVAL_MS = 100

export class Ld2420Simulator implements Transport {
  readonly kind = 'simulated' as const
  readonly info: TransportInfo = { label: 'Simulated LD2420 (no hardware required)' }

  private readonly data = new Emitter<[Uint8Array]>()
  private readonly closed = new Emitter<[Error | undefined]>()
  private readonly params = new Map<number, number>()
  private readonly firmware: string
  private readonly serial: string
  private readonly reportIntervalMs: number
  private readonly autoRun: boolean

  private open_ = false
  private baud = 115200
  private baudIndex = 5
  private commandMode = false
  private mode: OperatingModeValue = OperatingMode.Simple
  private timer: ReturnType<typeof setInterval> | null = null

  // Scene state: a target walking back and forth in front of the sensor.
  private elapsedMs = 0
  private lastDetectionMs = -Infinity
  private targetPresent = true

  constructor(options: SimulatorOptions = {}) {
    this.firmware = options.firmware ?? 'v1.6.1'
    this.serial = options.serial ?? '0102030405060708'
    this.autoRun = options.autoRun ?? true
    this.reportIntervalMs = options.reportIntervalMs ?? REPORT_INTERVAL_MS
    this.loadFactoryDefaults()
  }

  private loadFactoryDefaults(): void {
    const config = factoryConfig()
    this.params.set(Param.MinGate, config.minGate)
    this.params.set(Param.MaxGate, config.maxGate)
    this.params.set(Param.MinGateAlt, 1)
    this.params.set(Param.MaxGateAlt, 10)
    this.params.set(Param.Timeout, config.timeoutS)
    for (let g = 0; g < TOTAL_GATES; g++) {
      this.params.set(moveThresholdAddr(g), config.moveThresholds[g]!)
      this.params.set(stillThresholdAddr(g), config.stillThresholds[g]!)
    }
  }

  get isOpen(): boolean {
    return this.open_
  }

  get baudRate(): number {
    return this.baud
  }

  open(baudRate: number): Promise<void> {
    this.baud = baudRate
    this.open_ = true
    if (this.autoRun && !this.timer) {
      this.timer = setInterval(() => this.tick(this.reportIntervalMs), this.reportIntervalMs)
    }
    return Promise.resolve()
  }

  async reopen(baudRate: number): Promise<void> {
    await this.close()
    await this.open(baudRate)
  }

  close(): Promise<void> {
    if (!this.open_) return Promise.resolve()
    this.open_ = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.closed.emit(undefined)
    return Promise.resolve()
  }

  write(bytes: Uint8Array): Promise<void> {
    if (!this.open_) return Promise.reject(new Error('Port is closed: cannot write.'))
    this.consumeRequests(bytes)
    return Promise.resolve()
  }

  onData(listener: (chunk: Uint8Array) => void): Unsubscribe {
    return this.data.add(listener)
  }

  onClose(listener: (reason?: Error) => void): Unsubscribe {
    return this.closed.add(listener)
  }

  // -------------------------------------------------------------------------
  // Request handling
  // -------------------------------------------------------------------------

  private pendingIn: Uint8Array = new Uint8Array(0)

  private consumeRequests(chunk: Uint8Array): void {
    this.pendingIn = concat(this.pendingIn, chunk)
    for (;;) {
      const buf = this.pendingIn
      if (buf.length < 10) return
      let start = -1
      for (let i = 0; i + 4 <= buf.length; i++) {
        if (
          buf[i] === CMD_HEADER[0] &&
          buf[i + 1] === CMD_HEADER[1] &&
          buf[i + 2] === CMD_HEADER[2] &&
          buf[i + 3] === CMD_HEADER[3]
        ) {
          start = i
          break
        }
      }
      if (start < 0) {
        this.pendingIn = new Uint8Array(0)
        return
      }
      if (start > 0) {
        this.pendingIn = buf.slice(start)
        continue
      }
      if (buf.length < 6) return
      const total = readU16le(buf, 4) + 10
      if (buf.length < total) return
      const frame = buf.slice(0, total)
      this.pendingIn = buf.slice(total)
      if (frame[7] === FrameType.Request) this.handleRequest(frame[6]!, frame.slice(8, total - 4))
    }
  }

  private handleRequest(cmd: number, payload: Uint8Array): void {
    switch (cmd) {
      case Cmd.OpenCommandMode:
        this.commandMode = true
        // Protocol version 2, 32-byte receive buffer.
        this.respond(cmd, ACK, concat(u16le(2), u16le(32)))
        return
      case Cmd.CloseCommandMode:
        this.commandMode = false
        this.respond(cmd, ACK)
        return
      case Cmd.GetVersion: {
        const text = asciiToBytes(this.firmware)
        this.respond(cmd, ACK, concat(u16le(text.length), text))
        return
      }
      case Cmd.GetSerial: {
        const text = asciiToBytes(this.serial)
        this.respond(cmd, ACK, concat(u16le(text.length), text))
        return
      }
      case Cmd.GetFirmwareId:
        this.respond(cmd, ACK, asciiToBytes('04PA'))
        return
      case Cmd.GetActiveFirmware:
        this.respond(cmd, ACK, u32le(0x02))
        return
      case Cmd.GetParameter: {
        if (!this.commandMode) return this.respond(cmd, NACK)
        const out: number[] = []
        for (let i = 0; i + 2 <= payload.length; i += 2) {
          out.push(...u32le(this.params.get(readU16le(payload, i)) ?? 0))
        }
        this.respond(cmd, ACK, Uint8Array.from(out))
        return
      }
      case Cmd.SetParameter: {
        if (!this.commandMode) return this.respond(cmd, NACK)
        for (let i = 0; i + 6 <= payload.length; i += 6) {
          this.params.set(readU16le(payload, i), readU32le(payload, i + 2))
        }
        this.respond(cmd, ACK)
        return
      }
      case Cmd.SetMode: {
        if (!this.commandMode) return this.respond(cmd, NACK)
        const mode = readU32le(payload, 2) as OperatingModeValue
        this.mode = mode
        this.respond(cmd, ACK)
        return
      }
      case Cmd.GetBaudRate:
        this.emit(asciiToBytes(`baudrate:${this.baudIndex}\r\n`))
        return
      case Cmd.SetBaudRate: {
        const index = readU16le(payload, 0)
        if (BAUD_RATES[index] === undefined) {
          this.emit(asciiToBytes('Setting Failed!\r\n'))
          return
        }
        this.baudIndex = index
        this.emit(asciiToBytes('Setting Success!\r\n'))
        return
      }
      case Cmd.Reboot:
        // The real module restarts silently and comes back in simple mode.
        this.commandMode = false
        this.mode = OperatingMode.Simple
        this.elapsedMs = 0
        return
      default:
        this.respond(cmd, NACK)
        return
    }
  }

  private respond(cmd: number, status: number, data: Uint8Array | readonly number[] = []): void {
    const body = concat([cmd, FrameType.Response], u16le(status), data)
    this.emit(concat(CMD_HEADER, u16le(body.length), body, CMD_FOOTER))
  }

  private emit(bytes: Uint8Array): void {
    if (this.open_) this.data.emit(bytes)
  }

  // -------------------------------------------------------------------------
  // Scene
  // -------------------------------------------------------------------------

  /** Advance the simulated device by `dtMs` and emit whatever it would send. */
  tick(dtMs: number): void {
    if (!this.open_) return
    this.elapsedMs += dtMs
    if (this.commandMode) return // command mode stops the data stream

    const scene = this.scene()
    if (this.mode === OperatingMode.Report) {
      this.emit(encodeEnergyFrame(scene.presence, scene.distanceCm, scene.energy))
    } else if (this.mode === OperatingMode.Simple) {
      this.emit(asciiToBytes(scene.presence ? `Range ${scene.distanceCm}\r\nON\r\n` : 'OFF\r\n'))
    }
  }

  /** Current simulated radar picture. Exposed so tests can assert on it. */
  scene(): { presence: boolean; distanceCm: number; energy: number[] } {
    const t = this.elapsedMs / 1000

    // The target paces between 0.6 m and 5.2 m, and steps out of the room for
    // 8 s out of every 60 so the absence path gets exercised too.
    const cycle = t % 60
    this.targetPresent = cycle < 52
    const distanceM = 0.6 + 2.3 * (1 - Math.cos((t * Math.PI) / 9))
    const targetGate = distanceM / GATE_SIZE_M

    const energy: number[] = []
    for (let g = 0; g < TOTAL_GATES; g++) {
      // Near-field clutter: strong at gate 0, falling off fast.
      const clutter = 400 + 55000 * Math.exp(-g)
      const breathing = 1 + 0.06 * Math.sin(t * 1.9 + g)
      let value = clutter * breathing
      if (this.targetPresent) {
        const spread = 0.85
        value += 9000 * Math.exp(-((g - targetGate) ** 2) / (2 * spread * spread))
      }
      value += (pseudoNoise(g, Math.floor(this.elapsedMs / 50)) - 0.5) * 120
      energy.push(Math.max(0, Math.min(65535, Math.round(value))))
    }

    const minGate = this.params.get(Param.MinGate) ?? 0
    const maxGate = this.params.get(Param.MaxGate) ?? TOTAL_GATES - 1
    let detected = false
    for (let g = minGate; g <= Math.min(maxGate, TOTAL_GATES - 1); g++) {
      const move = this.params.get(moveThresholdAddr(g)) ?? 65535
      const still = this.params.get(stillThresholdAddr(g)) ?? 65535
      if (energy[g]! > move || energy[g]! > still) {
        detected = true
        break
      }
    }
    if (detected) this.lastDetectionMs = this.elapsedMs
    const timeoutMs = (this.params.get(Param.Timeout) ?? 0) * 1000
    const presence = detected || this.elapsedMs - this.lastDetectionMs <= timeoutMs

    return {
      presence,
      distanceCm: presence ? Math.round(distanceM * 100) : 0,
      energy,
    }
  }
}

export function encodeEnergyFrame(
  presence: boolean,
  distanceCm: number,
  energy: readonly number[],
): Uint8Array {
  const body = concat([presence ? 1 : 0], u16le(distanceCm), ...energy.map((e) => u16le(e)))
  return concat(ENERGY_HEADER, u16le(body.length), body, ENERGY_FOOTER)
}

/** Deterministic value in [0,1) — reproducible runs beat Math.random here. */
function pseudoNoise(a: number, b: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return x - Math.floor(x)
}
