/**
 * Stateful LD2420 session on top of a {@link Transport}.
 *
 * The module has no request IDs and no way to correlate a reply with a request,
 * so commands are serialised through a one-slot queue: one command in flight,
 * matched to the next response frame carrying the same command byte.
 */
import { bytesToAscii, readU16le, readU32le, toHex } from '../../core/bytes'
import { Emitter, type Transport, type Unsubscribe } from '../../core/transport'
import {
  BAUD_RATES,
  Cmd,
  DEFAULT_BAUD_RATE,
  MAX_CMD_FRAME_LENGTH,
  OperatingMode,
  TOTAL_GATES,
  type OperatingModeValue,
} from './constants'
import {
  MAX_PARAM_READS_PER_FRAME,
  MAX_PARAM_WRITES_PER_FRAME,
  cmdCloseCommandMode,
  cmdGetBaudRate,
  cmdGetParameters,
  cmdGetSerial,
  cmdGetVersion,
  cmdOpenCommandMode,
  cmdReboot,
  cmdSetBaudRate,
  cmdSetMode,
  cmdSetParameters,
  configAddresses,
  Ld2420FrameReader,
  type CommandResponse,
  type ParamWrite,
} from './frames'
import {
  cloneConfig,
  configFromValues,
  diffConfig,
  factoryConfig,
  validateConfig,
  type Ld2420Config,
} from './config'

export interface Measurement {
  /** `performance.now()`-style timestamp, milliseconds since the session opened. */
  t: number
  presence: boolean
  distanceCm: number
  /** 16 raw gate energies in report mode; empty in simple mode. */
  energy: number[]
}

export interface DeviceIdentity {
  firmware?: string
  serial?: string
  baudRateIndex?: number
}

export interface TraceEntry {
  t: number
  direction: 'tx' | 'rx'
  /** Frame flavour, for filtering the trace. */
  kind: 'command' | 'response' | 'energy' | 'simple' | 'debug' | 'unknown'
  hex: string
  note?: string
}

export class CommandError extends Error {
  constructor(
    readonly command: number,
    readonly status: number,
  ) {
    super(
      `Command 0x${command.toString(16).padStart(2, '0')} rejected (status 0x${status.toString(16)})`,
    )
    this.name = 'CommandError'
  }
}

export class CommandTimeoutError extends Error {
  constructor(readonly command: number) {
    super(`No reply to command 0x${command.toString(16).padStart(2, '0')}`)
    this.name = 'CommandTimeoutError'
  }
}

interface PendingCommand {
  command: number
  resolve: (response: CommandResponse) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const COMMAND_TIMEOUT_MS = 1500
/** Report mode can be noisy; the tail of a config read is worth waiting for. */
const BULK_TIMEOUT_MS = 3000
const MAX_TRACE_ENTRIES = 500

export interface DriverOptions {
  commandTimeoutMs?: number
  /** Keeps memory flat on long sessions; the UI only charts a rolling window. */
  maxTraceEntries?: number
}

export class Ld2420Driver {
  private readonly reader = new Ld2420FrameReader()
  private readonly measurements = new Emitter<[Measurement]>()
  private readonly traces = new Emitter<[TraceEntry]>()
  private readonly errors = new Emitter<[Error]>()
  private readonly identityChanges = new Emitter<[DeviceIdentity]>()

  private unsubscribe: Unsubscribe[] = []
  private queue: Promise<unknown> = Promise.resolve()
  private pending: PendingCommand | null = null
  private startedAt = 0
  private commandTimeoutMs: number
  private maxTraceEntries: number

  private identity_: DeviceIdentity = {}
  private mode_: OperatingModeValue = OperatingMode.Simple
  private commandMode_ = false
  private trace_: TraceEntry[] = []
  /**
   * Simple mode sends `Range N` and `ON` as two separate lines, so the `ON` line
   * carries no distance. Without this the charted distance would alternate
   * between the real value and zero.
   */
  private lastSimpleDistanceCm = 0

