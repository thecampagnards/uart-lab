/** Shared visx styling, so the three charts read as one system. */
export const SERIES = {
  energy: 'var(--series-1)',
  move: 'var(--series-2)',
  still: 'var(--series-3)',
} as const

export const CHROME = {
  grid: 'var(--chart-grid)',
  axis: 'var(--chart-axis)',
  muted: 'var(--chart-muted)',
  absence: 'var(--chart-absence)',
} as const

/** Sequential ramp for magnitude, light → dark, one hue. */
export const SEQUENTIAL = [
  'var(--seq-0)',
  'var(--seq-1)',
  'var(--seq-2)',
  'var(--seq-3)',
  'var(--seq-4)',
  'var(--seq-5)',
  'var(--seq-6)',
] as const

export const tickLabelProps = {
  fill: CHROME.muted,
  fontSize: 10,
  fontFamily: 'inherit',
  style: { fontVariantNumeric: 'tabular-nums' as const },
}

export const axisLabelProps = {
  fill: CHROME.muted,
  fontSize: 10,
  fontFamily: 'inherit',
}

export const tooltipStyles = {
  background: 'var(--mantine-color-body)',
  color: 'var(--mantine-color-text)',
  border: '1px solid var(--mantine-color-default-border)',
  borderRadius: 'var(--mantine-radius-md)',
  boxShadow: 'var(--mantine-shadow-md)',
  padding: '8px 10px',
  fontSize: 12,
  lineHeight: 1.5,
  pointerEvents: 'none' as const,
}
