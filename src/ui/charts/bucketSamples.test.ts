import { describe, expect, it } from 'vitest'
import { TOTAL_GATES } from '../../devices/ld2420/constants'
import type { Measurement } from '../../devices/ld2420/driver'
import { COLUMNS, bucketSamples } from './bucketSamples'

const sample = (t: number, energy: number[], presence = true): Measurement => ({
  t,
  presence,
  distanceCm: 150,
  energy,
})

const flat = (value: number): number[] => new Array<number>(TOTAL_GATES).fill(value)

describe('bucketSamples', () => {
  it('always produces a full grid, even with no samples', () => {
    const columns = bucketSamples([], 60_000, COLUMNS)
    expect(columns).toHaveLength(COLUMNS)
    expect(columns[0]!.bins).toHaveLength(TOTAL_GATES)
    // -1 is the "nothing recorded" sentinel the chart renders as transparent.
    expect(columns.every((c) => c.bins.every((b) => b.raw === -1))).toBe(true)
  })

  it('places the newest sample in the last column', () => {
    const columns = bucketSamples([sample(60_000, flat(1000))], 60_000, COLUMNS)
    expect(columns.at(-1)!.bins[0]!.raw).toBe(1000)
    expect(columns[0]!.bins[0]!.raw).toBe(-1)
  })

  it('keeps the peak in a bucket rather than the last or the mean', () => {
    // Three samples inside the same one-second bucket.
    const samples = [
      sample(59_000, flat(100)),
      sample(59_400, flat(9000)),
      sample(59_900, flat(200)),
    ]
    const columns = bucketSamples(samples, 60_000, COLUMNS)
    const peaks = columns.flatMap((c) => c.bins.map((b) => b.raw))
    expect(Math.max(...peaks)).toBe(9000)
  })

  it('converts to dB for the colour channel', () => {
    const columns = bucketSamples([sample(60_000, flat(100))], 60_000, COLUMNS)
    expect(columns.at(-1)!.bins[0]!.count).toBeCloseTo(20, 6)
  })

  it('clamps dB to the top of the scale instead of overflowing the ramp', () => {
    const columns = bucketSamples([sample(60_000, flat(65535))], 60_000, COLUMNS)
    expect(columns.at(-1)!.bins[0]!.count).toBeLessThanOrEqual(50)
  })

  it('ignores simple-mode samples that carry no gate energy', () => {
    const columns = bucketSamples([sample(60_000, [])], 60_000, COLUMNS)
    expect(columns.every((c) => c.bins.every((b) => b.raw === -1))).toBe(true)
  })

  it('spreads a full window across every column', () => {
    const samples = Array.from({ length: 600 }, (_, i) => sample(i * 100, flat(500 + i)))
    const columns = bucketSamples(samples, 60_000, COLUMNS)
    expect(columns.every((column) => column.bins.every((bin) => bin.raw >= 0))).toBe(true)
    // Energy rises with time, so the last column must hold the largest peak.
    expect(columns.at(-1)!.bins[0]!.raw).toBeGreaterThan(columns[0]!.bins[0]!.raw)
  })

  it('drops samples older than the window instead of clamping them to the left edge', () => {
    const samples = [sample(-100_000, flat(10)), sample(0, flat(20))]
    const columns = bucketSamples(samples, 60_000, COLUMNS)
    expect(columns).toHaveLength(COLUMNS)
    expect(columns[0]!.bins[0]!.raw).toBe(-1)
    expect(columns.at(-1)!.bins[0]!.raw).toBe(20)
  })

  it('carries presence and distance from the latest sample of each bucket', () => {
    const columns = bucketSamples(
      [sample(59_000, flat(100), true), sample(59_500, flat(100), false)],
      60_000,
      COLUMNS,
    )
    const touched = columns.filter((c) => c.bins[0]!.raw >= 0)
    expect(touched.at(-1)!.bins[0]!.presence).toBe(false)
  })
})