  constructor(
    readonly transport: Transport,
    options: DriverOptions = {},
  ) {
    this.commandTimeoutMs = options.commandTimeoutMs ?? COMMAND_TIMEOUT_MS
    this.maxTraceEntries = options.maxTraceEntries ?? MAX_TRACE_ENTRIES
  }

  get identity(): DeviceIdentity {
    return this.identity_
  }

  get mode(): OperatingModeValue {
    return this.mode_
  }

  get inCommandMode(): boolean {
    return this.commandMode_
  }

  get trace(): readonly TraceEntry[] {
    return this.trace_
  }

  onMeasurement(listener: (m: Measurement) => void): Unsubscribe {
    return this.measurements.add(listener)
  }

  onTrace(listener: (entry: TraceEntry) => void): Unsubscribe {
    return this.traces.add(listener)
  }

  onError(listener: (error: Error) => void): Unsubscribe {
    return this.errors.add(listener)
  }

  onIdentity(listener: (identity: DeviceIdentity) => void): Unsubscribe {
    return this.identityChanges.add(listener)
  }

  /** Attach to the transport and start decoding. Does not open the port. */
  attach(): void {
    this.startedAt = now()
    this.unsubscribe.push(this.transport.onData((chunk) => this.ingest(chunk)))
    this.unsubscribe.push(
      this.transport.onClose((reason) => {
        this.failPending(reason ?? new Error('Connection closed.'))
        if (reason) this.errors.emit(reason)
      }),
    )
  }

  detach(): void {
    for (const off of this.unsubscribe) off()
    this.unsubscribe = []
    this.failPending(new Error('Session ended.'))
    this.reader.reset()
  }

  private ingest(chunk: Uint8Array): void {
    for (const frame of this.reader.push(chunk)) {
      switch (frame.kind) {
        case 'response': {
          this.pushTrace({
            direction: 'rx',
            kind: 'response',
            hex: toHex(frame.raw),
            note: `cmd 0x${frame.command.toString(16).padStart(2, '0')} ${frame.ok ? 'ACK' : 'NACK'}`,
          })
          this.settle(frame)
          break
        }
        case 'energy':
          this.pushTrace({ direction: 'rx', kind: 'energy', hex: toHex(frame.raw) })
          this.measurements.emit({
            t: now() - this.startedAt,
            presence: frame.presence,
            distanceCm: frame.distanceCm,
            energy: frame.energy,
          })
          break
        case 'simple': {
          this.pushTrace({
            direction: 'rx',
            kind: 'simple',
            hex: toHex(frame.raw),
            note: frame.text,
          })
          if (frame.distanceCm !== null) this.lastSimpleDistanceCm = frame.distanceCm
          else if (!frame.presence) this.lastSimpleDistanceCm = 0
          this.measurements.emit({
            t: now() - this.startedAt,
            presence: frame.presence,
            distanceCm: frame.presence ? this.lastSimpleDistanceCm : 0,
            energy: [],
          })
          break
        }
        case 'debug':
          this.pushTrace({ direction: 'rx', kind: 'debug', hex: toHex(frame.raw.slice(0, 24)) })
          break
      }
    }
  }

  /**
   * `set_baudrate` and `get_baudrate` answer with a bare ASCII line rather than a
   * frame, so they are matched by text instead of by command byte.
   */
  private settle(frame: CommandResponse): void {
    const pending = this.pending
    if (!pending) return
    if (pending.command !== frame.command) return
    clearTimeout(pending.timer)
    this.pending = null
    if (frame.ok) pending.resolve(frame)
    else pending.reject(new CommandError(frame.command, frame.status))
  }

  private failPending(error: Error): void {
    if (!this.pending) return
    clearTimeout(this.pending.timer)
    this.pending.reject(error)
    this.pending = null
  }

  private pushTrace(entry: Omit<TraceEntry, 't'>): void {
    const full: TraceEntry = { t: now() - this.startedAt, ...entry }
    this.trace_.push(full)
    if (this.trace_.length > this.maxTraceEntries) {
      this.trace_.splice(0, this.trace_.length - this.maxTraceEntries)
    }
    this.traces.emit(full)
  }

  clearTrace(): void {
    this.trace_ = []
  }

