import { useCallback, useRef, useSyncExternalStore } from 'react'
import type { HistorySnapshot, MeasurementHistory } from '../core/history'

const EMPTY: HistorySnapshot = { latest: null, samples: [], rateHz: 0, totalSamples: 0 }

/**
 * Sample the measurement ring buffer on a frame timer.
 *
 * The buffer is mutated outside React at the rate the module streams (10-20 Hz
 * in report mode, higher at 460800 baud). Re-rendering per frame received would
 * be wasted work, so the UI pulls a snapshot at `fps` instead of being pushed
 * to.
 *
 * `useSyncExternalStore` is the primitive for exactly this: a mutable store
 * React does not own. The frame timer lives in `subscribe`, which computes the
 * snapshot and caches it, so `getSnapshot` stays pure and returns a stable
 * reference between ticks.
 */
export function useLiveSnapshot(
  history: MeasurementHistory,
  windowMs: number,
  active: boolean,
  fps = 10,
): HistorySnapshot {
  const cache = useRef<HistorySnapshot>(EMPTY)

  const subscribe = useCallback(
    (onChange: () => void) => {
      // One immediate read, so a paused or closed link still shows its last state.
      cache.current = history.snapshot(windowMs)
      onChange()
      if (!active) return () => undefined

      let frame = 0
      let last = 0
      const interval = 1000 / fps
      const loop = (now: number): void => {
        if (now - last >= interval) {
          last = now
          cache.current = history.snapshot(windowMs)
          onChange()
        }
        frame = requestAnimationFrame(loop)
      }
      frame = requestAnimationFrame(loop)
      return () => cancelAnimationFrame(frame)
    },
    [active, fps, history, windowMs],
  )

  const getSnapshot = useCallback(() => cache.current, [])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
