import { describe, expect, it } from 'vitest'
import { MeasurementHistory, downsampleMinMax } from './history'
import type { Measurement } from '../devices/ld2420/driver'

const sample = (t: number, distanceCm = 100): Measurement => ({
  t,
  presence: true,
  distanceCm,
  energy: [],
})

describe('MeasurementHistory', () => {
  it('keeps only the most recent samples', () => {
    const history = new MeasurementHistory(10)
    for (let i = 0; i < 25; i++) history.push(sample(i * 100))
    expect(history.size).toBe(10)
    expect(history.latest()!.t).toBe(2400)
    expect(history.snapshot().totalSamples).toBe(25)
  })

  it('slices a time window relative to the newest sample', () => {
    const history = new MeasurementHistory()
    for (let i = 0; i < 100; i++) history.push(sample(i * 100))
    // The window is relative to the newest sample (9900), not to wall clock.
    const window = history.window(1000)
    expect(window[0]!.t).toBe(8900)
    expect(window.at(-1)!.t).toBe(9900)
  })

  it('measures the sample rate over the span the samples cover', () => {
    const history = new MeasurementHistory()
    for (let i = 0; i < 100; i++) history.push(sample(i * 100))
    expect(history.snapshot().rateHz).toBeCloseTo(10, 5)
  })

  it('reports an empty window before the first sample', () => {
    expect(new MeasurementHistory().window(1000)).toEqual([])
    expect(new MeasurementHistory().snapshot().rateHz).toBe(0)
  })

  it('clears', () => {
    const history = new MeasurementHistory()
    history.push(sample(0))
    history.clear()
    expect(history.latest()).toBeNull()
    expect(history.size).toBe(0)
  })
})

describe('downsampleMinMax', () => {
  it('leaves a short series untouched', () => {
    const samples = [sample(0, 1), sample(1, 2)]
    expect(downsampleMinMax(samples, 100)).toEqual([
      { t: 0, value: 1 },
      { t: 1, value: 2 },
    ])
  })

  it('keeps a one-sample spike visible after reduction', () => {
    const samples = Array.from({ length: 1000 }, (_, i) => sample(i, i === 500 ? 9999 : 100))
    const reduced = downsampleMinMax(samples, 100)
    expect(reduced.length).toBeLessThanOrEqual(120)
    expect(reduced.some((p) => p.value === 9999)).toBe(true)
  })

  it('keeps points in chronological order', () => {
    const samples = Array.from({ length: 500 }, (_, i) => sample(i, Math.sin(i) * 100 + 200))
    const reduced = downsampleMinMax(samples, 50)
    for (let i = 1; i < reduced.length; i++) {
      expect(reduced[i]!.t).toBeGreaterThanOrEqual(reduced[i - 1]!.t)
    }
  })
})
