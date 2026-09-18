import { describe, expect, it } from 'vitest'
import { Param, moveThresholdAddr, stillThresholdAddr } from './constants'
import {
  cloneConfig,
  configFromValues,
  configsEqual,
  diffConfig,
  factoryConfig,
  parseConfigFile,
  toConfigFile,
  validateConfig,
} from './config'

describe('factory config', () => {
  it('matches the ABD default table', () => {
    const config = factoryConfig()
    expect(config.minGate).toBe(0)
    expect(config.maxGate).toBe(12)
    expect(config.timeoutS).toBe(30)
    expect(config.moveThresholds[0]).toBe(60000)
    expect(config.moveThresholds[15]).toBe(200)
    expect(config.stillThresholds[0]).toBe(40000)
    expect(config.stillThresholds[15]).toBe(100)
  })

  it('hands out independent copies', () => {
    const a = factoryConfig()
    const b = cloneConfig(a)
    b.moveThresholds[0] = 1
    expect(a.moveThresholds[0]).toBe(60000)
    expect(configsEqual(a, b)).toBe(false)
  })
})

describe('configFromValues', () => {
  it('rebuilds from a bulk read', () => {
    const values = new Map<number, number>([
      [Param.MinGate, 1],
      [Param.MaxGate, 9],
      [Param.Timeout, 5],
      [moveThresholdAddr(3), 1234],
      [stillThresholdAddr(7), 77],
    ])
    const config = configFromValues(values)
    expect(config.minGate).toBe(1)
    expect(config.maxGate).toBe(9)
    expect(config.timeoutS).toBe(5)
    expect(config.moveThresholds[3]).toBe(1234)
    expect(config.stillThresholds[7]).toBe(77)
    // Addresses the device did not answer keep the factory value.
    expect(config.moveThresholds[0]).toBe(60000)
  })
})

describe('diffConfig', () => {
  it('writes nothing when nothing changed', () => {
    expect(diffConfig(factoryConfig(), factoryConfig())).toEqual([])
  })

  it('writes only the fields that moved', () => {
    const current = factoryConfig()
    const next = cloneConfig(current)
    next.timeoutS = 60
    next.moveThresholds[4] = 900
    expect(diffConfig(current, next)).toEqual([
      { address: Param.Timeout, value: 60 },
      { address: moveThresholdAddr(4), value: 900 },
    ])
  })
})

describe('validateConfig', () => {
  it('accepts the factory config', () => {
    expect(validateConfig(factoryConfig())).toEqual([])
  })

  it('rejects an inverted gate range', () => {
    const config = { ...factoryConfig(), minGate: 10, maxGate: 2 }
    expect(validateConfig(config).map((p) => p.field)).toContain('minGate')
  })

  it('rejects out-of-range and non-integer values', () => {
    const config = cloneConfig(factoryConfig())
    config.timeoutS = 70000
    config.moveThresholds[2] = 1.5
    config.stillThresholds[3] = -1
    const fields = validateConfig(config).map((p) => p.field)
    expect(fields).toEqual(
      expect.arrayContaining(['timeoutS', 'moveThresholds.2', 'stillThresholds.3']),
    )
  })

  it('rejects a short threshold array', () => {
    const config = { ...factoryConfig(), moveThresholds: [1, 2, 3] }
    expect(validateConfig(config).map((p) => p.field)).toContain('moveThresholds')
  })
})

describe('config files', () => {
  it('round-trips an export', () => {
    const config = cloneConfig(factoryConfig())
    config.timeoutS = 45
    const json = JSON.stringify(toConfigFile(config, { firmware: 'v1.6.1' }))
    expect(configsEqual(parseConfigFile(json), config)).toBe(true)
  })

  it('accepts a bare config object as well as a wrapped file', () => {
    const config = factoryConfig()
    expect(configsEqual(parseConfigFile(JSON.stringify(config)), config)).toBe(true)
  })

  it('refuses anything that is not a valid config', () => {
    expect(() => parseConfigFile('not json')).toThrow(/JSON/)
    expect(() => parseConfigFile('{}')).toThrow(/Invalid configuration/)
    expect(() => parseConfigFile(JSON.stringify({ ...factoryConfig(), maxGate: 99 }))).toThrow(
      /Invalid configuration/,
    )
  })
})
