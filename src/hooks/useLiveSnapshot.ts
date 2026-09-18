import { useEffect, useState } from 'react'
import type { HistorySnapshot, MeasurementHistory } from '../core/history'

const EMPTY: HistorySnapshot = { latest: null, samples: [], rateHz: 0, totalSamples: 0 }

/**
 * Sample the measurement ring buffer on a frame timer.
 *
 * The buffer is mutated outside React at the rate the module streams (10-20 Hz
 * in report mode, higher at 460800 baud). Re-rendering per frame received would
 * be wasted work, so the UI pulls a snapshot at `fps` instead of being pushed to.
 */
export function useLiveSnapshot(
  history: MeasurementHistory,
  windowMs: number,
  active: boolean,
  fps = 10,
): HistorySnapshot {
  const [snapshot, setSnapshot] = useState<HistorySnapshot>(EMPTY)

  useEffect(() => {
    // One immediate read so a paused stream still shows its last state.
    setSnapshot(history.snapshot(windowMs))
    if (!active) return

    let frame = 0
    let last = 0
    const interval = 1000 / fps
    const loop = (now: number): void => {
      if (now - last >= interval) {
        last = now
        setSnapshot(history.snapshot(windowMs))
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [active, fps, history, windowMs])

  return snapshot
}
