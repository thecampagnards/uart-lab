/**
 * Firmware upgrade, end to end against the simulator.
 *
 * This is the one irreversible operation in the driver and it cannot be
 * rehearsed on real hardware without risking the module, so the simulated
 * device implements the same state machine — including the failure modes the
 * protocol document lists — and the whole sequence is exercised here.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { fromHex, toHex } from '../../core/bytes'
import { FIRMWARE_BLOCK_SIZE } from './constants'
import { LD2420_FIRMWARE } from './firmwareProfile'
import { cmdInitFirmwareUpgrade, cmdSendFirmwareBlock, cmdSetUpgradeMode } from './frames'
import {
  FirmwareError,
  describeBlockStatus,
  describeInitStatus,
  firmwareChecksum,
  splitFirmwareBlocks,
  validateFirmwareImage,
  type FirmwareProgress,
} from '../../core/firmware'
import { Ld2420Driver } from './driver'
import { Ld2420Simulator, type SimulatorOptions } from './simulator'

/** A deterministic, 4-byte-aligned image. */
function image(bytes: number): Uint8Array {
  return Uint8Array.from({ length: bytes }, (_, i) => (i * 7 + 13) & 0xff)
}

describe('firmware framing', () => {
  it('computes the checksum as a truncated byte sum', () => {
    expect(firmwareChecksum(Uint8Array.from([1, 2, 3]))).toBe(6)
    expect(firmwareChecksum(new Uint8Array(0))).toBe(0)
    // 0x1000000 bytes of 0xff would wrap; check the truncation explicitly.
    expect(firmwareChecksum(new Uint8Array(300).fill(0xff))).toBe(300 * 255)
  })

  it('matches the documented init frame', () => {
    // fdfcfbfa 0e00 7200 01000000 00040000 c6fc0100 04030201
    expect(toHex(cmdInitFirmwareUpgrade(1, 1024, 0x0001fcc6), '')).toBe(
      'fdfcfbfa0e0072000100000000040000c6fc010004030201',
    )
  })

  it('matches the documented upgrade-mode frame', () => {
    expect(toHex(cmdSetUpgradeMode(), '')).toBe('fdfcfbfa0200740004030201')
  })

  it('builds a 148-byte block frame, over the ordinary 64-byte ceiling', () => {
    const frame = cmdSendFirmwareBlock(0, image(FIRMWARE_BLOCK_SIZE))
    expect(frame.length).toBe(148)
    // Length field is 0x8a = 138, per the protocol document.
    expect(toHex(frame.slice(4, 6), '')).toBe('8a00')
    expect(frame[6]).toBe(0x73)
  })

  it('still refuses an oversized ordinary command', () => {
    expect(() => cmdSendFirmwareBlock(0, image(FIRMWARE_BLOCK_SIZE + 4))).toThrow(RangeError)
  })

  it('splits an image into whole blocks plus a remainder', () => {
    const blocks = splitFirmwareBlocks(image(300), 128)
    expect(blocks.map((b) => b.length)).toEqual([128, 128, 44])
    expect(splitFirmwareBlocks(new Uint8Array(0), 128)).toEqual([])
  })

  it('names the documented failure statuses', () => {
    expect(describeInitStatus(0x00, LD2420_FIRMWARE)).toBeNull()
    expect(describeInitStatus(0x94, LD2420_FIRMWARE)).toBeNull() // a buffer size, not an error
    expect(describeInitStatus(0x04, LD2420_FIRMWARE)).toMatch(/erase/i)
    expect(describeBlockStatus(0x00, LD2420_FIRMWARE)).toEqual([])
    expect(describeBlockStatus(0x80, LD2420_FIRMWARE)).toEqual([])
    expect(describeBlockStatus(0x20, LD2420_FIRMWARE)).toEqual([
      expect.stringMatching(/4-byte aligned/),
    ])
    // The field is a bit set, so several reasons can arrive together.
    expect(describeBlockStatus(0x0a, LD2420_FIRMWARE)).toHaveLength(2)
    expect(describeBlockStatus(0x1000, LD2420_FIRMWARE)).toEqual([
      expect.stringMatching(/Unknown block status/),
    ])
  })
})

describe('validateFirmwareImage', () => {
  it('accepts a well-formed image', () => {
    expect(validateFirmwareImage(image(1024), LD2420_FIRMWARE)).toEqual([])
  })

  it('rejects an empty file', () => {
    expect(validateFirmwareImage(new Uint8Array(0), LD2420_FIRMWARE)[0]).toMatch(/empty/i)
  })

  it('rejects an unaligned image before anything irreversible happens', () => {
    expect(validateFirmwareImage(image(1022), LD2420_FIRMWARE)[0]).toMatch(/multiple of 4/)
  })

  it('rejects an image larger than the flash', () => {
    expect(validateFirmwareImage(image(LD2420_FIRMWARE.flashSize + 4), LD2420_FIRMWARE)[0]).toMatch(
      /target flash is/,
    )
  })
})

