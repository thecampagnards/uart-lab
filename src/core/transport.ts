/** The byte pipe a device driver talks through, independent of Web Serial. */

export type Unsubscribe = () => void

export interface TransportInfo {
  /** Short human label, e.g. `FTDI FT232RL (0403:6001)`. */
  label: string
  usbVendorId?: number
  usbProductId?: number
}

export interface Transport {
  readonly kind: 'webserial' | 'simulated'
  readonly info: TransportInfo
  readonly isOpen: boolean
  readonly baudRate: number

  open(baudRate: number): Promise<void>
  /** Close and reopen at a new bit rate, keeping the same underlying port. */
  reopen(baudRate: number): Promise<void>
  close(): Promise<void>
  write(bytes: Uint8Array): Promise<void>

  onData(listener: (chunk: Uint8Array) => void): Unsubscribe
  /** Fires when the link drops, either on request (`reason` undefined) or on error. */
  onClose(listener: (reason?: Error) => void): Unsubscribe
}

/** Minimal listener bookkeeping shared by the transports. */
export class Emitter<T extends unknown[]> {
  private listeners = new Set<(...args: T) => void>()

  add(listener: (...args: T) => void): Unsubscribe {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(...args: T): void {
    for (const listener of [...this.listeners]) listener(...args)
  }

  clear(): void {
    this.listeners.clear()
  }
}

export function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator
}

/** Known USB-UART bridges, so the port list reads as something other than hex. */
const USB_VENDORS: Record<number, string> = {
  0x0403: 'FTDI',
  0x10c4: 'Silicon Labs',
  0x1a86: 'QinHeng (CH34x)',
  0x067b: 'Prolific',
  0x2341: 'Arduino',
  0x303a: 'Espressif',
}

const USB_PRODUCTS: Record<string, string> = {
  '0403:6001': 'FT232R',
  '0403:6010': 'FT2232',
  '0403:6014': 'FT232H',
  '0403:6015': 'FT231X',
  '10c4:ea60': 'CP2102',
  '1a86:7523': 'CH340',
  '1a86:55d4': 'CH9102',
}

export function describeUsbDevice(vendorId?: number, productId?: number): string {
  if (vendorId === undefined || productId === undefined) return 'Serial port'
  const key = `${vendorId.toString(16).padStart(4, '0')}:${productId.toString(16).padStart(4, '0')}`
  const product = USB_PRODUCTS[key]
  const vendor = USB_VENDORS[vendorId]
  if (product && vendor) return `${vendor} ${product} (${key})`
  if (vendor) return `${vendor} (${key})`
  return `USB ${key}`
}
