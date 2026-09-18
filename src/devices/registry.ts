/**
 * Catalogue of supported devices.
 *
 * Adding a device means adding an entry here plus its `devices/<id>/` folder;
 * nothing in the shell hard-codes a particular one. The capabilities listed on
 * each entry are what the shell turns into tabs.
 */
import type { FirmwareProtocol } from '../core/firmware'
import { GENERIC_HILINK_FIRMWARE } from './firmwareProfiles'
import { LD2420_FIRMWARE } from './ld2420/firmwareProfile'
import type { DeviceCapability, SerialPortFilterLike } from './types'

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
  /** Drives which tabs the shell shows. */
  capabilities: DeviceCapability[]
  /** Descriptor used when writing firmware, for devices that support it. */
  firmware?: FirmwareProtocol
  /** False until the device has a driver; the UI greys these out. */
  implemented: boolean
}

const HILINK_BRIDGES: SerialPortFilterLike[] = [
  { usbVendorId: 0x0403 }, // FTDI — FT232RL and friends
  { usbVendorId: 0x10c4 }, // Silicon Labs CP210x
  { usbVendorId: 0x1a86 }, // CH340 / CH9102
  { usbVendorId: 0x067b }, // Prolific PL2303
]

export const LD2420: DeviceDescriptor = {
  id: 'hlk-ld2420',
  name: 'HLK-LD2420',
  vendor: 'Hi-Link',
  summary:
    '24 GHz mmWave human presence radar. 16 gates of 0.7 m, with per-gate motion and still thresholds.',
  defaultBaudRate: 115200,
  supportedBaudRates: [9600, 19200, 38400, 57600, 115200, 230400, 256000, 460800],
  portFilters: HILINK_BRIDGES,
  capabilities: ['monitor', 'calibrate', 'configure', 'firmware', 'trace'],
  firmware: LD2420_FIRMWARE,
  implemented: true,
}

/**
 * Whatever is on the other end of the wire.
 *
 * No driver, so nothing here decodes: the serial monitor shows the bytes as
 * they arrive and sends what you type, which is what you actually need when the
 * question is whether the device is talking at all and at what bit rate. The
 * flash panel is the same transfer as the LD2420's, driven by a descriptor you
 * write — so a module this project has never seen is reachable without a code
 * change.
 *
 * Deliberately not tied to a vendor: the serial monitor works against anything,
 * and the flash descriptor defaults to the Hi-Link shape only because that is
 * the sequence that exists.
 */
export const GENERIC_SERIAL: DeviceDescriptor = {
  id: 'generic-serial',
  name: 'Any serial device',
  vendor: 'Unknown',
  summary:
    'No driver, no assumptions. Listen to the raw stream, send bytes, and flash with a descriptor you supply.',
  defaultBaudRate: 115200,
  // Every rate the picker offers: with an unknown device, finding the right one
  // is half the job.
  supportedBaudRates: [
    1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 256000, 460800, 921600,
  ],
  // No vendor filter: the point is to reach whatever is plugged in.
  portFilters: [],
  capabilities: ['terminal', 'flash'],
  firmware: GENERIC_HILINK_FIRMWARE,
  implemented: true,
}

export const DEVICES: DeviceDescriptor[] = [LD2420, GENERIC_SERIAL]

export function findDevice(id: string): DeviceDescriptor | undefined {
  return DEVICES.find((device) => device.id === id)
}

export function deviceCan(device: DeviceDescriptor, capability: DeviceCapability): boolean {
  return device.capabilities.includes(capability)
}
