/**
 * Fixed-capacity ring buffer for the live measurement stream.
 *
 * Kept outside React state on purpose: report mode delivers ~10-20 samples a
 * second and re-rendering the tree on every one of them is wasted work. The UI
 * reads a snapshot on a throttled frame instead.
 */
import type { Measurement } from '../devices/ld2420/driver'

export interface HistorySnapshot {
  latest: Measurement | null
  /** Oldest to newest. */
  samples: Measurement[]
  /** Frames per second over the last second, for the link-health tile. */
  rateHz: number
  totalSamples: number
}

export class MeasurementHistory {
  private buffer: Measurement[] = []
  private total = 0

  constructor(readonly capacity = 3000) {}

  push(measurement: Measurement): void {
    this.buffer.push(measurement)
    this.total++
    if (this.buffer.length > this.capacity) {
      this.buffer.splice(0, this.buffer.length - this.capacity)
    }
  }

  clear(): void {
    this.buffer = []
    this.total = 0
  }

  get size(): number {
    return this.buffer.length
  }

  latest(): Measurement | null {
    return this.buffer.at(-1) ?? null
  }

  /** Samples from the last `ms` milliseconds, oldest first. */
  window(ms: number): Measurement[] {
    const latest = this.latest()
    if (!latest) return []
    const cutoff = latest.t - ms
    let start = this.buffer.length
    while (start > 0 && this.buffer[start - 1]!.t >= cutoff) start--
    return this.buffer.slice(start)
  }

  snapshot(windowMs = 60_000): HistorySnapshot {
    const samples = this.window(windowMs)
    const latest = this.latest()
    let rateHz = 0
    if (latest) {
      const recent = this.window(1000)
      const first = recent[0]
      const spanS = first ? (latest.t - first.t) / 1000 : 0
      // Rate over the interval the samples actually span, so a 1 s window that
      // happens to hold 11 samples still reads as 10 Hz rather than 11.
      if (recent.length > 1 && spanS > 0) rateHz = (recent.length - 1) / spanS
    }
    return { latest, samples, rateHz, totalSamples: this.total }
  }
}

/**
 * Reduce a series to at most `maxPoints` by keeping the extremes of each bucket,
 * so a spike that lasts one sample still shows up in the drawn line.
 */
export function downsampleMinMax(
  samples: readonly Measurement[],
  maxPoints: number,
): { t: number; value: number }[] {
  const points = samples.map((s) => ({ t: s.t, value: s.distanceCm }))
  if (points.length <= maxPoints) return points
  const bucketSize = Math.ceil(points.length / (maxPoints / 2))
  const out: { t: number; value: number }[] = []
  for (let i = 0; i < points.length; i += bucketSize) {
    const bucket = points.slice(i, i + bucketSize)
    let min = bucket[0]!
    let max = bucket[0]!
    for (const point of bucket) {
      if (point.value < min.value) min = point
      if (point.value > max.value) max = point
    }
    const [first, second] = min.t <= max.t ? [min, max] : [max, min]
    out.push(first)
    if (second !== first) out.push(second)
  }
  return out
}
