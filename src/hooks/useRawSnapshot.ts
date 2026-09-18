import { useCallback, useRef, useSyncExternalStore } from 'react'
import {
  renderRawLines,
  throughput,
  type RawLine,
  type RawSerialLog,
  type RawViewMode,
} from '../core/rawLog'

/** How much of the tail is formatted for display, in bytes. */
const RENDER_WINDOW = 16 * 1024

export interface RawSnapshot {
  lines: RawLine[]
  /** Bytes per second over the recent window. */
  rate: number
  totals: { received: number; sent: number }
}

const EMPTY: RawSnapshot = { lines: [], rate: 0, totals: { received: 0, sent: 0 } }

function read(log: RawSerialLog, mode: RawViewMode): RawSnapshot {
  const tail = log.tail(RENDER_WINDOW)
  return { lines: renderRawLines(tail, mode), rate: throughput(tail), totals: log.totals }
}

/**
 * Sample the raw log on a frame timer.
 *
 * The log is a mutable buffer outside React — its chunk array is appended to in
 * place, so it has no identity to depend on and a `useMemo` over it would never
 * recompute. `useSyncExternalStore` is the primitive for a store React does not
 * own: the timer lives in `subscribe` and caches each rendering, leaving
 * `getSnapshot` pure.
 */
export function useRawSnapshot(
  log: RawSerialLog,
  mode: RawViewMode,
  active: boolean,
  fps = 8,
): RawSnapshot {
  const cache = useRef<RawSnapshot>(EMPTY)

  const subscribe = useCallback(
    (onChange: () => void) => {
      cache.current = read(log, mode)
      onChange()
      if (!active) return () => undefined

      let frame = 0
      let last = 0
      const interval = 1000 / fps
      const loop = (now: number): void => {
        if (now - last >= interval) {
          last = now
          cache.current = read(log, mode)
          onChange()
        }
        frame = requestAnimationFrame(loop)
      }
      frame = requestAnimationFrame(loop)
      return () => cancelAnimationFrame(frame)
    },
    [active, fps, log, mode],
  )

  const getSnapshot = useCallback(() => cache.current, [])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
