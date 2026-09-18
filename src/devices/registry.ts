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
  capabilities: ['monitor', 'configure', 'firmware', 'trace'],
  firmware: LD2420_FIRMWARE,
  implemented: true,
}

/**
 * A module this tool knows nothing about beyond the shared frame envelope.
 *
 * It exists so the generic flasher has somewhere to live that is not another
 * device's folder, and so the unverified path is something you have to select
 * rather than something sitting beside the supported one. No monitoring or
 * configuration: those need per-device knowledge this entry does not have.
 */
export const GENERIC_HILINK: DeviceDescriptor = {
  id: 'hilink-generic',
  name: 'Generic Hi-Link LD',
  vendor: 'Hi-Link',
  summary:
    'Any other LD-family module, for firmware transfer only. The command set is unverified outside the LD2420.',
  defaultBaudRate: 115200,
  supportedBaudRates: [9600, 19200, 38400, 57600, 115200, 230400, 256000, 460800],
  portFilters: HILINK_BRIDGES,
  capabilities: ['flash', 'trace'],
  firmware: GENERIC_HILINK_FIRMWARE,
  implemented: true,
}

export const DEVICES: DeviceDescriptor[] = [LD2420, GENERIC_HILINK]

export function findDevice(id: string): DeviceDescriptor | undefined {
  return DEVICES.find((device) => device.id === id)
}

export function deviceCan(device: DeviceDescriptor, capability: DeviceCapability): boolean {
  return device.capabilities.includes(capability)
}
