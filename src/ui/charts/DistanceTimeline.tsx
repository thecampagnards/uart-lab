/**
 * Detected distance over the recent window, with absence shown as a recessive
 * band rather than a second colour series — presence is state, not magnitude.
 */
import { useCallback, useMemo } from 'react'
import { Group } from '@visx/group'
import { GridRows } from '@visx/grid'
import { AxisLeft } from '@visx/axis'
import { AreaClosed, Bar, Line, LinePath } from '@visx/shape'
import { scaleLinear } from '@visx/scale'
import { ParentSize } from '@visx/responsive'
import { LinearGradient } from '@visx/gradient'
import { TooltipWithBounds, useTooltip } from '@visx/tooltip'
import { localPoint } from '@visx/event'
import { bisector, extent } from 'd3-array'
import { downsampleMinMax } from '../../core/history'
import type { Measurement } from '../../devices/ld2420/driver'
import { CHROME, SERIES, axisLabelProps, tickLabelProps, tooltipStyles } from './chartTheme'
import { clamp } from './format'
import { TooltipRows } from './ChartChrome'

/** Width used for the very first paint, before the container is measured. */
const INITIAL_WIDTH = 640

// Tall enough to read a metre of travel at half-width, where the card sits
// beside the energy history in the two-column grid.
const HEIGHT = 300
const MARGIN = { top: 10, right: 12, bottom: 26, left: 46 }
const MAX_POINTS = 360

interface Point {
  t: number
  /** Distance in metres; the wire carries centimetres. */
  value: number
}

const bisectByT = bisector<Point, number>((point) => point.t)
/** d3's bisector exposes `center` as a bound method; wrap it to keep `this` out of it. */
const bisectT = (points: Point[], t: number): number => bisectByT.center(points, t)

export interface DistanceTimelineProps {
  samples: readonly Measurement[]
  windowMs: number
}

export function DistanceTimeline(props: DistanceTimelineProps) {
  return (
    <ParentSize debounceTime={80} initialSize={{ width: INITIAL_WIDTH, height: HEIGHT }}>
      {({ width }) => (width > 0 ? <Plot {...props} width={width} /> : null)}
    </ParentSize>
  )
}

