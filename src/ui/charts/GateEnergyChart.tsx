/**
 * Energy per detection gate, against the two configured thresholds.
 *
 * The y-axis is in dB (10·log10 of the raw value) because the raw scale spans
 * three orders of magnitude between the near-field clutter and the far gates —
 * on a linear axis every gate past the third is a flat line at zero. dB is also
 * what the vendor tool displays, so the numbers here match its screenshots.
 */
import { Group } from '@visx/group'
import { GridRows } from '@visx/grid'
import { AxisBottom, AxisLeft } from '@visx/axis'
import { Bar, Line } from '@visx/shape'
import { scaleBand, scaleLinear } from '@visx/scale'
import { ParentSize } from '@visx/responsive'
import { TooltipWithBounds, useTooltip } from '@visx/tooltip'
import { GATE_SIZE_M, TOTAL_GATES } from '../../devices/ld2420/constants'
import { linearToDb } from '../../devices/ld2420/frames'
import { CHROME, SERIES, axisLabelProps, tickLabelProps, tooltipStyles } from './chartTheme'
import { clamp, formatNumber, gateRangeLabel } from './format'
import { ChartLegend, TooltipRows } from './ChartChrome'

/** Width used for the very first paint, before the container is measured. */
const INITIAL_WIDTH = 640

const DEFAULT_HEIGHT = 260
const MARGIN = { top: 10, right: 12, bottom: 38, left: 42 }
const MAX_DB = 50

export interface GateEnergyChartProps {
  /** Plot height in pixels. The caller scales it with the viewport. */
  height?: number
  energy: readonly number[]
  moveThresholds: readonly number[]
  stillThresholds: readonly number[]
  minGate: number
  maxGate: number
}

interface HoverDatum {
  gate: number
  energy: number
  move: number
  still: number
  inRange: boolean
}

export function GateEnergyChart({ height = DEFAULT_HEIGHT, ...rest }: GateEnergyChartProps) {
  return (
    <div>
      <ChartLegend
        items={[
          { label: 'Measured energy', color: SERIES.energy },
          { label: 'Motion threshold', color: SERIES.move, line: true },
          { label: 'Still threshold', color: SERIES.still, line: true },
        ]}
      />
      {/*
        ParentSize's wrapper defaults to `height: 100%`, which is indefinite
        inside an auto-height Card — so it does not carry the SVG's height into
        the flow, and Card (which is overflow: hidden) clips the chart. Giving
        the wrapper the same explicit height as the SVG makes the card grow to
        fit it.
      */}
      <ParentSize
        debounceTime={80}
        initialSize={{ width: INITIAL_WIDTH, height }}
        style={{ height }}
      >
        {({ width }) => (width > 0 ? <Plot {...rest} height={height} width={width} /> : null)}
      </ParentSize>
    </div>
  )
}

