import { describe, expect, it } from 'vitest'
import { fromHex, toHex } from '../../core/bytes'
import { OperatingMode } from './constants'
import {
  ENERGY_FRAME_LENGTH,
  Ld2420FrameReader,
  MAX_PARAM_READS_PER_FRAME,
  MAX_PARAM_WRITES_PER_FRAME,
  cmdCloseCommandMode,
  cmdGetParameters,
  cmdGetVersion,
  cmdOpenCommandMode,
  cmdReboot,
  cmdSetMode,
  cmdSetParameters,
  configAddresses,
  dbToLinear,
  decodeCommandResponse,
  decodeEnergyReport,
  decodeSimpleLine,
  encodeCommand,
  linearToDb,
} from './frames'
import { encodeEnergyFrame } from './simulator'

// Every expectation below is a literal example from the protocol document, so a
// refactor that silently changes the wire format fails here.
describe('command encoding matches the protocol document', () => {
  it('open_command_mode', () => {
    expect(toHex(cmdOpenCommandMode(1), '')).toBe('fdfcfbfa0400ff00010004030201')
  })

  it('close_command_mode', () => {
    expect(toHex(cmdCloseCommandMode(), '')).toBe('fdfcfbfa0200fe0004030201')
  })

  it('get_version', () => {
    expect(toHex(cmdGetVersion(), '')).toBe('fdfcfbfa0200000004030201')
  })

  it('reboot', () => {
    expect(toHex(cmdReboot(), '')).toBe('fdfcfbfa0200680004030201')
  })

  it('set_mode', () => {
    expect(toHex(cmdSetMode(OperatingMode.Debug), '')).toBe('fdfcfbfa0800120000000000000004030201')
    expect(toHex(cmdSetMode(OperatingMode.Report), '')).toBe('fdfcfbfa0800120000000400000004030201')
    expect(toHex(cmdSetMode(OperatingMode.Simple), '')).toBe('fdfcfbfa0800120000006400000004030201')
  })

  it('get_parameter with five addresses', () => {
    expect(toHex(cmdGetParameters([0, 1, 2, 3, 4]), '')).toBe(
      'fdfcfbfa0c00080000000100020003000400' + '04030201',
    )
  })

  it('set_parameter for the absence delay', () => {
    expect(toHex(cmdSetParameters([{ address: 0x0004, value: 30 }]), '')).toBe(
      'fdfcfbfa0800070004001e00000004030201',
    )
  })

  it('refuses to build a frame the device would drop', () => {
    expect(() => encodeCommand(0x08, new Uint8Array(60))).toThrow(RangeError)
    expect(() => cmdGetParameters([])).toThrow()
    expect(() => cmdSetParameters([])).toThrow()
  })

  it('batches within the 64-byte ceiling', () => {
    expect(MAX_PARAM_READS_PER_FRAME).toBe(12)
    expect(MAX_PARAM_WRITES_PER_FRAME).toBe(8)
    const reads = cmdGetParameters(Array.from({ length: MAX_PARAM_READS_PER_FRAME }, (_, i) => i))
    expect(reads.length).toBeLessThanOrEqual(64)
    const writes = cmdSetParameters(
      Array.from({ length: MAX_PARAM_WRITES_PER_FRAME }, (_, i) => ({ address: i, value: i })),
    )
    expect(writes.length).toBeLessThanOrEqual(64)
  })
})

describe('response decoding', () => {
  it('decodes the documented version reply', () => {
    const response = decodeCommandResponse(fromHex('fdfcfbfa0c0000010000060076312e362e3104030201'))
    expect(response).not.toBeNull()
    expect(response!.command).toBe(0x00)
    expect(response!.ok).toBe(true)
    expect(toHex(response!.data, '')).toBe('0600' + '76312e362e31')
  })

  it('flags a NACK', () => {
    const response = decodeCommandResponse(fromHex('fdfcfbfa040007010100' + '04030201'))
    expect(response!.ok).toBe(false)
    expect(response!.status).toBe(1)
  })

  it('rejects a frame whose length field disagrees with its size', () => {
    expect(decodeCommandResponse(fromHex('fdfcfbfa0a00000100000403' + '0201'))).toBeNull()
  })

  it('rejects a request frame arriving on the receive path', () => {
    expect(decodeCommandResponse(fromHex('fdfcfbfa0200000004030201'))).toBeNull()
  })
})

