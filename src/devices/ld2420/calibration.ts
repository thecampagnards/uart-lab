/**
 * Working out presence thresholds from what the room actually looks like.
 *
 * A threshold has to sit above the room's own clutter and below the energy a
 * person puts into that gate. Picking it by hand means guessing at both. So the
 * assistant measures them: one recording with the area empty, one with someone
 * moving in it, and the thresholds go between.
 *
 * The multipliers reproduce ESPHome's `auto_calibrate_sensitivity` at its
 * default sensitivity (peak × 2.5 for motion, × 2.25 for still), so numbers
 * worked out there carry over. What is added here is the second recording,
 * which is what tells you whether the threshold you just proposed can actually
 * be crossed.
 */
import { TOTAL_GATES } from './constants'
import { cloneConfig, type Ld2420Config } from './config'

export interface GateStats {
  /** Highest value seen per gate. */
  peak: number[]
  /** Mean per gate, which reads the steady level rather than the excursions. */
  mean: number[]
  samples: number
}

export function emptyStats(): GateStats {
  return {
    peak: new Array<number>(TOTAL_GATES).fill(0),
    mean: new Array<number>(TOTAL_GATES).fill(0),
    samples: 0,
  }
}

/** Reduce a run of report frames to per-gate peak and mean. */
export function summarise(frames: readonly (readonly number[])[]): GateStats {
  const usable = frames.filter((frame) => frame.length === TOTAL_GATES)
  const stats = emptyStats()
  if (usable.length === 0) return stats
  const totals = new Array<number>(TOTAL_GATES).fill(0)
  for (const frame of usable) {
    for (let gate = 0; gate < TOTAL_GATES; gate++) {
      const value = frame[gate] ?? 0
      totals[gate] = (totals[gate] ?? 0) + value
      if (value > (stats.peak[gate] ?? 0)) stats.peak[gate] = value
    }
  }
  stats.samples = usable.length
  stats.mean = totals.map((total) => Math.round(total / usable.length))
  return stats
}

export interface GateProposal {
  gate: number
  baselinePeak: number
  presencePeak: number | null
  move: number
  still: number
  /** Whether the presence recording ever crossed the proposed motion threshold. */
  canFire: boolean | null
}

export interface CalibrationProposal {
  config: Ld2420Config
  gates: GateProposal[]
  warnings: string[]
  /** False when there is nothing to apply. */
  usable: boolean
}

export const MAX_THRESHOLD = 65535

/**
 * Sensitivity runs 0 (least sensitive) to 1 (most). 0.5 gives ESPHome's
 * defaults; higher pulls the thresholds down towards the room's clutter.
 */
export function multipliers(sensitivity: number): { move: number; still: number } {
  const clamped = Math.min(1, Math.max(0, sensitivity))
  const move = 1.5 + (1 - clamped) * 2
  return { move, still: move - 0.25 }
}

export interface CalibrationInput {
  baseline: GateStats
  /** Optional: without it, thresholds are proposed but nothing verifies them. */
  presence: GateStats | null
  sensitivity: number
  /** Used for the fields the assistant does not touch, such as the delay. */
  current: Ld2420Config
}

export function proposeConfig({
  baseline,
  presence,
  sensitivity,
  current,
}: CalibrationInput): CalibrationProposal {
  const warnings: string[] = []
  if (baseline.samples === 0) {
    return {
      config: cloneConfig(current),
      gates: [],
      warnings: ['Record the empty area first — there is nothing to compare against.'],
      usable: false,
    }
  }
  if (baseline.samples < 20) {
    warnings.push(
      `The empty-area recording holds only ${baseline.samples} frames; a few seconds more makes the peaks meaningful.`,
    )
  }

  const factor = multipliers(sensitivity)
  const gates: GateProposal[] = []

  for (let gate = 0; gate < TOTAL_GATES; gate++) {
    const floor = baseline.peak[gate] ?? 0
    const move = Math.min(MAX_THRESHOLD, Math.round(floor * factor.move))
    const still = Math.min(move, Math.round(floor * factor.still))
    const presencePeak = presence && presence.samples > 0 ? (presence.peak[gate] ?? 0) : null
    gates.push({
      gate,
      baselinePeak: floor,
      presencePeak,
      move,
      still,
      canFire: presencePeak === null ? null : presencePeak > move,
    })
  }

  const config = cloneConfig(current)
  config.moveThresholds = gates.map((g) => g.move)
  config.stillThresholds = gates.map((g) => g.still)

  // The usable range is where a person was actually seen to clear the bar.
  const firing = gates.filter((g) => g.canFire === true).map((g) => g.gate)
  if (presence && presence.samples > 0) {
    if (firing.length === 0) {
      warnings.push(
        'No gate was crossed during the presence recording. Either the thresholds are too high for ' +
          'this room — raise the sensitivity — or the recording caught nobody.',
      )
    } else {
      config.minGate = firing[0]!
      config.maxGate = firing.at(-1)!
      const dead = gates
        .filter((g) => g.gate > config.minGate && g.gate < config.maxGate && g.canFire === false)
        .map((g) => g.gate)
      if (dead.length > 0) {
        warnings.push(
          `Gates ${dead.join(', ')} sit inside the proposed range but were never crossed. They will ` +
            'not contribute; that is usually furniture in the way, or simply nobody standing there.',
        )
      }
    }
  } else {
    warnings.push(
      'Without a presence recording nothing checks that these thresholds can be crossed. ' +
        'The gate range has been left as it was.',
    )
  }

  const saturated = gates.filter((g) => g.move >= MAX_THRESHOLD).map((g) => g.gate)
  if (saturated.length > 0) {
    warnings.push(
      `Gates ${saturated.join(', ')} hit the 65535 ceiling, so nothing can trigger them. That ` +
        'much clutter usually means something very reflective, or the sensor facing a wall.',
    )
  }

  return { config, gates, warnings, usable: true }
}
