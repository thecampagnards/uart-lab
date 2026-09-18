/**
 * HLK-LD2420 protocol constants.
 *
 * Sources:
 *  - doc/hlk-ld2420-serial-protocol.md (Damian Michna, CC BY-SA 4.0), firmware 1.6.1
 *  - ESPHome `ld2420` component, for the report/energy frame layout the doc leaves open
 *
 * All multi-byte fields are little-endian.
 */

export const TOTAL_GATES = 16

/** Each detection gate covers ~0.70 m of range. */
export const GATE_SIZE_M = 0.7

/** Command frames: `FD FC FB FA <len:u16> <cmd> <type> [payload] 04 03 02 01`. */
export const CMD_HEADER = [0xfd, 0xfc, 0xfb, 0xfa] as const
export const CMD_FOOTER = [0x04, 0x03, 0x02, 0x01] as const

/** Report ("energy") frames: `F4 F3 F2 F1 <len:u16> ... F8 F7 F6 F5`. */
export const ENERGY_HEADER = [0xf4, 0xf3, 0xf2, 0xf1] as const
export const ENERGY_FOOTER = [0xf8, 0xf7, 0xf6, 0xf5] as const

/** Debug frames, not decoded yet — recognised so the reader can skip them cleanly. */
export const DEBUG_HEADER = [0xaa, 0xbf, 0x10, 0x14] as const
export const DEBUG_FOOTER = [0xfd, 0xfc, 0xfb, 0xfa] as const

export const FrameType = {
  Request: 0x00,
  Response: 0x01,
} as const

export const Cmd = {
  OpenCommandMode: 0xff,
  CloseCommandMode: 0xfe,
  GetVersion: 0x00,
  GetSerial: 0x11,
  SetSerial: 0x10,
  GetRegister: 0x02,
  SetRegister: 0x01,
  GetParameter: 0x08,
  SetParameter: 0x07,
  SetMode: 0x12,
  SetBaudRate: 0x26,
  GetBaudRate: 0x27,
  Reboot: 0x68,
  GetActiveFirmware: 0x70,
  GetUpgradePartition: 0x71,
  InitFirmwareUpgrade: 0x72,
  SendFirmwareBlock: 0x73,
  SetUpgradeMode: 0x74,
  GetFirmwareId: 0x75,
} as const
export type CmdCode = (typeof Cmd)[keyof typeof Cmd]

/** `set_mode` (0x12) payload values. */
export const OperatingMode = {
  /** Verbose raw-ADC stream. Not decoded by this tool. */
  Debug: 0x00,
  /** Per-gate energy + distance report frames — what the charts are fed from. */
  Report: 0x04,
  /** ASCII `ON`/`OFF`/`Range N` lines. Device default after reboot. */
  Simple: 0x64,
} as const
export type OperatingModeValue = (typeof OperatingMode)[keyof typeof OperatingMode]

export const OPERATING_MODE_LABELS: Record<OperatingModeValue, string> = {
  [OperatingMode.Debug]: 'Debug',
  [OperatingMode.Report]: 'Report (energy)',
  [OperatingMode.Simple]: 'Simple (ASCII)',
}

/** `set_baudrate` (0x26) index → bits/s. Index 5 is the factory default above fw 1.5.8. */
export const BAUD_RATES: Record<number, number> = {
  1: 9600,
  2: 19200,
  3: 38400,
  4: 57600,
  5: 115200,
  6: 230400,
  7: 256000,
  8: 460800,
}

export const DEFAULT_BAUD_RATE = 115200

/** A command frame must stay under 64 bytes end to end. */
export const MAX_CMD_FRAME_LENGTH = 64

/** ABD parameter addresses (commands 0x07 / 0x08). */
export const Param = {
  MinGate: 0x0000,
  MaxGate: 0x0001,
  /** Undocumented; present in factory dumps. */
  MinGateAlt: 0x0002,
  MaxGateAlt: 0x0003,
  /** Absence report delay, in seconds. */
  Timeout: 0x0004,
  /** Move ("trigger") thresholds occupy 0x0010..0x001F, one per gate. */
  MoveThresholdBase: 0x0010,
  /** Still ("hold") thresholds occupy 0x0020..0x002F, one per gate. */
  StillThresholdBase: 0x0020,
} as const

export const moveThresholdAddr = (gate: number): number => Param.MoveThresholdBase + gate
export const stillThresholdAddr = (gate: number): number => Param.StillThresholdBase + gate

/** Factory defaults, from the ABD parameter table in the protocol document. */
export const FACTORY_MOVE_THRESHOLDS: readonly number[] = [
  60000, 30000, 3000, 2000, 500, 400, 400, 300, 300, 300, 300, 250, 250, 200, 200, 200,
]
export const FACTORY_STILL_THRESHOLDS: readonly number[] = [
  40000, 20000, 400, 300, 300, 200, 200, 150, 150, 100, 100, 100, 100, 100, 100, 100,
]
export const FACTORY_MIN_GATE = 0
export const FACTORY_MAX_GATE = 12
export const FACTORY_TIMEOUT_S = 30

export const ACK = 0x0000
export const NACK = 0x0001

// ---------------------------------------------------------------------------
// Firmware upgrade (commands 0x70-0x75)
// ---------------------------------------------------------------------------

/**
 * Data payload per `send_firmware_block` frame. The protocol document's own
 * example uses 128 bytes, which puts the frame at 148 bytes end to end — well
 * over the 64-byte ceiling that applies to ordinary commands.
 */
export const FIRMWARE_BLOCK_SIZE = 128

/** 4 header + 2 length + 1 command + 1 type + 4 counter + 4 checksum + data + 4 footer. */
export const MAX_FIRMWARE_FRAME_LENGTH = 16 + FIRMWARE_BLOCK_SIZE + 4

/** The module's flash, for sanity-checking an image before sending it. */
export const FLASH_SIZE_BYTES = 32 * 1024

/** `get_active_firmware` (0x70) result. */
export const ActiveFirmware: Record<number, string> = {
  0x01: 'Bootloader',
  0x02: 'App 0',
  0x04: 'App 1',
}

/** `get_upgrade_partition` (0x71) result. */
export const UpgradePartition: Record<number, string> = {
  0x01: 'App 0',
  0x02: 'App 1',
}

/** `init_firmware_upgrade` (0x72) data status. Any other value is a buffer size. */
export const INIT_ERRORS: Record<number, string> = {
  0x01: 'Target partition unavailable.',
  0x02: 'Image length rejected by the module.',
  0x04: 'Flash erase failed.',
}

/** `send_firmware_block` (0x73) data status. A bit field, except 0x00 and 0x80. */
export const BlockStatus = {
  Written: 0x00,
  CounterError: 0x01,
  FlashWriteError: 0x02,
  FlashReadError: 0x04,
  ChecksumError: 0x08,
  LengthError: 0x10,
  AlignmentError: 0x20,
  VerificationError: 0x40,
  Programmed: 0x80,
} as const

export const BLOCK_ERRORS: [number, string][] = [
  [BlockStatus.CounterError, 'Block sequence number rejected.'],
  [BlockStatus.FlashWriteError, 'Flash write error.'],
  [BlockStatus.FlashReadError, 'Flash read aborted.'],
  [BlockStatus.ChecksumError, 'Block checksum mismatch.'],
  [BlockStatus.LengthError, 'Block length error.'],
  [BlockStatus.AlignmentError, 'Data is not 4-byte aligned.'],
  [BlockStatus.VerificationError, 'Image verification failed.'],
]
