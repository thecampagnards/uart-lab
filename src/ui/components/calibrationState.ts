import { emptyStats, type GateStats } from '../../devices/ld2420/calibration'

export type Stage = 'baseline' | 'presence'

/**
 * The presence assistant's state, held by the shell rather than by the panel.
 *
 * Tab panels are unmounted when you leave them, and forty seconds of
 * measurements should not evaporate because you went to look at the
 * configuration form. A recording in flight survives the same way: the
 * countdown resumes from its end time when the panel comes back.
 */
export interface CalibrationState {
  baseline: GateStats
  presence: GateStats | null
  sensitivity: number
  recording: { stage: Stage; endsAt: number } | null
}

export function initialCalibration(): CalibrationState {
  return { baseline: emptyStats(), presence: null, sensitivity: 0.5, recording: null }
}