function Plot({
  energy,
  moveThresholds,
  stillThresholds,
  minGate,
  maxGate,
  height: HEIGHT,
  width,
}: GateEnergyChartProps & { height: number; width: number }) {
  const { tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip, tooltipOpen } =
    useTooltip<HoverDatum>()

  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right)
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom

  const gates = Array.from({ length: TOTAL_GATES }, (_, gate) => gate)
  // `padding` is what produces the surface gap between neighbouring bars.
  const x = scaleBand<number>({ domain: gates, range: [0, innerWidth], padding: 0.22 })
  const y = scaleLinear<number>({ domain: [0, MAX_DB], range: [innerHeight, 0] })

  const bandWidth = x.bandwidth()

  return (
    <div style={{ position: 'relative' }}>
      <svg
        width={width}
        height={HEIGHT}
        style={{ display: 'block' }}
        role="img"
        aria-label="Energy per distance gate, against the configured thresholds. The numeric values are in the table below the chart."
      >
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={y} width={innerWidth} numTicks={5} stroke={CHROME.grid} />

          {gates.map((gate) => {
            const left = x(gate) ?? 0
            const inRange = gate >= minGate && gate <= maxGate
            const raw = energy[gate] ?? 0
            const db = clamp(linearToDb(raw), 0, MAX_DB)
            const move = moveThresholds[gate] ?? 0
            const still = stillThresholds[gate] ?? 0
            const datum: HoverDatum = { gate, energy: raw, move, still, inRange }

            return (
              <Group key={gate}>
                <Bar
                  x={left}
                  y={y(db)}
                  width={bandWidth}
                  height={Math.max(0, innerHeight - y(db))}
                  rx={Math.min(4, bandWidth / 2)}
                  fill={SERIES.energy}
                  opacity={inRange ? 1 : 0.28}
                />
                {/* Thresholds are ticks bounding the bar, not a second magnitude. */}
                <ThresholdTick value={move} color={SERIES.move} x={left} width={bandWidth} y={y} />
                <ThresholdTick
                  value={still}
                  color={SERIES.still}
                  x={left}
                  width={bandWidth}
                  y={y}
                />
                {/* Hit area spans the whole band, so the target is far wider than the bar. */}
                <Bar
                  x={left - (x.step() - bandWidth) / 2}
                  y={0}
                  width={x.step()}
                  height={innerHeight}
                  fill="transparent"
                  tabIndex={0}
                  role="button"
                  aria-label={`Gate ${gate}, energy ${formatNumber(raw)}`}
                  onMouseMove={() =>
                    showTooltip({
                      tooltipData: datum,
                      tooltipLeft: MARGIN.left + left + bandWidth / 2,
                      tooltipTop: MARGIN.top + y(db),
                    })
                  }
                  onFocus={() =>
                    showTooltip({
                      tooltipData: datum,
                      tooltipLeft: MARGIN.left + left + bandWidth / 2,
                      tooltipTop: MARGIN.top + y(db),
                    })
                  }
                  onMouseLeave={hideTooltip}
                  onBlur={hideTooltip}
                />
              </Group>
            )
          })}

          <AxisLeft
            scale={y}
            numTicks={5}
            hideAxisLine
            hideTicks
            label="dB"
            labelProps={axisLabelProps}
            labelOffset={22}
            tickLabelProps={() => ({ ...tickLabelProps, textAnchor: 'end', dx: -4, dy: 3 })}
          />
          <AxisBottom
            top={innerHeight}
            scale={x}
            stroke={CHROME.axis}
            hideTicks
            label={`Gate (≈ ${GATE_SIZE_M} m per gate)`}
            labelProps={{ ...axisLabelProps, textAnchor: 'middle' }}
            labelOffset={12}
            tickLabelProps={() => ({ ...tickLabelProps, textAnchor: 'middle', dy: 2 })}
          />
        </Group>
      </svg>

      {tooltipOpen && tooltipData ? (
        <TooltipWithBounds top={tooltipTop ?? 0} left={tooltipLeft ?? 0} style={tooltipStyles}>
          <TooltipRows
            title={`Gate ${tooltipData.gate} · ${gateRangeLabel(tooltipData.gate, GATE_SIZE_M)}`}
            rows={[
              {
                label: 'Energy',
                value: `${formatNumber(tooltipData.energy)} (${linearToDb(tooltipData.energy).toFixed(1)} dB)`,
                color: SERIES.energy,
              },
              {
                label: 'Motion threshold',
                value: formatNumber(tooltipData.move),
                color: SERIES.move,
              },
              {
                label: 'Still threshold',
                value: formatNumber(tooltipData.still),
                color: SERIES.still,
              },
            ]}
            footer={tooltipData.inRange ? undefined : 'Outside the active gate range'}
          />
        </TooltipWithBounds>
      ) : null}
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
  value: number
  color: string
  x: number
  width: number
  y: (value: number) => number
}) {
  const db = clamp(linearToDb(value), 0, MAX_DB)
  return (
    <Line
      from={{ x: x - 2, y: y(db) }}
      to={{ x: x + width + 2, y: y(db) }}
      stroke={color}
      strokeWidth={2}
    />
  )
}
