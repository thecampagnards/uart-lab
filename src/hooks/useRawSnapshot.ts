import { useEffect, useState } from 'react'
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

function read(log: RawSerialLog, mode: RawViewMode): RawSnapshot {
  const tail = log.tail(RENDER_WINDOW)
  return { lines: renderRawLines(tail, mode), rate: throughput(tail), totals: log.totals }
}

/**
 * Sample the raw log on a frame timer.
 *
 * The log is a mutable buffer outside React — its chunk array is appended to in
 * place, so it has no identity to depend on and a `useMemo` over it would never
 * recompute. Pulling on a frame budget is both correct and cheaper than a
 * render per chunk received.
 */
export function useRawSnapshot(
  log: RawSerialLog,
  mode: RawViewMode,
  active: boolean,
  fps = 8,
): RawSnapshot {
  const [snapshot, setSnapshot] = useState<RawSnapshot>(() => read(log, mode))

  useEffect(() => {
    // One immediate read, so a paused or closed link still shows its last state.
    setSnapshot(read(log, mode))
    if (!active) return

    let frame = 0
    let last = 0
    const interval = 1000 / fps
    const loop = (now: number): void => {
      if (now - last >= interval) {
        last = now
        setSnapshot(read(log, mode))
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [active, fps, log, mode])

  return snapshot
}
