/** Axis maths shared by the charts. No DOM, so it is unit-tested directly. */

export interface LinearScale {
  (value: number): number
  invert(pixel: number): number
  domain: readonly [number, number]
  range: readonly [number, number]
}

export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): LinearScale {
  const [d0, d1] = domain
  const [r0, r1] = range
  const span = d1 - d0
  const scale = ((value: number) =>
    span === 0 ? (r0 + r1) / 2 : r0 + ((value - d0) / span) * (r1 - r0)) as LinearScale
  scale.invert = (pixel: number) => (r1 === r0 ? d0 : d0 + ((pixel - r0) / (r1 - r0)) * span)
  scale.domain = domain
  scale.range = range
  return scale
}

/** Round tick values ("1, 2, 5 × 10ⁿ") covering the domain. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  if (min === max) return [min]
  const step = tickStep(min, max, count)
  const start = Math.ceil(min / step) * step
  const ticks: number[] = []
  // Guard against a pathological step producing an unbounded loop.
  for (let value = start, i = 0; value <= max + step * 1e-9 && i < 1000; value += step, i++) {
    ticks.push(roundToStep(value, step))
  }
  return ticks
}

function tickStep(min: number, max: number, count: number): number {
  const rough = (max - min) / Math.max(1, count)
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const normalised = rough / magnitude
  // Geometric-mean thresholds, so the chosen step is the closest of 1/2/5/10
  // to the rough step rather than always rounding up.
  const factor =
    normalised >= Math.SQRT2 * 5
      ? 10
      : normalised >= Math.sqrt(10)
        ? 5
        : normalised >= Math.SQRT2
          ? 2
          : 1
  return factor * magnitude
}

/** Kill the float dust that `start + n * step` accumulates. */
function roundToStep(value: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1)
  return Number(value.toFixed(decimals))
}

/** Extend a domain to the next round tick so the topmost mark is not clipped. */
export function niceDomain(min: number, max: number, count = 5): [number, number] {
  if (min === max) return [min, min + 1]
  const step = tickStep(min, max, count)
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step]
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** Index of the point whose `t` is nearest `target`, or -1 for an empty list. */
export function nearestIndex(points: readonly { t: number }[], target: number): number {
  if (points.length === 0) return -1
  let low = 0
  let high = points.length - 1
  while (low < high) {
    const mid = (low + high) >> 1
    if (points[mid]!.t < target) low = mid + 1
    else high = mid
  }
  const candidate = low
  const previous = Math.max(0, low - 1)
  return Math.abs(points[previous]!.t - target) <= Math.abs(points[candidate]!.t - target)
    ? previous
    : candidate
}
