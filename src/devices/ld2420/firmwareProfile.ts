/**
 * Firmware transfer descriptors.
 *
 * `LD2420_FIRMWARE` is the only one backed by observation: every one of the
 * commands below is annotated in the protocol document as having been captured
 * from HLK-LD2420_Tool v1.2.0.0. The frame envelope is shared across Hi-Link's
 * LD family, and the vendor tools all offer the same "get firmware info, pick a
 * .bin, burn" workflow, which suggests one bootloader design across the range —
 * but nothing published confirms that the command bytes, block size or status
 * codes are identical elsewhere. Hence `verified: false` on the generic entry.
 */
import type { FirmwareProtocol } from '../../core/firmware'
import { FIRMWARE_BLOCK_SIZE, FLASH_SIZE_BYTES, MAX_FIRMWARE_FRAME_LENGTH } from './constants'

const COMMANDS = {
  getUpgradePartition: 0x71,
  setUpgradeMode: 0x74,
  initUpgrade: 0x72,
  sendBlock: 0x73,
  reboot: 0x68,
} as const

const STATUS: FirmwareProtocol['status'] = {
  initErrors: {
    0x01: 'Target partition unavailable.',
    0x02: 'Image length rejected by the module.',
    0x04: 'Flash erase failed.',
  },
  blockErrors: [
    [0x01, 'Block sequence number rejected.'],
    [0x02, 'Flash write error.'],
    [0x04, 'Flash read aborted.'],
    [0x08, 'Block checksum mismatch.'],
    [0x10, 'Block length error.'],
    [0x20, 'Data is not 4-byte aligned.'],
    [0x40, 'Image verification failed.'],
  ],
  written: 0x00,
  programmed: 0x80,
  counterError: 0x01,
}

const PARTITIONS = { 0x01: 'App 0', 0x02: 'App 1' }

export const LD2420_FIRMWARE: FirmwareProtocol = {
  id: 'hlk-ld2420',
  label: 'HLK-LD2420',
  verified: true,
  commands: COMMANDS,
  blockSize: FIRMWARE_BLOCK_SIZE,
  flashSize: FLASH_SIZE_BYTES,
  alignment: 4,
  maxBlockFrameLength: MAX_FIRMWARE_FRAME_LENGTH,
  eraseTimeoutMs: 20_000,
  blockTimeoutMs: 6_000,
  upgradeModeSettleMs: 400,
  rebootSettleMs: 600,
  status: STATUS,
  partitions: PARTITIONS,
}

/**
 * The same sequence with the sizes left open, for another Hi-Link LD module.
 * Untested against anything; the interface says so and asks for a second
 * acknowledgement before using it.
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

/** Apply the user's size overrides to a profile, leaving the original untouched. */
export function withOverrides(
  profile: FirmwareProtocol,
  overrides: { blockSize?: number; flashSize?: number; alignment?: number },
): FirmwareProtocol {
  const blockSize = overrides.blockSize ?? profile.blockSize
  return {
    ...profile,
    blockSize,
    flashSize: overrides.flashSize ?? profile.flashSize,
    alignment: overrides.alignment ?? profile.alignment,
    // The block frame grows with the block: 16 bytes of envelope around the data.
    maxBlockFrameLength: 16 + blockSize + 4,
  }
}
