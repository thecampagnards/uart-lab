/** Web Serial transport. Chrome/Edge/Opera on desktop only. */
import {
  Emitter,
  describeUsbDevice,
  isWebSerialSupported,
  type Transport,
  type TransportInfo,
  type Unsubscribe,
} from './transport'

export class WebSerialUnavailableError extends Error {
  constructor() {
    super(
      'The Web Serial API is not available. Use Chrome, Edge or Opera on desktop, ' +
        'over HTTPS or http://localhost.',
    )
    this.name = 'WebSerialUnavailableError'
  }
}

export class WebSerialTransport implements Transport {
  readonly kind = 'webserial' as const

  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private readLoop: Promise<void> | null = null
  private closing = false
  private open_ = false
  private baud = 115200

  private readonly data = new Emitter<[Uint8Array]>()
  private readonly closed = new Emitter<[Error | undefined]>()

  private constructor(private readonly port: SerialPort) {}

  /** Prompts the user to pick a port. Must be called from a user gesture. */
  static async request(filters: SerialPortFilter[] = []): Promise<WebSerialTransport> {
    if (!isWebSerialSupported()) throw new WebSerialUnavailableError()
    const port = await navigator.serial.requestPort(filters.length > 0 ? { filters } : {})
    return new WebSerialTransport(port)
  }

  /** Ports the user has already granted access to, usable without a prompt. */
  static async listGranted(): Promise<WebSerialTransport[]> {
    if (!isWebSerialSupported()) return []
    const ports = await navigator.serial.getPorts()
    return ports.map((port) => new WebSerialTransport(port))
  }

  get info(): TransportInfo {
    const usb = this.port.getInfo()
    const info: TransportInfo = { label: describeUsbDevice(usb.usbVendorId, usb.usbProductId) }
    if (usb.usbVendorId !== undefined) info.usbVendorId = usb.usbVendorId
    if (usb.usbProductId !== undefined) info.usbProductId = usb.usbProductId
    return info
  }

  get isOpen(): boolean {
    return this.open_
  }

  get baudRate(): number {
    return this.baud
  }

  async open(baudRate: number): Promise<void> {
    if (this.open_) return
    this.closing = false
    await this.port.open({
      baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none',
      // Report mode pushes ~45 bytes every ~50 ms; a roomy buffer keeps the
      // read loop from being the bottleneck at 460800 baud.
      bufferSize: 8192,
    })
    this.baud = baudRate
    this.open_ = true
    this.writer = this.port.writable?.getWriter() ?? null
    this.readLoop = this.pump()
  }

  async reopen(baudRate: number): Promise<void> {
    await this.close()
    await this.open(baudRate)
  }

  private async pump(): Promise<void> {
    const readable = this.port.readable
    if (!readable) return
    this.reader = readable.getReader()
    try {
      for (;;) {
        const { value, done } = await this.reader.read()
        if (done) break
        if (value && value.length > 0) this.data.emit(value)
      }
      this.closed.emit(undefined)
    } catch (error) {
      if (!this.closing) {
        this.open_ = false
        this.closed.emit(error instanceof Error ? error : new Error(String(error)))
      }
    } finally {
      try {
        this.reader?.releaseLock()
      } catch {
        /* already released */
      }
      this.reader = null
    }
  }

  async close(): Promise<void> {
    if (!this.open_) return
    this.closing = true
    this.open_ = false
    try {
      await this.reader?.cancel()
    } catch {
      /* the stream may already be errored */
    }
    await this.readLoop?.catch(() => undefined)
    this.readLoop = null
    try {
      this.writer?.releaseLock()
    } catch {
      /* already released */
    }
    this.writer = null
    try {
      await this.port.close()
    } catch {
      /* the device may have been unplugged */
    }
    this.closed.emit(undefined)
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.writer) throw new Error('Port is closed: cannot write.')
    await this.writer.write(bytes)
  }

  onData(listener: (chunk: Uint8Array) => void): Unsubscribe {
    return this.data.add(listener)
  }

  onClose(listener: (reason?: Error) => void): Unsubscribe {
    return this.closed.add(listener)
  }
}
