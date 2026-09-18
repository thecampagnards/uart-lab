/**
 * Firmware descriptors that are not tied to one device.
 *
 * The frame envelope and the transfer sequence are shared across Hi-Link's LD
 * family, so a descriptor is all it takes to point the uploader at another
 * module. Per-device descriptors live in their own folder; this file holds the
 * vendor-generic one and the catalogue that collects them.
 */
import type { FirmwareProtocol } from '../core/firmware'
import { LD2420_FIRMWARE } from './ld2420/firmwareProfile'

/**
 * The LD2420 sequence with its provenance made explicit.
 *
 * The vendor tools for the other LD modules offer the same "get firmware
 * information, pick a .bin, burn" workflow, which suggests one bootloader
 * design across the range — but nothing published confirms that the command
 * bytes, the block size or the status codes are the same elsewhere, so this is
 * `verified: false` and the interface says so.
 */
export const GENERIC_HILINK_FIRMWARE: FirmwareProtocol = {
  ...LD2420_FIRMWARE,
  id: 'hilink-generic',
  label: 'Hi-Link LD family (generic)',
  verified: false,
  caveat:
    'The frame envelope is shared across the LD family, but these command bytes and status ' +
    'codes have only been observed on the LD2420. Confirm them against your module before use.',
}

export const FIRMWARE_PROFILES: FirmwareProtocol[] = [LD2420_FIRMWARE, GENERIC_HILINK_FIRMWARE]

export function findFirmwareProfile(id: string): FirmwareProtocol | undefined {
  return FIRMWARE_PROFILES.find((profile) => profile.id === id)
}
