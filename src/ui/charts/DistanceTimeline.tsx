/**
 * Detected distance over the last minute, with absence shown as a recessive
 * band rather than a second colour series — presence is state, not magnitude.
 */
import { useId, useMemo, useRef, useState } from 'react'
import { downsampleMinMax } from '../../core/history'
import type { Measurement } from '../../devices/ld2420/driver'
import { clamp, linearScale, nearestIndex, niceDomain, niceTicks } from './scales'
import { Tooltip } from './Tooltip'

const WIDTH = 720
const HEIGHT = 220
const MARGIN = { top: 12, right: 14, bottom: 30, left: 46 }
const MAX_POINTS = 360

export interface DistanceTimelineProps {
  samples: readonly Measurement[]
  windowMs: number
}

export function DistanceTimeline({ samples, windowMs }: DistanceTimelineProps) {
  const [hoverT, setHoverT] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const gradientId = useId()

  const plotWidth = WIDTH - MARGIN.left - MARGIN.right
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom

  const { points, absences, x, y, yTicks, latestT } = useMemo(() => {
    const latest = samples.at(-1)?.t ?? 0
    const t0 = latest - windowMs
    const reduced = downsampleMinMax(samples, MAX_POINTS).map((p) => ({
      t: p.t,
      value: p.value / 100, // centimetres on the wire, metres on the axis
    }))
    const maxValue = reduced.reduce((max, p) => Math.max(max, p.value), 0)
    const domain = niceDomain(0, Math.max(1, maxValue), 4)
    const xScale = linearScale([t0, latest || 1], [0, plotWidth])
    const yScale = linearScale(domain, [plotHeight, 0])

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

    return {
      points: reduced,
      absences: bands,
      x: xScale,
      y: yScale,
      yTicks: niceTicks(domain[0], domain[1], 4),
      latestT: latest,
    }
  }, [plotHeight, plotWidth, samples, windowMs])

  const path = useMemo(() => {
    if (points.length === 0) return ''
    return points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(2)},${y(p.value).toFixed(2)}`)
      .join(' ')
  }, [points, x, y])

  const hoverIndex = hoverT === null ? -1 : nearestIndex(points, hoverT)
  const hovered = hoverIndex >= 0 ? points[hoverIndex] : undefined
  const hoveredSample =
    hovered === undefined ? undefined : samples[nearestIndex(samples, hovered.t)]

  const handleMove = (event: React.MouseEvent<SVGSVGElement>): void => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const localX = ((event.clientX - rect.left) / rect.width) * WIDTH - MARGIN.left
    setHoverT(x.invert(clamp(localX, 0, plotWidth)))
  }

  const empty = points.length === 0

  return (
    <div className="chart">
      <div className="chart__plot">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label="Detected distance over the recent window. Stretches with no presence appear in grey."
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverT(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--series-1)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--series-1)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {absences.map((band) => (
              <rect
                key={`${band.from}-${band.to}`}
                x={clamp(x(band.from), 0, plotWidth)}
                y={0}
                width={Math.max(
                  0,
                  clamp(x(band.to), 0, plotWidth) - clamp(x(band.from), 0, plotWidth),
                )}
                height={plotHeight}
                fill="var(--gridline)"
                opacity={0.7}
              />
            ))}
            {yTicks.map((tick) => (
              <g key={tick}>
                <line className="chart__grid" x1={0} x2={plotWidth} y1={y(tick)} y2={y(tick)} />
                <text className="chart__tick" x={-8} y={y(tick)} dy="0.32em" textAnchor="end">
                  {tick.toLocaleString('en-US')}
                </text>
              </g>
            ))}
            <text
              className="chart__axis-label"
              transform={`translate(${-MARGIN.left + 4},${plotHeight / 2}) rotate(-90)`}
              textAnchor="middle"
            >
              m
            </text>

            {path ? (
              <>
                <path
                  d={`${path} L${x(points.at(-1)!.t).toFixed(2)},${plotHeight} L${x(points[0]!.t).toFixed(2)},${plotHeight} Z`}
                  fill={`url(#${gradientId})`}
                />
                <path
                  d={path}
                  fill="none"
                  stroke="var(--series-1)"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </>
            ) : null}

            {hovered ? (
              <g>
                <line
                  className="chart__baseline"
                  x1={x(hovered.t)}
                  x2={x(hovered.t)}
                  y1={0}
                  y2={plotHeight}
                />
                <circle
                  cx={x(hovered.t)}
                  cy={y(hovered.value)}
                  r={4}
                  fill="var(--series-1)"
                  stroke="var(--surface-1)"
                  strokeWidth={2}
                />
              </g>
            ) : null}

            {/* Direct label on the endpoint only — never a number on every point. */}
            {!empty && !hovered ? (
              <text
                className="chart__direct-label"
                x={clamp(x(points.at(-1)!.t) - 6, 0, plotWidth)}
                y={clamp(y(points.at(-1)!.value) - 8, 10, plotHeight)}
                textAnchor="end"
              >
                {points.at(-1)!.value.toFixed(2)} m
              </text>
            ) : null}

            <line
              className="chart__baseline"
              x1={0}
              x2={plotWidth}
              y1={plotHeight}
              y2={plotHeight}
            />
            <text className="chart__tick" x={0} y={plotHeight + 14}>
              −{Math.round(windowMs / 1000)} s
            </text>
            <text className="chart__tick" x={plotWidth} y={plotHeight + 14} textAnchor="end">
              now
            </text>
            {empty ? (
              <text
                className="chart__axis-label"
                x={plotWidth / 2}
                y={plotHeight / 2}
                textAnchor="middle"
              >
                Waiting for data…
              </text>
            ) : null}
          </g>
        </svg>

        {hovered && hoveredSample ? (
          <Tooltip
            left={`${clamp(((MARGIN.left + x(hovered.t)) / WIDTH) * 100, 14, 86)}%`}
            top={`${((MARGIN.top + y(hovered.value)) / HEIGHT) * 100}%`}
            title={`${((latestT - hovered.t) / 1000).toFixed(1)} s ago`}
            rows={[
              {
                label: 'Distance',
                value: `${hovered.value.toFixed(2)} m`,
                color: 'var(--series-1)',
              },
              { label: 'Presence', value: hoveredSample.presence ? 'yes' : 'no' },
            ]}
          />
        ) : null}
      </div>
    </div>
  )
}
