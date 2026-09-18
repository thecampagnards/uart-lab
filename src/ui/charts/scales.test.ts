import { describe, expect, it } from 'vitest'
import { clamp, linearScale, nearestIndex, niceDomain, niceTicks } from './scales'

describe('linearScale', () => {
  it('maps a domain onto a range and back', () => {
    const scale = linearScale([0, 100], [0, 200])
    expect(scale(0)).toBe(0)
    expect(scale(50)).toBe(100)
    expect(scale.invert(100)).toBe(50)
  })

  it('handles an inverted range, as SVG y-axes need', () => {
    const scale = linearScale([0, 10], [180, 0])
    expect(scale(0)).toBe(180)
    expect(scale(10)).toBe(0)
    expect(scale.invert(90)).toBeCloseTo(5)
  })

  it('does not divide by zero on a degenerate domain', () => {
    const scale = linearScale([5, 5], [0, 100])
    expect(Number.isFinite(scale(5))).toBe(true)
    expect(Number.isFinite(scale.invert(50))).toBe(true)
  })
})

describe('niceTicks', () => {
  it('produces round values covering the domain', () => {
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100])
    expect(niceTicks(0, 1, 4)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
  })

  it('does not accumulate floating point dust', () => {
    for (const tick of niceTicks(0, 3, 5)) {
      expect(tick.toString().length).toBeLessThan(8)
    }
  })

  it('degenerates gracefully', () => {
    expect(niceTicks(7, 7)).toEqual([7])
    expect(niceTicks(Number.NaN, 1)).toEqual([])
  })
})

describe('niceDomain', () => {
  it('rounds outward so the top mark is not clipped', () => {
    expect(niceDomain(3, 97, 5)).toEqual([0, 100])
    expect(niceDomain(0, 0)).toEqual([0, 1])
  })
})

describe('nearestIndex', () => {
  const points = [{ t: 0 }, { t: 10 }, { t: 20 }, { t: 30 }]

  it('finds the closest sample', () => {
    expect(nearestIndex(points, 0)).toBe(0)
    expect(nearestIndex(points, 14)).toBe(1)
    expect(nearestIndex(points, 16)).toBe(2)
    expect(nearestIndex(points, 999)).toBe(3)
    expect(nearestIndex(points, -999)).toBe(0)
  })

  it('reports -1 for an empty series', () => {
    expect(nearestIndex([], 5)).toBe(-1)
  })
})

describe('clamp', () => {
  it('bounds a value', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
  })
})