describe('energy report decoding', () => {
  const energy = Array.from({ length: 16 }, (_, i) => 1000 + i)

  it('is 45 bytes and round-trips', () => {
    const frame = encodeEnergyFrame(true, 237, energy)
    expect(frame.length).toBe(ENERGY_FRAME_LENGTH)
    expect(frame.length).toBe(45)
    const decoded = decodeEnergyReport(frame)
    expect(decoded).not.toBeNull()
    expect(decoded!.presence).toBe(true)
    expect(decoded!.distanceCm).toBe(237)
    expect(decoded!.energy).toEqual(energy)
  })

  it('rejects a truncated frame rather than reporting zeros', () => {
    const frame = encodeEnergyFrame(true, 237, energy)
    expect(decodeEnergyReport(frame.slice(0, 40))).toBeNull()
  })
})

describe('simple mode lines', () => {
  it('reads "Range N" followed by ON', () => {
    const decoded = decodeSimpleLine(fromHex('52616e6765203232300d0a4f4e0d0a'))
    expect(decoded!.presence).toBe(true)
    expect(decoded!.distanceCm).toBe(220)
  })

  it('reads OFF without mistaking its letters for ON', () => {
    const decoded = decodeSimpleLine(fromHex('4f46460d0a'))
    expect(decoded!.presence).toBe(false)
    expect(decoded!.distanceCm).toBeNull()
  })

  it('reads a bare ON', () => {
    expect(decodeSimpleLine(fromHex('4f4e0d0a'))!.presence).toBe(true)
  })

  it('ignores a line that carries neither', () => {
    expect(decodeSimpleLine(fromHex('0d0a'))).toBeNull()
  })
})

describe('Ld2420FrameReader', () => {
  it('reassembles a frame split across chunks', () => {
    const reader = new Ld2420FrameReader()
    const frame = fromHex('fdfcfbfa0c0000010000060076312e362e3104030201')
    expect(reader.push(frame.slice(0, 7))).toHaveLength(0)
    expect(reader.push(frame.slice(7, 12))).toHaveLength(0)
    const out = reader.push(frame.slice(12))
    expect(out).toHaveLength(1)
    expect(out[0]!.kind).toBe('response')
  })

  it('demultiplexes energy frames and ASCII lines from one stream', () => {
    const reader = new Ld2420FrameReader()
    const energy = encodeEnergyFrame(true, 150, new Array<number>(16).fill(500))
    const stream = new Uint8Array([...energy, ...fromHex('4f46460d0a'), ...energy])
    const out = reader.push(stream)
    expect(out.map((f) => f.kind)).toEqual(['energy', 'simple', 'energy'])
  })

  it('resynchronises after junk without losing the next frame', () => {
    const reader = new Ld2420FrameReader()
    const energy = encodeEnergyFrame(false, 0, new Array<number>(16).fill(1))
    const out = reader.push(new Uint8Array([0x12, 0x34, 0x56, ...energy]))
    expect(out).toHaveLength(1)
    expect(out[0]!.kind).toBe('energy')
    expect(reader.droppedBytes).toBe(3)
  })

  it('does not grow without bound when the device stops mid-frame', () => {
    const reader = new Ld2420FrameReader()
    // A command header claiming far more bytes than will ever arrive.
    reader.push(fromHex('fdfcfbfa'))
    for (let i = 0; i < 200; i++) reader.push(new Uint8Array(64))
    expect(reader.pending).toBeLessThanOrEqual(4096)
  })

  it('steps past a bogus command length instead of stalling', () => {
    const reader = new Ld2420FrameReader()
    const energy = encodeEnergyFrame(true, 10, new Array<number>(16).fill(2))
    const out = reader.push(new Uint8Array([...fromHex('fdfcfbfaffff'), ...energy]))
    expect(out.map((f) => f.kind)).toEqual(['energy'])
  })
})

describe('threshold scaling', () => {
  it('matches the dB values printed by the vendor tool', () => {
    expect(linearToDb(60000)).toBeCloseTo(47.78, 2)
    expect(linearToDb(30000)).toBeCloseTo(44.77, 2)
    expect(linearToDb(100)).toBeCloseTo(20, 6)
  })

  it('inverts', () => {
    expect(dbToLinear(20)).toBe(100)
    expect(dbToLinear(linearToDb(3000))).toBe(3000)
  })

  it('treats zero energy as 0 dB rather than -Infinity', () => {
    expect(linearToDb(0)).toBe(0)
  })
})

describe('configAddresses', () => {
  it('covers the gate range plus the three scalars', () => {
    const addresses = configAddresses()
    expect(addresses).toHaveLength(3 + 16 + 16)
    expect(new Set(addresses).size).toBe(addresses.length)
    expect(addresses.slice(0, 3)).toEqual([0x0000, 0x0001, 0x0004])
    expect(addresses.at(-1)).toBe(0x002f)
  })
})