describe('Ld2420Driver.uploadFirmware', () => {
  let simulator: Ld2420Simulator
  let driver: Ld2420Driver

  const connect = async (options: SimulatorOptions = {}): Promise<void> => {
    simulator = new Ld2420Simulator({ autoRun: false, ...options })
    driver = new Ld2420Driver(simulator)
    driver.attach()
    await simulator.open(115200)
  }

  beforeEach(async () => {
    await connect()
  })

  it('reads which image is running and which partition is the target', async () => {
    const info = await driver.readFirmwareInfo()
    expect(info.active).toBe('App 0')
    expect(info.partition).toBe('App 0')
    expect(info.activeRaw).toBe(0x02)
  })

  it('transfers an image and the module ends up with exactly those bytes', async () => {
    const payload = image(1024)
    await driver.uploadFirmware(payload)
    expect(simulator.flashedImage).not.toBeNull()
    expect(toHex(simulator.flashedImage!)).toBe(toHex(payload))
  })

  it('handles an image that is not a whole number of blocks', async () => {
    const payload = image(1024 + 44)
    await driver.uploadFirmware(payload)
    expect(simulator.flashedImage).toHaveLength(1068)
    expect(toHex(simulator.flashedImage!)).toBe(toHex(payload))
  })

  it('reports progress through every phase, monotonically', async () => {
    const seen: FirmwareProgress[] = []
    await driver.uploadFirmware(image(512), { onProgress: (p) => seen.push(p) })

    const phases = seen.map((p) => p.phase)
    expect(phases[0]).toBe('preparing')
    expect(phases).toContain('erasing')
    expect(phases).toContain('writing')
    expect(phases.at(-1)).toBe('done')

    const sent = seen.map((p) => p.blocksSent)
    for (let i = 1; i < sent.length; i++) expect(sent[i]).toBeGreaterThanOrEqual(sent[i - 1]!)
    expect(seen.at(-1)!.blocksSent).toBe(4)
    expect(seen.at(-1)!.totalBytes).toBe(512)
  })

  it('adapts when the module wants 1-based block counters', async () => {
    // The protocol document's prose says the first block is 0; its worked
    // example shows 1. The driver starts at 0 and switches if rejected.
    await connect({ firmwareCounterBase: 1 })
    const payload = image(512)
    await driver.uploadFirmware(payload)
    expect(toHex(simulator.flashedImage!)).toBe(toHex(payload))
  })

  it('surfaces a rejected image length without writing anything', async () => {
    // 0x72 rejects a length that is not a multiple of 4.
    await expect(driver.uploadFirmware(image(513).slice(0, 513))).rejects.toBeInstanceOf(
      FirmwareError,
    )
    expect(simulator.flashedImage).toBeNull()
  })

  it('says how far it got when a block is refused', async () => {
    const payload = image(512)
    // Corrupt the third block on the wire by shrinking the module's tolerance:
    // easiest reproducible failure is a checksum the module will not accept.
    const original = simulator.write.bind(simulator)
    let blocks = 0
    simulator.write = (bytes: Uint8Array) => {
      if (bytes[6] === 0x73 && ++blocks === 3) {
        const tampered = bytes.slice()
        tampered[20] = (tampered[20]! ^ 0xff) & 0xff // flip a data byte, not the checksum
        return original(tampered)
      }
      return original(bytes)
    }

    const failure = await driver.uploadFirmware(payload).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(FirmwareError)
    expect((failure as FirmwareError).message).toMatch(/Block 3 of 4/)
    expect((failure as FirmwareError).blocksSent).toBe(2)
    expect(simulator.flashedImage).toBeNull()
  })

  it('leaves the module back in simple mode after a successful transfer', async () => {
    await driver.uploadFirmware(image(256))
    const measurements: number[] = []
    driver.onMeasurement(() => measurements.push(1))
    simulator.tick(100)
    expect(measurements.length).toBeGreaterThan(0)
  })

  it('records the whole exchange in the trace', async () => {
    await driver.uploadFirmware(image(256))
    const commands = driver.trace.filter((e) => e.direction === 'tx').map((e) => e.note)
    expect(commands.some((note) => note?.includes('0x74'))).toBe(true)
    expect(commands.some((note) => note?.includes('0x72'))).toBe(true)
    expect(commands.filter((note) => note?.includes('0x73'))).toHaveLength(2)
  })
})

describe('upgrade mode lockout', () => {
  it('stops answering ordinary commands, as the real module does', async () => {
    const simulator = new Ld2420Simulator({ autoRun: false })
    const driver = new Ld2420Driver(simulator, { commandTimeoutMs: 100 })
    driver.attach()
    await simulator.open(115200)

    await simulator.write(fromHex('fdfcfbfa0400ff00010004030201')) // open_command_mode
    await simulator.write(cmdSetUpgradeMode())

    // A version read is NACKed rather than answered.
    await expect(driver.readIdentity()).rejects.toThrow()
  })
})