  // -------------------------------------------------------------------------
  // Command plumbing
  // -------------------------------------------------------------------------

  /** Serialises callers so two commands are never in flight at once. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async exchange(
    command: number,
    frame: Uint8Array,
    timeoutMs = this.commandTimeoutMs,
  ): Promise<CommandResponse> {
    if (frame.length > MAX_CMD_FRAME_LENGTH) {
      throw new RangeError(
        `Frame is ${frame.length} bytes, the maximum is ${MAX_CMD_FRAME_LENGTH}.`,
      )
    }
    this.pushTrace({
      direction: 'tx',
      kind: 'command',
      hex: toHex(frame),
      note: `cmd 0x${command.toString(16).padStart(2, '0')}`,
    })
    const response = new Promise<CommandResponse>((resolve, reject) => {
      this.pending = {
        command,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.pending = null
          reject(new CommandTimeoutError(command))
        }, timeoutMs),
      }
    })
    await this.transport.write(frame)
    return response
  }

  /** Send without waiting for a reply — for commands the module never answers. */
  private async send(command: number, frame: Uint8Array): Promise<void> {
    this.pushTrace({
      direction: 'tx',
      kind: 'command',
      hex: toHex(frame),
      note: `cmd 0x${command.toString(16).padStart(2, '0')} (no reply)`,
    })
    await this.transport.write(frame)
  }

  // -------------------------------------------------------------------------
  // High-level operations
  // -------------------------------------------------------------------------

  openCommandMode(): Promise<void> {
    return this.enqueue(async () => {
      await this.exchange(Cmd.OpenCommandMode, cmdOpenCommandMode())
      this.commandMode_ = true
    })
  }

  closeCommandMode(): Promise<void> {
    return this.enqueue(async () => {
      await this.exchange(Cmd.CloseCommandMode, cmdCloseCommandMode())
      this.commandMode_ = false
    })
  }

  /**
   * Runs `task` inside command mode, restoring the streaming mode afterwards
   * even if it throws — otherwise a failed read leaves the module mute.
   */
  private async inCommandModeDo<T>(task: () => Promise<T>): Promise<T> {
    await this.exchange(Cmd.OpenCommandMode, cmdOpenCommandMode())
    this.commandMode_ = true
    try {
      return await task()
    } finally {
      try {
        await this.exchange(Cmd.CloseCommandMode, cmdCloseCommandMode())
      } catch {
        /* best effort: the caller's error is the interesting one */
      }
      this.commandMode_ = false
    }
  }

  readIdentity(): Promise<DeviceIdentity> {
    return this.enqueue(() =>
      this.inCommandModeDo(async () => {
        const identity: DeviceIdentity = { ...this.identity_ }
        const version = await this.exchange(Cmd.GetVersion, cmdGetVersion())
        identity.firmware = readLengthPrefixedString(version)
        try {
          const serial = await this.exchange(Cmd.GetSerial, cmdGetSerial())
          identity.serial = readLengthPrefixedSerial(serial)
        } catch {
          // Not every firmware carries a serial; the version alone is enough.
        }
        this.identity_ = identity
        this.identityChanges.emit(identity)
        return identity
      }),
    )
  }

  /** Read every exposed ABD parameter, batched to fit the 64-byte frame limit. */
  readConfig(): Promise<Ld2420Config> {
    return this.enqueue(() =>
      this.inCommandModeDo(async () => {
        const addresses = configAddresses()
        const values = new Map<number, number>()
        for (let i = 0; i < addresses.length; i += MAX_PARAM_READS_PER_FRAME) {
          const batch = addresses.slice(i, i + MAX_PARAM_READS_PER_FRAME)
          const response = await this.exchange(
            Cmd.GetParameter,
            cmdGetParameters(batch),
            BULK_TIMEOUT_MS,
          )
          batch.forEach((address, index) => {
            const offset = index * 4
            if (offset + 4 <= response.data.length) {
              values.set(address, readU32le(response.data, offset))
            }
          })
        }
        return configFromValues(values)
      }),
    )
  }

