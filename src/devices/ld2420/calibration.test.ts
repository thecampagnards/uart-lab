import { describe, expect, it } from 'vitest'
import { TOTAL_GATES } from './constants'
import { factoryConfig } from './config'
import {
  MAX_THRESHOLD,
  emptyStats,
  multipliers,
  proposeConfig,
  summarise,
  type GateStats,
} from './calibration'

const frame = (fill: number | number[]): number[] =>
  typeof fill === 'number' ? new Array<number>(TOTAL_GATES).fill(fill) : fill

const statsFrom = (frames: number[][]): GateStats => summarise(frames)

describe('summarise', () => {
  it('takes the peak and the mean per gate', () => {
    const stats = statsFrom([frame(100), frame(300), frame(200)])
    expect(stats.peak[0]).toBe(300)
    expect(stats.mean[0]).toBe(200)
    expect(stats.samples).toBe(3)
  })

  it('ignores frames that carry no per-gate energy', () => {
    // Simple mode delivers presence and distance but no gate array.
    const stats = summarise([frame(100), [], [1, 2, 3]])
    expect(stats.samples).toBe(1)
    expect(stats.peak[0]).toBe(100)
  })

  it('returns zeros rather than NaN for an empty run', () => {
    expect(summarise([])).toEqual(emptyStats())
    expect(summarise([]).mean.every((v) => v === 0)).toBe(true)
  })
})

describe('multipliers', () => {
  it('reproduces ESPHome at the middle setting', () => {
    expect(multipliers(0.5)).toEqual({ move: 2.5, still: 2.25 })
  })

  it('moves the thresholds towards the clutter as sensitivity rises', () => {
    expect(multipliers(1).move).toBeLessThan(multipliers(0).move)
  })

  it('clamps input outside 0..1', () => {
    expect(multipliers(-5)).toEqual(multipliers(0))
    expect(multipliers(9)).toEqual(multipliers(1))
  })

  it('keeps the still threshold below the motion one', () => {
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      expect(multipliers(s).still).toBeLessThan(multipliers(s).move)
    }
  })
})

describe('proposeConfig', () => {
  const current = factoryConfig()

  it('refuses to propose anything without a baseline', () => {
    const result = proposeConfig({
      baseline: emptyStats(),
      presence: null,
      sensitivity: 0.5,
      current,
    })
    expect(result.usable).toBe(false)
    expect(result.warnings[0]).toMatch(/Record the empty area first/)
  })

  it('places thresholds above the measured clutter', () => {
    const baseline = statsFrom(Array.from({ length: 40 }, () => frame(1000)))
    const { config, gates } = proposeConfig({
      baseline,
      presence: null,
      sensitivity: 0.5,
      current,
    })
    expect(config.moveThresholds[0]).toBe(2500)
    expect(config.stillThresholds[0]).toBe(2250)
    expect(gates[0]!.baselinePeak).toBe(1000)
  })

  it('never proposes a still threshold above the motion one', () => {
    const baseline = statsFrom(Array.from({ length: 40 }, () => frame(30000)))
    const { config } = proposeConfig({ baseline, presence: null, sensitivity: 0, current })
    for (let gate = 0; gate < TOTAL_GATES; gate++) {
      expect(config.stillThresholds[gate]!).toBeLessThanOrEqual(config.moveThresholds[gate]!)
    }
  })

  it('clamps at the 16-bit ceiling and says which gates are stuck', () => {
    const baseline = statsFrom(Array.from({ length: 40 }, () => frame(60000)))
    const result = proposeConfig({ baseline, presence: null, sensitivity: 0.5, current })
    expect(result.config.moveThresholds.every((v) => v <= MAX_THRESHOLD)).toBe(true)
    expect(result.warnings.some((w) => /65535 ceiling/.test(w))).toBe(true)
  })

  it('derives the gate range from where a person was actually seen', () => {
    const baseline = statsFrom(Array.from({ length: 40 }, () => frame(100)))
    // Someone detected at gates 3 to 6 only.
    const occupied = frame(100)
    for (const gate of [3, 4, 5, 6]) occupied[gate] = 9000
    const presence = statsFrom(Array.from({ length: 40 }, () => occupied))

    const result = proposeConfig({ baseline, presence, sensitivity: 0.5, current })
    expect(result.config.minGate).toBe(3)
    expect(result.config.maxGate).toBe(6)
    expect(result.gates[3]!.canFire).toBe(true)
    expect(result.gates[0]!.canFire).toBe(false)
  })

  it('names gates inside the range that nobody ever crossed', () => {
    const baseline = statsFrom(Array.from({ length: 40 }, () => frame(100)))
    const occupied = frame(100)
    for (const gate of [2, 6]) occupied[gate] = 9000 // nothing between them
    const presence = statsFrom(Array.from({ length: 40 }, () => occupied))

    const result = proposeConfig({ baseline, presence, sensitivity: 0.5, current })
    expect(result.warnings.some((w) => /3, 4, 5/.test(w))).toBe(true)
  })

  it('says so when the presence recording crossed nothing', () => {
    const baseline = statsFrom(Array.from({ length: 40 }, () => frame(1000)))
    const presence = statsFrom(Array.from({ length: 40 }, () => frame(1100)))
    const result = proposeConfig({ baseline, presence, sensitivity: 0.5, current })
    expect(result.warnings.some((w) => /No gate was crossed/.test(w))).toBe(true)
    // The range is left alone rather than set to something meaningless.
    expect(result.config.minGate).toBe(current.minGate)
  })

  it('warns that an unverified proposal is unverified', () => {
    const baseline = statsFrom(Array.from({ length: 40 }, () => frame(100)))
    const result = proposeConfig({ baseline, presence: null, sensitivity: 0.5, current })
    expect(result.warnings.some((w) => /nothing checks/.test(w))).toBe(true)
  })

  it('warns about a recording too short to mean anything', () => {
    const baseline = statsFrom([frame(100), frame(100)])
    const result = proposeConfig({ baseline, presence: null, sensitivity: 0.5, current })
    expect(result.warnings.some((w) => /only 2 frames/.test(w))).toBe(true)
  })

  it('leaves the fields it has no opinion about alone', () => {
    const baseline = statsFrom(Array.from({ length: 40 }, () => frame(100)))
    const withDelay = { ...current, timeoutS: 90 }
    const result = proposeConfig({
      baseline,
      presence: null,
      sensitivity: 0.5,
      current: withDelay,
    })
    expect(result.config.timeoutS).toBe(90)
  })
})
