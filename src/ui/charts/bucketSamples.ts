/** Time bucketing for the energy heatmap. Pure, so the off-by-ones are testable. */
import { TOTAL_GATES } from '../../devices/ld2420/constants'
import { linearToDb } from '../../devices/ld2420/frames'
import type { Measurement } from '../../devices/ld2420/driver'
import { clamp } from './format'

/** Number of time columns drawn, whatever the sample rate. */
export const COLUMNS = 60

/** Top of the colour scale, in dB. */
export const MAX_DB = 50

export interface Cell {
  bin: number
  /** dB, which is what the colour scale consumes. */
  count: number
  /** Raw energy, kept for the tooltip. -1 means nothing was recorded here. */
  raw: number
  presence: boolean
  distanceCm: number
  ageS: number
}

export interface Column {
  bin: number
  bins: Cell[]
}

/**
 * Bucket samples into `columns` equal time slices of the window, keeping the
 * peak energy per gate. Peak rather than mean: a brief crossing of a gate is
 * the event worth seeing, and averaging erases it.
 */
export function bucketSamples(
  samples: readonly Measurement[],
  windowMs: number,
  columns: number,
): Column[] {
  const latest = samples.at(-1)?.t ?? 0
  const start = latest - windowMs
  const slice = windowMs / columns

  const out: Column[] = Array.from({ length: columns }, (_, column) => ({
    bin: column,
    bins: Array.from({ length: TOTAL_GATES }, (_, gate) => ({
      bin: gate,
      count: 0,
      raw: -1, // sentinel: nothing recorded for this cell
      presence: false,
      distanceCm: 0,
      ageS: (columns - column) * (slice / 1000),
    })),
  }))

  for (const sample of samples) {
    if (sample.energy.length !== TOTAL_GATES) continue
    // Older than the window: drop it rather than clamp, which would paint stale
    // data at the left edge.
    if (sample.t < start) continue
    const column = clamp(Math.floor((sample.t - start) / slice), 0, columns - 1)
    const target = out[column]
    if (!target) continue
    for (let gate = 0; gate < TOTAL_GATES; gate++) {
      const cell = target.bins[gate]!
      const raw = sample.energy[gate] ?? 0
      if (raw > cell.raw) {
        cell.raw = raw
        cell.count = clamp(linearToDb(raw), 0, MAX_DB)
      }
    }
    // The latest sample in the bucket carries its presence and distance.
    for (const cell of target.bins) {
      cell.presence = sample.presence
      cell.distanceCm = sample.distanceCm
      cell.ageS = (latest - sample.t) / 1000
    }
  }

  return out
}
