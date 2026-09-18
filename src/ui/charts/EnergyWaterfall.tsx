/**
 * Energy heatmap: time on x, gate on y, magnitude as a single-hue sequential
 * ramp. Canvas rather than SVG — at 16 gates × a few hundred columns the DOM
 * node count would dominate the frame budget.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { GATE_SIZE_M, TOTAL_GATES } from '../../devices/ld2420/constants'
import { linearToDb } from '../../devices/ld2420/frames'
import type { Measurement } from '../../devices/ld2420/driver'
import { clamp, formatNumber } from './scales'
import { Tooltip } from './Tooltip'

const COLUMNS = 240
const MAX_DB = 50

/** Blue ramp, step 100 → 700, sampled for the canvas. */
const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'].map(
  hexToRgb,
)

export interface EnergyWaterfallProps {
  samples: readonly Measurement[]
  minGate: number
  maxGate: number
}

interface HoverState {
  column: number
  gate: number
  xPct: number
  yPct: number
}

export function EnergyWaterfall({ samples, minGate, maxGate }: EnergyWaterfallProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)

  /** Newest `COLUMNS` samples that actually carry per-gate energy. */
  const columns = useMemo(() => {
    const withEnergy = samples.filter((s) => s.energy.length === TOTAL_GATES)
    return withEnergy.slice(-COLUMNS)
  }, [samples])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    canvas.width = COLUMNS
    canvas.height = TOTAL_GATES
    const image = context.createImageData(COLUMNS, TOTAL_GATES)
    const offset = COLUMNS - columns.length

    for (let column = 0; column < COLUMNS; column++) {
      const sample = column >= offset ? columns[column - offset] : undefined
      for (let gate = 0; gate < TOTAL_GATES; gate++) {
        const index = (gate * COLUMNS + column) * 4
        if (!sample) {
          image.data[index] = 0
          image.data[index + 1] = 0
          image.data[index + 2] = 0
          image.data[index + 3] = 0
          continue
        }
        const db = clamp(linearToDb(sample.energy[gate] ?? 0), 0, MAX_DB)
        const [r, g, b] = rampColor(db / MAX_DB)
        image.data[index] = r
        image.data[index + 1] = g
        image.data[index + 2] = b
        // Gates outside the active range are dimmed, not hidden.
        image.data[index + 3] = gate >= minGate && gate <= maxGate ? 255 : 90
      }
    }
    context.putImageData(image, 0, 0)
  }, [columns, maxGate, minGate])

  const handleMove = (event: React.MouseEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    const fx = (event.clientX - rect.left) / rect.width
    const fy = (event.clientY - rect.top) / rect.height
    const column = clamp(
      Math.floor(fx * COLUMNS) - (COLUMNS - columns.length),
      0,
      columns.length - 1,
    )
    const gate = clamp(Math.floor(fy * TOTAL_GATES), 0, TOTAL_GATES - 1)
    if (columns.length === 0) return
    setHover({ column, gate, xPct: fx * 100, yPct: fy * 100 })
  }

  const hoveredSample = hover ? columns[hover.column] : undefined

  return (
    <div className="chart">
      <div
        className="chart__plot"
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        style={{
          display: 'grid',
          gridTemplateColumns: '26px 1fr',
          gap: '6px',
          alignItems: 'stretch',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            display: 'grid',
            gridTemplateRows: `repeat(${TOTAL_GATES}, 1fr)`,
            fontSize: 9,
            color: 'var(--text-muted)',
            fontVariantNumeric: 'tabular-nums',
            textAlign: 'right',
          }}
        >
          {Array.from({ length: TOTAL_GATES }, (_, gate) => (
            <span key={gate} style={{ lineHeight: 1 }}>
              {gate}
            </span>
          ))}
        </div>
        <canvas
          ref={canvasRef}
          className="chart__canvas"
          style={{ height: 200, imageRendering: 'pixelated' }}
          role="img"
          aria-label="Per-gate energy history: time runs left to right, gates top to bottom, and blue intensity gives the energy. The values are in the table below the chart."
        />
        {hover && hoveredSample ? (
          <Tooltip
            left={`${clamp(hover.xPct, 16, 84)}%`}
            top={`${hover.yPct}%`}
            title={`Gate ${hover.gate} · ${(hover.gate * GATE_SIZE_M).toFixed(1)}–${((hover.gate + 1) * GATE_SIZE_M).toFixed(1)} m`}
            rows={[
              {
                label: 'Energy',
                value: `${formatNumber(hoveredSample.energy[hover.gate] ?? 0)} (${linearToDb(hoveredSample.energy[hover.gate] ?? 0).toFixed(1)} dB)`,
              },
              { label: 'Distance', value: `${(hoveredSample.distanceCm / 100).toFixed(2)} m` },
              { label: 'Presence', value: hoveredSample.presence ? 'yes' : 'no' },
            ]}
          />
        ) : null}
      </div>
      <div className="scale-legend" style={{ marginTop: 8, paddingLeft: 32 }}>
        <span>0 dB</span>
        <span className="scale-legend__ramp" aria-hidden="true" />
        <span>{MAX_DB} dB</span>
        <span style={{ marginLeft: 'auto' }}>← older · newer →</span>
      </div>
    </div>
  )
}

function rampColor(fraction: number): [number, number, number] {
  const position = clamp(fraction, 0, 1) * (RAMP.length - 1)
  const low = Math.floor(position)
  const high = Math.min(RAMP.length - 1, low + 1)
  const mix = position - low
  const a = RAMP[low]!
  const b = RAMP[high]!
  return [
    Math.round(a[0] + (b[0] - a[0]) * mix),
    Math.round(a[1] + (b[1] - a[1]) * mix),
    Math.round(a[2] + (b[2] - a[2]) * mix),
  ]
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}
