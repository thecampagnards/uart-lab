/**
 * Catalogue of supported devices.
 *
 * Adding a device means adding an entry here plus its `devices/<id>/` folder;
 * nothing in the shell hard-codes the LD2420.
 */
import type { SerialPortFilterLike } from './types'

export interface DeviceDescriptor {
  id: string
  name: string
  vendor: string
  summary: string
  /** Bit rate to try first when connecting. */
  defaultBaudRate: number
  /** Bit rates the firmware accepts, for the reconnect helper. */
  supportedBaudRates: number[]
  /** USB bridges to suggest in the port picker. */
  portFilters: SerialPortFilterLike[]
  /** False until the device has a driver; the UI greys these out. */
  implemented: boolean
}

export const LD2420: DeviceDescriptor = {
  id: 'hlk-ld2420',
  name: 'HLK-LD2420',
  vendor: 'Hi-Link',
  summary:
    '24 GHz mmWave human presence radar. 16 gates of 0.7 m, with per-gate motion and still thresholds.',
  defaultBaudRate: 115200,
  supportedBaudRates: [9600, 19200, 38400, 57600, 115200, 230400, 256000, 460800],
  portFilters: [
    { usbVendorId: 0x0403 },
    { usbVendorId: 0x10c4 },
    { usbVendorId: 0x1a86 },
    { usbVendorId: 0x067b },
  ],
  implemented: true,
}

export const DEVICES: DeviceDescriptor[] = [LD2420]

export function findDevice(id: string): DeviceDescriptor | undefined {
  return DEVICES.find((device) => device.id === id)
}
