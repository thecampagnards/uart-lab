export function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Gate index → the metre range it covers, e.g. "2.1–2.8 m". */
export function gateRangeLabel(gate: number, gateSizeM: number): string {
  return `${(gate * gateSizeM).toFixed(1)}–${((gate + 1) * gateSizeM).toFixed(1)} m`
}