function Plot({ samples, windowMs, width }: DistanceTimelineProps & { width: number }) {
  const { tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip, tooltipOpen } =
    useTooltip<{ point: Point; presence: boolean; agoS: number }>()

  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right)
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom

  const { points, absences, latestT, x, y } = useMemo(() => {
    const latest = samples.at(-1)?.t ?? 0
    const reduced: Point[] = downsampleMinMax(samples, MAX_POINTS).map((p) => ({
      t: p.t,
      value: p.value / 100,
    }))
    const [, maxValue] = extent(reduced, (p) => p.value)
    const xScale = scaleLinear<number>({
      domain: [latest - windowMs, latest || 1],
      range: [0, innerWidth],
    })
    const yScale = scaleLinear<number>({
      domain: [0, Math.max(1, maxValue ?? 1)],
      range: [innerHeight, 0],
      nice: true,
    })

    // Contiguous runs where the module reported no presence.
    const bands: { from: number; to: number }[] = []
    let start: number | null = null
    for (const sample of samples) {
      if (!sample.presence && start === null) start = sample.t
      if (sample.presence && start !== null) {
        bands.push({ from: start, to: sample.t })
        start = null
      }
    }
    if (start !== null) bands.push({ from: start, to: latest })

    return { points: reduced, absences: bands, latestT: latest, x: xScale, y: yScale }
  }, [innerHeight, innerWidth, samples, windowMs])

  const handleMove = useCallback(
    (event: React.MouseEvent<SVGRectElement> | React.TouchEvent<SVGRectElement>) => {
      if (points.length === 0) return
      const local = localPoint(event)
      if (!local) return
      const t = x.invert(clamp(local.x - MARGIN.left, 0, innerWidth))
      const point = points[bisectT(points, t)]
      if (!point) return
      const sample = samples.find((s) => s.t >= point.t) ?? samples.at(-1)
      showTooltip({
        tooltipData: {
          point,
          presence: sample?.presence ?? false,
          agoS: (latestT - point.t) / 1000,
        },
        tooltipLeft: MARGIN.left + x(point.t),
        tooltipTop: MARGIN.top + y(point.value),
      })
    },
    [innerWidth, latestT, points, samples, showTooltip, x, y],
  )

  const last = points.at(-1)

  return (
    <div style={{ position: 'relative' }}>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label="Detected distance over the recent window. Stretches with no presence appear in grey."
      >
        <LinearGradient
          id="distance-fill"
          from={SERIES.energy}
          to={SERIES.energy}
          fromOpacity={0.18}
          toOpacity={0}
        />
        <Group left={MARGIN.left} top={MARGIN.top}>
          {absences.map((band) => {
            const from = clamp(x(band.from), 0, innerWidth)
            const to = clamp(x(band.to), 0, innerWidth)
            return (
              <Bar
                key={`${band.from}-${band.to}`}
                x={from}
                y={0}
                width={Math.max(0, to - from)}
                height={innerHeight}
                fill={CHROME.absence}
              />
            )
          })}

          <GridRows scale={y} width={innerWidth} numTicks={4} stroke={CHROME.grid} />

          {points.length > 0 ? (
            <>
              <AreaClosed<Point>
                data={points}
                x={(d) => x(d.t)}
                y={(d) => y(d.value)}
                yScale={y}
                fill="url(#distance-fill)"
              />
              <LinePath<Point>
                data={points}
                x={(d) => x(d.t)}
                y={(d) => y(d.value)}
                stroke={SERIES.energy}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </>
          ) : (
            <text
              x={innerWidth / 2}
              y={innerHeight / 2}
              textAnchor="middle"
              fill={CHROME.muted}
              fontSize={11}
            >
              Waiting for data…
            </text>
          )}

          {tooltipOpen && tooltipData ? (
            <Group>
              <Line
                from={{ x: x(tooltipData.point.t), y: 0 }}
                to={{ x: x(tooltipData.point.t), y: innerHeight }}
                stroke={CHROME.axis}
                strokeWidth={1}
              />
              <circle
                cx={x(tooltipData.point.t)}
                cy={y(tooltipData.point.value)}
                r={4}
                fill={SERIES.energy}
                stroke="var(--mantine-color-body)"
                strokeWidth={2}
              />
            </Group>
          ) : null}

          {/* Direct label on the endpoint only — never a number on every point. */}
          {last && !tooltipOpen ? (
            <text
              x={clamp(x(last.t) - 6, 24, innerWidth)}
              y={clamp(y(last.value) - 8, 10, innerHeight)}
              textAnchor="end"
              fontSize={10}
              fontWeight={600}
              fill="var(--mantine-color-dimmed)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {last.value.toFixed(2)} m
            </text>
          ) : null}

          <AxisLeft
            scale={y}
            numTicks={4}
            hideAxisLine
            hideTicks
            label="m"
            labelProps={axisLabelProps}
            labelOffset={24}
            tickLabelProps={() => ({ ...tickLabelProps, textAnchor: 'end', dx: -4, dy: 3 })}
          />
          <Line
            from={{ x: 0, y: innerHeight }}
            to={{ x: innerWidth, y: innerHeight }}
            stroke={CHROME.axis}
          />
          <text x={0} y={innerHeight + 15} fontSize={10} fill={CHROME.muted}>
            −{Math.round(windowMs / 1000)} s
          </text>
          <text
            x={innerWidth}
            y={innerHeight + 15}
            fontSize={10}
            textAnchor="end"
            fill={CHROME.muted}
          >
            now
          </text>

          <Bar
            x={0}
            y={0}
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            onMouseMove={handleMove}
            onTouchMove={handleMove}
            onMouseLeave={hideTooltip}
          />
        </Group>
      </svg>

      {tooltipOpen && tooltipData ? (
        <TooltipWithBounds top={tooltipTop ?? 0} left={tooltipLeft ?? 0} style={tooltipStyles}>
          <TooltipRows
            title={`${tooltipData.agoS.toFixed(1)} s ago`}
            rows={[
              {
                label: 'Distance',
                value: `${tooltipData.point.value.toFixed(2)} m`,
                color: SERIES.energy,
              },
              { label: 'Presence', value: tooltipData.presence ? 'yes' : 'no' },
            ]}
          />
        </TooltipWithBounds>
      ) : null}
    </div>
  )
}