  /** Write only what differs from `current`. Returns the number of writes sent. */
  writeConfig(current: Ld2420Config, next: Ld2420Config): Promise<number> {
    const problems = validateConfig(next)
    if (problems.length > 0) {
      return Promise.reject(new Error(problems.map((p) => p.message).join(' ')))
    }
    const writes = diffConfig(current, next)
    if (writes.length === 0) return Promise.resolve(0)
    return this.enqueue(() =>
      this.inCommandModeDo(async () => {
        for (let i = 0; i < writes.length; i += MAX_PARAM_WRITES_PER_FRAME) {
          const batch = writes.slice(i, i + MAX_PARAM_WRITES_PER_FRAME)
          await this.exchange(Cmd.SetParameter, cmdSetParameters(batch), BULK_TIMEOUT_MS)
        }
        return writes.length
      }),
    )
  }

  /** Restore the factory ABD parameters, whatever the module currently holds. */
  factoryReset(current: Ld2420Config): Promise<number> {
    return this.writeConfig(current, factoryConfig())
  }

  writeSingleParameter(write: ParamWrite): Promise<void> {
    return this.enqueue(() =>
      this.inCommandModeDo(async () => {
        await this.exchange(Cmd.SetParameter, cmdSetParameters([write]))
      }),
    )
  }

  setMode(mode: OperatingModeValue): Promise<void> {
    return this.enqueue(() =>
      this.inCommandModeDo(async () => {
        await this.exchange(Cmd.SetMode, cmdSetMode(mode))
        this.mode_ = mode
      }),
    )
  }

  /**
   * Reboot. The module answers nothing and comes back in simple mode, so the
   * driver's own mode state is reset to match.
   */
  reboot(): Promise<void> {
    return this.enqueue(async () => {
      await this.send(Cmd.Reboot, cmdReboot())
      this.commandMode_ = false
      this.mode_ = OperatingMode.Simple
      this.reader.reset()
    })
  }

  /**
   * Change the module's bit rate and follow it on our side.
   *
   * The reply is a plain ASCII line, not a frame, so this waits a fixed settle
   * time instead of matching a response. A reboot is required for the new rate
   * to take effect, and the port is reopened at the new rate afterwards.
   */
  async setBaudRate(index: number): Promise<number> {
    const rate = BAUD_RATES[index]
    if (rate === undefined) throw new Error(`Unknown baud rate index: ${index}`)
    await this.enqueue(async () => {
      await this.inCommandModeDo(async () => {
        await this.send(Cmd.SetBaudRate, cmdSetBaudRate(index))
        await delay(200)
      })
      await this.send(Cmd.Reboot, cmdReboot())
      this.commandMode_ = false
      this.mode_ = OperatingMode.Simple
    })
    await delay(400)
    this.reader.reset()
    await this.transport.reopen(rate)
    this.identity_ = { ...this.identity_, baudRateIndex: index }
    this.identityChanges.emit(this.identity_)
    return rate
  }

  /** Ask the module which rate it thinks it is using. Answer is an ASCII line. */
  queryBaudRate(): Promise<void> {
    return this.enqueue(() => this.send(Cmd.GetBaudRate, cmdGetBaudRate()))
  }
}

export const DEFAULT_BAUD = DEFAULT_BAUD_RATE
export const GATE_COUNT = TOTAL_GATES

function readLengthPrefixedString(response: CommandResponse): string {
  if (response.data.length < 2) return ''
  const length = readU16le(response.data, 0)
  return bytesToAscii(response.data.slice(2, 2 + length))
}

/** Serials are raw bytes; render printable ones as text and the rest as hex. */
function readLengthPrefixedSerial(response: CommandResponse): string {
  if (response.data.length < 2) return ''
  const length = readU16le(response.data, 0)
  const bytes = response.data.slice(2, 2 + length)
  const printable = bytes.every((b) => b >= 0x20 && b < 0x7f)
  return printable ? bytesToAscii(bytes) : toHex(bytes, '')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function cloneMeasurementConfig(config: Ld2420Config): Ld2420Config {
  return cloneConfig(config)
}
