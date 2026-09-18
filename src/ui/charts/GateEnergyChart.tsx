/**
 * Energy per detection gate, against the two configured thresholds.
 *
 * The y-axis is in dB (10·log10 of the raw value) because the raw scale spans
 * three orders of magnitude between the near-field clutter and the far gates —
 * on a linear axis every gate past the third is a flat line at zero. dB is also
 * what the vendor tool displays, so the numbers here match its screenshots.
 */
import { useId, useState } from 'react'
import { GATE_SIZE_M, TOTAL_GATES } from '../../devices/ld2420/constants'
import { linearToDb } from '../../devices/ld2420/frames'
import { clamp, formatNumber, linearScale, niceTicks } from './scales'
import { Legend, Tooltip } from './Tooltip'

const WIDTH = 720
const HEIGHT = 260
const MARGIN = { top: 12, right: 14, bottom: 34, left: 40 }
const MAX_DB = 50

export interface GateEnergyChartProps {
  energy: readonly number[]
  moveThresholds: readonly number[]
  stillThresholds: readonly number[]
  minGate: number
  maxGate: number
}

export function GateEnergyChart({
  energy,
  moveThresholds,
  stillThresholds,
  minGate,
  maxGate,
}: GateEnergyChartProps) {
  const [hover, setHover] = useState<number | null>(null)
  const clipId = useId()

  const plotWidth = WIDTH - MARGIN.left - MARGIN.right
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom
  const x = linearScale([0, TOTAL_GATES], [0, plotWidth])
  const y = linearScale([0, MAX_DB], [plotHeight, 0])
  const bandWidth = plotWidth / TOTAL_GATES
  // A 2px surface gap between neighbouring bars, per the mark spec.
  const barWidth = Math.max(4, bandWidth - 8)

  const hovered = hover !== null ? hover : null
  const hoveredEnergy = hovered !== null ? (energy[hovered] ?? 0) : 0

  return (
    <div className="chart">
      <Legend
        items={[
          { label: 'Measured energy', color: 'var(--series-1)' },
          { label: 'Motion threshold', color: 'var(--series-2)', line: true },
          { label: 'Still threshold', color: 'var(--series-3)', line: true },
        ]}
      />
      <div className="chart__plot">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label="Energy per distance gate, against the configured thresholds. The numeric values are in the table below the chart."
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={0} y={-4} width={plotWidth} height={plotHeight + 4} />
            </clipPath>
          </defs>
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {niceTicks(0, MAX_DB, 5).map((tick) => (
              <g key={tick}>
                <line className="chart__grid" x1={0} x2={plotWidth} y1={y(tick)} y2={y(tick)} />
                <text className="chart__tick" x={-8} y={y(tick)} dy="0.32em" textAnchor="end">
                  {tick}
                </text>
              </g>
            ))}
            <text
              className="chart__axis-label"
              transform={`translate(${-MARGIN.left + 2},${plotHeight / 2}) rotate(-90)`}
              textAnchor="middle"
            >
              dB
            </text>

            <g clipPath={`url(#${clipId})`}>
              {Array.from({ length: TOTAL_GATES }, (_, gate) => {
                const inRange = gate >= minGate && gate <= maxGate
                const db = clamp(linearToDb(energy[gate] ?? 0), 0, MAX_DB)
                const barX = x(gate) + (bandWidth - barWidth) / 2
                const barY = y(db)
                const height = Math.max(0, plotHeight - barY)
                return (
                  <g key={gate}>
                    {/* Hit area spans the whole band so the target is ~40px wide. */}
                    <rect
                      x={x(gate)}
                      y={0}
                      width={bandWidth}
                      height={plotHeight}
                      fill="transparent"
                      onMouseEnter={() => setHover(gate)}
                      onFocus={() => setHover(gate)}
                      onBlur={() => setHover(null)}
                      tabIndex={0}
                      role="button"
                      aria-label={`Gate ${gate}, ${formatNumber(energy[gate] ?? 0)}`}
                    />
                    <rect
                      x={barX}
                      y={barY}
                      width={barWidth}
                      height={height}
                      rx={Math.min(4, barWidth / 2)}
                      fill="var(--series-1)"
                      opacity={inRange ? 1 : 0.28}
                    />
                    {/* Thresholds as ticks rather than bars: they bound the bar, they are not a second magnitude. */}
                    <ThresholdTick
                      value={moveThresholds[gate]}
                      color="var(--series-2)"
                      x={barX - 3}
                      width={barWidth + 6}
                      y={y}
                    />
                    <ThresholdTick
                      value={stillThresholds[gate]}
                      color="var(--series-3)"
                      x={barX - 3}
                      width={barWidth + 6}
                      y={y}
                    />
                  </g>
                )
              })}
            </g>

            <line
              className="chart__baseline"
              x1={0}
              x2={plotWidth}
              y1={plotHeight}
              y2={plotHeight}
            />
            {Array.from({ length: TOTAL_GATES }, (_, gate) => (
              <text
                key={gate}
                className="chart__tick"
                x={x(gate) + bandWidth / 2}
                y={plotHeight + 14}
                textAnchor="middle"
              >
                {gate}
              </text>
            ))}
            <text
              className="chart__axis-label"
              x={plotWidth / 2}
              y={plotHeight + 30}
              textAnchor="middle"
            >
              Gate (≈ {GATE_SIZE_M.toLocaleString('en-US')} m per gate)
            </text>
          </g>
        </svg>

        {hovered !== null ? (
          <Tooltip
            left={`${clamp(((MARGIN.left + x(hovered) + bandWidth / 2) / WIDTH) * 100, 12, 88)}%`}
            top={`${((MARGIN.top + y(clamp(linearToDb(hoveredEnergy), 0, MAX_DB))) / HEIGHT) * 100}%`}
            title={`Gate ${hovered} · ${(hovered * GATE_SIZE_M).toFixed(1)}–${((hovered + 1) * GATE_SIZE_M).toFixed(1)} m`}
            rows={[
              {
                label: 'Energy',
                value: `${formatNumber(hoveredEnergy)} (${linearToDb(hoveredEnergy).toFixed(1)} dB)`,
                color: 'var(--series-1)',
              },
              {
                label: 'Motion threshold',
                value: formatNumber(moveThresholds[hovered] ?? 0),
                color: 'var(--series-2)',
              },
              {
                label: 'Still threshold',
                value: formatNumber(stillThresholds[hovered] ?? 0),
                color: 'var(--series-3)',
              },
            ]}
            footer={
              hovered < minGate || hovered > maxGate ? 'Outside the active gate range' : undefined
            }
          />
        ) : null}
      </div>
    </div>
  )
}

function ThresholdTick({
  value,
  color,
  x,
  width,
  y,
}: {
  value: number | undefined
  color: string
  x: number
  width: number
  y: (value: number) => number
}) {
  if (value === undefined) return null
  const db = clamp(linearToDb(value), 0, MAX_DB)
  return <line x1={x} x2={x + width} y1={y(db)} y2={y(db)} stroke={color} strokeWidth={2} />
}
