import { describe, expect, it } from 'vitest'
import { LD2420_FIRMWARE } from '../devices/ld2420/firmwareProfile'
import {
  parseFirmwareProtocol,
  validateFirmwareProtocol,
  withOverrides,
  type FirmwareProtocol,
} from './firmware'

const base = LD2420_FIRMWARE

function tweak(patch: Partial<FirmwareProtocol>): FirmwareProtocol {
  return { ...base, ...patch }
}

describe('withOverrides', () => {
  it('leaves the original alone', () => {
    const next = withOverrides(base, { blockSize: 64 })
    expect(next.blockSize).toBe(64)
    expect(base.blockSize).toBe(128)
  })

  it('keeps the block frame limit consistent with the block size', () => {
    expect(withOverrides(base, { blockSize: 64 }).maxBlockFrameLength).toBe(64 + 20)
    expect(withOverrides(base, { blockSize: 256 }).maxBlockFrameLength).toBe(256 + 20)
  })

  it('passes through what it is not given', () => {
    expect(withOverrides(base, {}).flashSize).toBe(base.flashSize)
  })
})

describe('validateFirmwareProtocol', () => {
  it('accepts the shipped descriptor', () => {
    expect(validateFirmwareProtocol(base)).toEqual([])
  })

  it('rejects a command byte outside a byte', () => {
    const broken = tweak({ commands: { ...base.commands, reboot: 0x1ff } })
    expect(validateFirmwareProtocol(broken)[0]).toMatch(/reboot must be a byte/)
  })

  it('rejects two commands sharing a byte, whose replies could not be told apart', () => {
    const broken = tweak({
      commands: { ...base.commands, sendBlock: base.commands.setUpgradeMode },
    })
    expect(validateFirmwareProtocol(broken).some((p) => /share the same byte/.test(p))).toBe(true)
  })

  it('rejects a block size that is not a multiple of the alignment', () => {
    expect(
      validateFirmwareProtocol(tweak({ blockSize: 130 })).some((p) =>
        /multiple of the alignment/.test(p),
      ),
    ).toBe(true)
  })

  it('rejects a frame limit too small for one block', () => {
    expect(
      validateFirmwareProtocol(tweak({ maxBlockFrameLength: 20 })).some((p) =>
        /smaller than one block/.test(p),
      ),
    ).toBe(true)
  })

  it('rejects an empty partition list, which would abort every transfer', () => {
    expect(validateFirmwareProtocol(tweak({ partitions: {} }))[0]).toMatch(/at least one/i)
  })

  it('rejects indistinguishable written and programmed statuses', () => {
    const broken = tweak({ status: { ...base.status, written: base.status.programmed } })
    expect(validateFirmwareProtocol(broken).some((p) => /cannot be the same/.test(p))).toBe(true)
  })

  it('rejects non-positive sizes and timeouts', () => {
    expect(validateFirmwareProtocol(tweak({ flashSize: 0 })).length).toBeGreaterThan(0)
    expect(validateFirmwareProtocol(tweak({ blockTimeoutMs: 0 })).length).toBeGreaterThan(0)
    expect(validateFirmwareProtocol(tweak({ alignment: 0 })).length).toBeGreaterThan(0)
  })
})

describe('validateFirmwareProtocol on hand-written input', () => {
  // The descriptor can arrive from a paste box, so the validator must explain
  // a malformed one rather than throw on a missing field.
  it('names a missing block instead of crashing', () => {
    expect(validateFirmwareProtocol({} as FirmwareProtocol)[0]).toMatch(/no `commands` block/)
    const noStatus = { ...base } as Partial<FirmwareProtocol>
    delete noStatus.status
    expect(validateFirmwareProtocol(noStatus as FirmwareProtocol)[0]).toMatch(/no `status` block/)
    const noPartitions = { ...base } as Partial<FirmwareProtocol>
    delete noPartitions.partitions
    expect(validateFirmwareProtocol(noPartitions as FirmwareProtocol)[0]).toMatch(
      /no `partitions` block/,
    )
  })

  it('does not throw on junk', () => {
    expect(() => validateFirmwareProtocol(null as unknown as FirmwareProtocol)).not.toThrow()
    expect(() => validateFirmwareProtocol(42 as unknown as FirmwareProtocol)).not.toThrow()
  })
})

describe('parseFirmwareProtocol', () => {
  it('round-trips a descriptor', () => {
    expect(parseFirmwareProtocol(JSON.stringify(base))).toEqual(base)
  })

  it('refuses anything that is not a usable descriptor', () => {
    expect(() => parseFirmwareProtocol('nope')).toThrow(/not valid JSON/)
    expect(() => parseFirmwareProtocol('null')).toThrow(/Empty descriptor/)
    expect(() => parseFirmwareProtocol('{}')).toThrow(/no `commands` block/)
    expect(() => parseFirmwareProtocol(JSON.stringify(tweak({ blockSize: -1 })))).toThrow(
      /Invalid descriptor/,
    )
  })
})
