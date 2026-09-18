/**
 * Energy heatmap: time on x, gate on y, magnitude on a single-hue sequential
 * ramp.
 *
 * Samples are bucketed into fixed time columns rather than drawn one rect per
 * frame: it caps the node count whatever the sample rate, and a column that
 * means "one second" reads better than one that means "whatever arrived".
 */
import { memo, useMemo } from 'react'
import { Group } from '@visx/group'
import { HeatmapRect } from '@visx/heatmap'
import { scaleLinear } from '@visx/scale'
import { ParentSize } from '@visx/responsive'
import { TooltipWithBounds, useTooltip } from '@visx/tooltip'
import { Group as MantineGroup, Text } from '@mantine/core'
import { GATE_SIZE_M, TOTAL_GATES } from '../../devices/ld2420/constants'
import { linearToDb } from '../../devices/ld2420/frames'
import type { Measurement } from '../../devices/ld2420/driver'
import { SEQUENTIAL, tooltipStyles } from './chartTheme'
import { formatNumber, gateRangeLabel } from './format'
import { TooltipRows } from './ChartChrome'
import { COLUMNS, MAX_DB, bucketSamples, type Cell, type Column } from './bucketSamples'

/** Width used for the very first paint, before the container is measured. */
const INITIAL_WIDTH = 640

// 16 gate rows: below ~290px the rows fall under 18px and the gate labels
// start colliding with their own cells.
const HEIGHT = 304
const MARGIN = { top: 4, right: 4, bottom: 4, left: 24 }

export interface EnergyWaterfallProps {
  samples: readonly Measurement[]
  minGate: number
  maxGate: number
  windowMs: number
}

export const EnergyWaterfall = memo(function EnergyWaterfall(props: EnergyWaterfallProps) {
  return (
    <div>
      <ParentSize debounceTime={80} initialSize={{ width: INITIAL_WIDTH, height: HEIGHT }}>
        {({ width }) => (width > 0 ? <Plot {...props} width={width} /> : null)}
      </ParentSize>
      <MantineGroup gap="xs" mt={8} pl={24} wrap="nowrap">
        <Text size="xs" c="dimmed">
          0 dB
        </Text>
        <span
          aria-hidden="true"
          style={{
            height: 8,
            flex: '0 1 180px',
            borderRadius: 2,
            background: `linear-gradient(to right, ${SEQUENTIAL.join(', ')})`,
          }}
        />
        <Text size="xs" c="dimmed">
          {MAX_DB} dB
        </Text>
        <Text size="xs" c="dimmed" ml="auto">
          ← older · newer →
        </Text>
      </MantineGroup>
    </div>
  )
})

function Plot({
  samples,
  minGate,
  maxGate,
  windowMs,
  width,
}: EnergyWaterfallProps & { width: number }) {
  const { tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip, tooltipOpen } =
    useTooltip<Cell & { gate: number }>()

  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right)
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom

  const columns = useMemo(() => bucketSamples(samples, windowMs, COLUMNS), [samples, windowMs])

  const colour = useMemo(
    () =>
      scaleLinear<string>({
        domain: SEQUENTIAL.map((_, index) => (index / (SEQUENTIAL.length - 1)) * MAX_DB),
        range: [...SEQUENTIAL],
      }),
    [],
  )

  const binWidth = innerWidth / COLUMNS
  const binHeight = innerHeight / TOTAL_GATES

  return (
    <div style={{ position: 'relative' }}>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label="Per-gate energy history: time runs left to right, gates top to bottom, and blue intensity gives the energy. The values are in the table below the chart."
      >
        <Group left={MARGIN.left} top={MARGIN.top}>
          {Array.from({ length: TOTAL_GATES }, (_, gate) => (
            <text
              key={gate}
              x={-6}
              y={gate * binHeight + binHeight / 2}
              dy="0.32em"
              textAnchor="end"
              fontSize={10}
              fill="var(--chart-muted)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {gate}
            </text>
          ))}

          <HeatmapRect<Column, Cell>
            data={columns}
            xScale={(value) => value * binWidth}
            yScale={(value) => value * binHeight}
            colorScale={colour}
            binWidth={binWidth}
            binHeight={binHeight}
            gap={0}
          >
            {(heatmap) =>
              heatmap.map((row) =>
                row.map((bin) => {
                  const cell: Cell = bin.bin
                  const gate = bin.row
                  const inRange = gate >= minGate && gate <= maxGate
                  return (
                    <rect
                      key={`${bin.row}-${bin.column}`}
                      x={bin.x}
                      y={bin.y}
                      width={bin.width}
                      height={bin.height}
                      fill={bin.color}
                      // Gates outside the active range are dimmed, not hidden.
                      opacity={cell.raw < 0 ? 0 : inRange ? 1 : 0.35}
                      onMouseEnter={() =>
                        cell.raw >= 0 &&
                        showTooltip({
                          tooltipData: { ...cell, gate },
                          tooltipLeft: MARGIN.left + bin.x + bin.width / 2,
                          tooltipTop: MARGIN.top + bin.y,
                        })
                      }
                      onMouseLeave={hideTooltip}
                    />
                  )
                }),
              )
            }
          </HeatmapRect>
        </Group>
      </svg>

      {tooltipOpen && tooltipData ? (
        <TooltipWithBounds top={tooltipTop ?? 0} left={tooltipLeft ?? 0} style={tooltipStyles}>
          <TooltipRows
            title={`Gate ${tooltipData.gate} · ${gateRangeLabel(tooltipData.gate, GATE_SIZE_M)}`}
            rows={[
              {
                label: 'Energy',
                value: `${formatNumber(tooltipData.raw)} (${linearToDb(tooltipData.raw).toFixed(1)} dB)`,
              },
              { label: 'Distance', value: `${(tooltipData.distanceCm / 100).toFixed(2)} m` },
              { label: 'Presence', value: tooltipData.presence ? 'yes' : 'no' },
              { label: 'Age', value: `${tooltipData.ageS.toFixed(0)} s` },
            ]}
          />
        </TooltipWithBounds>
      ) : null}
    </div>
  )
}
