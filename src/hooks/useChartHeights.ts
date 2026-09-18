import { useViewportSize } from '@mantine/hooks'
import { clamp } from '../ui/charts/format'

export interface ChartHeights {
  /** Full-width bar chart above the fold. */
  gates: number
  /** The two side-by-side charts below it. */
  panel: number
}

/**
 * Scale the charts with the window rather than pinning them to fixed pixels.
 *
 * At a fixed height the two lower charts sit at roughly half width in the
 * two-column grid, which reads as a squat strip on a tall screen and leaves the
 * bottom of the viewport empty. Deriving the height from the viewport keeps the
 * aspect reasonable from a laptop to a 1440p display, and the clamps stop it
 * collapsing in a short window or ballooning on a very tall one.
 */
export function useChartHeights(): ChartHeights {
  const { height } = useViewportSize()
  // Before the first measurement `height` is 0; fall back to the previous fixed
  // values rather than rendering a collapsed chart.
  const viewport = height > 0 ? height : 900
  return {
    gates: clamp(Math.round(viewport * 0.3), 240, 440),
    panel: clamp(Math.round(viewport * 0.44), 300, 620),
  }
}
