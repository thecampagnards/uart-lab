/**
 * The LD2420's own firmware descriptor.
 *
 * Every command below is annotated in the protocol document as having been
 * captured from HLK-LD2420_Tool v1.2.0.0, which is what makes this the only
 * descriptor marked `verified`. Anything device-agnostic lives in
 * `src/devices/firmwareProfiles.ts`, not here.
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
