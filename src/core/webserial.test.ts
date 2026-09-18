/**
 * @vitest-environment jsdom
 *
 * `WebSerialTransport` wraps streams that only exist in a browser, so it is
 * exercised here against a fake `navigator.serial`. The paths that matter are
 * the ones that are awkward to reach with real hardware: a port that errors
 * mid-read, an unplug, and closing while a read is pending.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { describeUsbDevice, isWebSerialSupported } from './transport'
import { WebSerialTransport, WebSerialUnavailableError } from './webserial'

class FakePort {
  opened: SerialOptions | null = null
  closeCalls = 0
  written: Uint8Array[] = []

  private controller!: ReadableStreamDefaultController<Uint8Array>
  readable: ReadableStream<Uint8Array> | null = null
  writable: WritableStream<Uint8Array> | null = null

  constructor(
    private readonly info: SerialPortInfo = { usbVendorId: 0x0403, usbProductId: 0x6001 },
  ) {}

  getInfo(): SerialPortInfo {
    return this.info
  }

  open(options: SerialOptions): Promise<void> {
    this.opened = options
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller
      },
    })
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.written.push(chunk)
      },
    })
    return Promise.resolve()
  }

  close(): Promise<void> {
    this.closeCalls++
    this.readable = null
    this.writable = null
    return Promise.resolve()
  }

  /** Push bytes as if the device had sent them. */
  emit(bytes: number[]): void {
    this.controller.enqueue(Uint8Array.from(bytes))
  }

  /** Simulate the device being unplugged mid-read. */
  fail(message: string): void {
    this.controller.error(new Error(message))
  }
}

function install(port: FakePort, granted: FakePort[] = []): void {
  Object.defineProperty(navigator, 'serial', {
    configurable: true,
    value: {
      requestPort: vi.fn(() => Promise.resolve(port as unknown as SerialPort)),
      getPorts: vi.fn(() => Promise.resolve(granted as unknown as SerialPort[])),
    },
  })
}

function uninstall(): void {
  Reflect.deleteProperty(navigator, 'serial')
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('Web Serial support detection', () => {
  afterEach(uninstall)

  it('reports absence rather than throwing', () => {
    expect(isWebSerialSupported()).toBe(false)
  })

  it('refuses to request a port when the API is missing', async () => {
    await expect(WebSerialTransport.request()).rejects.toBeInstanceOf(WebSerialUnavailableError)
  })

  it('returns no granted ports when the API is missing', async () => {
    expect(await WebSerialTransport.listGranted()).toEqual([])
  })
})

describe('describeUsbDevice', () => {
  it('names a known bridge', () => {
    expect(describeUsbDevice(0x0403, 0x6001)).toBe('FTDI FT232R (0403:6001)')
    expect(describeUsbDevice(0x1a86, 0x7523)).toBe('QinHeng (CH34x) CH340 (1a86:7523)')
  })

  it('degrades to the vendor, then to raw ids, then to a generic label', () => {
    expect(describeUsbDevice(0x0403, 0x9999)).toBe('FTDI (0403:9999)')
    expect(describeUsbDevice(0xdead, 0xbeef)).toBe('USB dead:beef')
    expect(describeUsbDevice(undefined, undefined)).toBe('Serial port')
  })
})

describe('WebSerialTransport', () => {
  let port: FakePort

  beforeEach(() => {
    port = new FakePort()
    install(port)
  })
  afterEach(uninstall)

  it('opens 8N1 with no flow control', async () => {
    const transport = await WebSerialTransport.request()
    await transport.open(115200)
    expect(port.opened).toMatchObject({
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none',
    })
    expect(transport.isOpen).toBe(true)
    expect(transport.baudRate).toBe(115200)
    expect(transport.info.label).toBe('FTDI FT232R (0403:6001)')
    await transport.close()
  })

  it('delivers incoming chunks to listeners', async () => {
    const transport = await WebSerialTransport.request()
    const chunks: Uint8Array[] = []
    transport.onData((chunk) => chunks.push(chunk))
    await transport.open(115200)

    port.emit([0x4f, 0x46, 0x46])
    port.emit([0x0d, 0x0a])
    await flush()

    expect(chunks.map((c) => Array.from(c))).toEqual([
      [0x4f, 0x46, 0x46],
      [0x0d, 0x0a],
    ])
    await transport.close()
  })

  it('writes through to the port', async () => {
    const transport = await WebSerialTransport.request()
    await transport.open(115200)
    await transport.write(Uint8Array.from([0xfd, 0xfc]))
    await flush()
    expect(port.written.map((c) => Array.from(c))).toEqual([[0xfd, 0xfc]])
    await transport.close()
  })

  it('refuses to write once closed', async () => {
    const transport = await WebSerialTransport.request()
    await transport.open(115200)
    await transport.close()
    await expect(transport.write(Uint8Array.from([0x00]))).rejects.toThrow(/closed/i)
  })

  it('reports an unplug as a close with a reason', async () => {
    const transport = await WebSerialTransport.request()
    const reasons: (Error | undefined)[] = []
    transport.onClose((reason) => reasons.push(reason))
    await transport.open(115200)

    port.fail('The device has been lost.')
    await flush()

    expect(transport.isOpen).toBe(false)
    expect(reasons[0]).toBeInstanceOf(Error)
    expect(reasons[0]?.message).toMatch(/lost/)
  })

  it('closes cleanly while a read is pending, with no error reason', async () => {
    const transport = await WebSerialTransport.request()
    const reasons: (Error | undefined)[] = []
    transport.onClose((reason) => reasons.push(reason))
    await transport.open(115200)

    await transport.close()

    expect(transport.isOpen).toBe(false)
    expect(port.closeCalls).toBe(1)
    expect(reasons.every((reason) => reason === undefined)).toBe(true)
  })

  it('is idempotent on a double close and a double open', async () => {
    const transport = await WebSerialTransport.request()
    await transport.open(115200)
    await transport.open(9600) // ignored: already open
    expect(port.opened?.baudRate).toBe(115200)
    await transport.close()
    await transport.close()
    expect(port.closeCalls).toBe(1)
  })

  it('reopens at a new bit rate', async () => {
    const transport = await WebSerialTransport.request()
    await transport.open(115200)
    await transport.reopen(256000)
    expect(port.opened?.baudRate).toBe(256000)
    expect(transport.baudRate).toBe(256000)
    await transport.close()
  })

  it('lists ports already granted without prompting', async () => {
    install(port, [port])
    const granted = await WebSerialTransport.listGranted()
    expect(granted).toHaveLength(1)
    expect(granted[0]!.info.label).toBe('FTDI FT232R (0403:6001)')
  })

  it('stops notifying a listener that unsubscribed', async () => {
    const transport = await WebSerialTransport.request()
    const chunks: Uint8Array[] = []
    const off = transport.onData((chunk) => chunks.push(chunk))
    await transport.open(115200)

    port.emit([0x01])
    await flush()
    off()
    port.emit([0x02])
    await flush()

    expect(chunks).toHaveLength(1)
    await transport.close()
  })
})
